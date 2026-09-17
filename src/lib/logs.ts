// Chunked, incremental eth_getLogs over the EIP-7708 system emitter.
// The public Arc RPC rejects any eth_getLogs span of 10,000+ blocks with -32012 "requested range too large"
// (measured 2026-09-17: 9,999 ok, 10,000 rejected). At ~2 blocks/s that is ~85 minutes of chain, so every
// scan must be chunked and every poll must be incremental — a fresh full-history scan per refresh is not viable.
import { getAddress, type Address, type Hex } from "viem";
import { ARC, type Movement } from "./pigeonhole";

/** Largest span the RPC accepts, with headroom (9,000 < 10,000). Exported so the test can pin it. */
export const MAX_LOG_SPAN = 9_000n;

export const transferEvent = {
  type: "event", name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

/** The minimal slice of a viem PublicClient this module needs (keeps the test client tiny). */
export type LogClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: Address; event: typeof transferEvent; args: { to?: Address; from?: Address };
    fromBlock: bigint; toBlock: bigint;
  }): Promise<any[]>;
};

/** Yields [from, to] inclusive spans, each ≤ MAX_LOG_SPAN blocks wide, covering from..to. */
export function* spans(from: bigint, to: bigint, max: bigint = MAX_LOG_SPAN): Generator<[bigint, bigint]> {
  for (let start = from; start <= to; start += max) {
    const end = start + max - 1n > to ? to : start + max - 1n;
    yield [start, end];
  }
}

export function toMovements(logs: any[]): Movement[] {
  return logs.map((l) => ({
    block: BigInt(l.blockNumber), logIndex: Number(l.logIndex), tx: l.transactionHash as Hex,
    from: getAddress(l.args.from as Address), to: getAddress(l.args.to as Address), value: BigInt(l.args.value),
  }));
}

/** All system-emitter Transfer logs touching `pigeonhole` (in OR out) between two blocks, chunked. */
export async function fetchMovements(client: LogClient, pigeonhole: Address, fromBlock: bigint, toBlock: bigint): Promise<Movement[]> {
  const out: any[] = [];
  for (const [a, b] of spans(fromBlock, toBlock)) {
    const [ins, outs] = await Promise.all([
      client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { to: pigeonhole }, fromBlock: a, toBlock: b }),
      client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { from: pigeonhole }, fromBlock: a, toBlock: b }),
    ]);
    out.push(...ins, ...outs);
  }
  return toMovements(out);
}

/** How many blocks to re-read on every incremental scan. The public RPC is load-balanced: `eth_getBlockNumber` and
 *  `eth_getLogs` can be answered by backends whose heads differ, and a `toBlock` past the serving backend's head returns
 *  `[]` with no error. Re-reading a short tail (deduped) closes that hole. */
export const RESCAN_OVERLAP = 10n;

const keyOf = (m: Movement) => `${m.tx}:${m.logIndex}`;

/**
 * Incremental, deduplicated cache: the first call scans fromBlock..latest; later calls scan only the blocks since the
 * last scan (minus a small overlap), so a 3-second poll costs one small getLogs pair, not a full-history walk.
 * Logs are keyed by (tx, logIndex) so overlapping polls and the overlap window never double-count, and concurrent
 * callers for the same address share one in-flight scan.
 */
export class MovementCache {
  private scannedTo = new Map<string, bigint>();
  private scannedFrom = new Map<string, bigint>();
  private moves = new Map<string, Map<string, Movement>>();
  private inflight = new Map<string, { from: bigint; gen: number; p: Promise<Movement[]> }>();
  private gen = new Map<string, number>(); // bumped by invalidate(); a scan started before the bump must not write state
  constructor(private client: LogClient) {}

  /** Movements for `pigeonhole` from `fromBlock` to the chain head. A lower `fromBlock` than before widens the scan. */
  async movements(pigeonhole: Address, fromBlock: bigint): Promise<Movement[]> {
    const key = getAddress(pigeonhole);
    const running = this.inflight.get(key);
    if (running) {
      if (running.from <= fromBlock) return running.p;        // same or wider scan already in flight: share it
      await running.p.catch(() => {});                          // narrower one: let it finish, then widen below
    }
    const gen = this.gen.get(key) ?? 0;
    const p = this.scan(key, fromBlock, gen).finally(() => { if (this.inflight.get(key)?.p === p) this.inflight.delete(key); });
    this.inflight.set(key, { from: fromBlock, gen, p });
    return p;
  }

  /** Forget everything about one address; any scan already in flight will not write its (stale) window back. */
  invalidate(pigeonhole: Address) {
    const key = getAddress(pigeonhole);
    this.gen.set(key, (this.gen.get(key) ?? 0) + 1);
    this.inflight.delete(key);
    this.scannedTo.delete(key); this.scannedFrom.delete(key); this.moves.delete(key);
  }

  private async scan(key: Address, fromBlock: bigint, gen: number): Promise<Movement[]> {
    const latest = await this.client.getBlockNumber();
    const fresh = new Map<string, Movement>();
    const prevTo = this.scannedTo.get(key), prevFrom = this.scannedFrom.get(key);
    let start: bigint, newFrom: bigint;
    if (prevTo === undefined) { start = fromBlock; newFrom = fromBlock; }
    else {
      newFrom = prevFrom !== undefined && prevFrom < fromBlock ? prevFrom : fromBlock;
      if (prevFrom !== undefined && fromBlock < prevFrom)      // caller wants earlier history: fill the gap below first
        for (const m of await fetchMovements(this.client, key, fromBlock, prevFrom - 1n)) fresh.set(keyOf(m), m);
      start = prevTo - RESCAN_OVERLAP; if (start < newFrom) start = newFrom;
    }
    if (start <= latest) for (const m of await fetchMovements(this.client, key, start, latest)) fresh.set(keyOf(m), m);
    if ((this.gen.get(key) ?? 0) !== gen) return [...fresh.values()];   // invalidated meanwhile: report, don't persist
    const bucket = this.moves.get(key) ?? new Map<string, Movement>();
    for (const [k, m] of fresh) bucket.set(k, m);
    this.moves.set(key, bucket);
    this.scannedFrom.set(key, newFrom);
    if (start <= latest) this.scannedTo.set(key, latest); else if (prevTo !== undefined) this.scannedTo.set(key, prevTo);
    return [...bucket.values()];
  }
}
