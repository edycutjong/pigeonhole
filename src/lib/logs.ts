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
  /** ms between eth_getLogs calls; undefined = CALL_PACE_MS, 0 = no pacing (tests). */
  pace?: number;
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

/** Errors the public RPC returns under load — worth a paced retry, unlike a malformed request. */
const TRANSIENT_CODES = new Set([-32005, -32014, 429, 502, 503, 504]);
const isTransient = (e: unknown) => {
  for (let c: any = e, i = 0; c && i < 6; c = c.cause, i++) {           // viem wraps the RPC error a few levels deep
    if (TRANSIENT_CODES.has(Number(c.code)) || TRANSIENT_CODES.has(Number(c.status))) return true;
    if (/rate limit|exceeds defined limit|too many requests|-32005|-32014|timeout|timed out|fetch failed|network|ECONNRESET|not available/i.test(String(c.shortMessage ?? c.message ?? c))) return true;
  }
  return false;
};

/** Retry `fn` on transient RPC errors. The public RPC's limit is a fixed window (measured 2026-09-20: ≈60 getLogs per
 *  30 s, then ≈10–30 s of -32005 before it refills), so the first back-off already waits long enough for a refill:
 *  6 s, 12 s, 24 s, 30 s, 30 s … (jittered). Exported so the test can pin it. */
export const RETRY_ATTEMPTS = 7;
export async function withRetry<T>(fn: () => Promise<T>, attempts = RETRY_ATTEMPTS, baseMs = 6_000): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i + 1 >= attempts || !isTransient(e)) throw e;
      const wait = Math.min(30_000, baseMs * 2 ** i) * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Pause between eth_getLogs calls. Measured 2026-09-20 on rpc.mainnet.arc.io: after any burst, 1 call/s is refused
 *  indefinitely (40/40 -32005) while 1 call per 2 s always succeeds (40/40) — the sustainable rate is ≈0.5 getLogs/s.
 *  Applies to the page and to the scripts; the unit tests inject `pace` = 0 through the fake client. */
export const CALL_PACE_MS = 2_100;
const paced = (client: LogClient) => (client.pace ?? CALL_PACE_MS) <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, client.pace ?? CALL_PACE_MS));

export type Progress = { done: number; total: number; toBlock: bigint };

/**
 * All system-emitter Transfer logs touching `pigeonhole` (in OR out) between two blocks, chunked. Calls are sequential
 * and paced (the RPC rate-limits bursts) and each is retried on transient errors; `onChunk` is called after every
 * completed chunk so callers can checkpoint progress — a failure late in a long walk keeps the chunks already read.
 */
export async function fetchMovements(client: LogClient, pigeonhole: Address, fromBlock: bigint, toBlock: bigint,
  onChunk?: (moves: Movement[], chunkEnd: bigint, progress: Progress) => void): Promise<Movement[]> {
  const out: any[] = [];
  const all = [...spans(fromBlock, toBlock)];
  for (let i = 0; i < all.length; i++) {
    const [a, b] = all[i];
    if (i > 0) await paced(client);
    const ins = await withRetry(() => client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { to: pigeonhole }, fromBlock: a, toBlock: b }));
    await paced(client);
    const outs = await withRetry(() => client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { from: pigeonhole }, fromBlock: a, toBlock: b }));
    out.push(...ins, ...outs);
    onChunk?.(toMovements([...ins, ...outs]), b, { done: i + 1, total: all.length, toBlock: b });
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
 * last scan (minus a small overlap), so a 5-second poll costs one small getLogs pair, not a full-history walk.
 * Logs are keyed by (tx, logIndex) so overlapping polls and the overlap window never double-count, and concurrent
 * callers for the same address share one in-flight scan.
 */
/** A localStorage-shaped store; when given, checkpoints survive reloads so a returning visitor never re-walks history. */
export type MoveStore = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const STORE_PREFIX = "pigeonhole.moves.v1.";
const bigToStr = (m: Movement) => ({ ...m, block: m.block.toString(), value: m.value.toString() });
const strToBig = (m: any): Movement => ({ ...m, block: BigInt(m.block), value: BigInt(m.value) });

export class MovementCache {
  private scannedTo = new Map<string, bigint>();
  private scannedFrom = new Map<string, bigint>();
  private moves = new Map<string, Map<string, Movement>>();
  private inflight = new Map<string, { from: bigint; gen: number; p: Promise<Movement[]> }>();
  private gen = new Map<string, number>(); // bumped by invalidate(); a scan started before the bump must not write state
  private hydrated = new Set<string>();
  /** Called after every completed chunk of a walk (for a progress line in the UI). */
  onProgress?: (pigeonhole: Address, p: Progress) => void;
  constructor(private client: LogClient, private store?: MoveStore) {}

  /** Committed checkpoints (deployments/history-checkpoints.json) for the seeded invoices: the first read walks only
   *  the tail after `to`. Chain data, verifiable receipt by receipt (`npm run verify`); refreshed by `npm run checkpoints`. */
  private seeds = new Map<string, { from: bigint; to: bigint; moves: Movement[] }>();
  seed(pigeonhole: Address, from: bigint, to: bigint, moves: Movement[]) {
    this.seeds.set(getAddress(pigeonhole), { from, to, moves });
  }

  private load(key: Address, from: bigint, to: bigint, moves: Movement[]) {
    const prevTo = this.scannedTo.get(key);
    if (prevTo !== undefined && prevTo >= to) return;                  // what we hold already reaches further
    const bucket = new Map<string, Movement>();
    for (const m of moves) bucket.set(keyOf(m), m);
    this.moves.set(key, bucket); this.scannedFrom.set(key, from); this.scannedTo.set(key, to);
  }

  private hydrate(key: Address) {
    if (this.hydrated.has(key)) return;
    this.hydrated.add(key);
    const seed = this.seeds.get(key);
    if (seed) this.load(key, seed.from, seed.to, seed.moves);
    if (!this.store) return;
    try {
      const raw = this.store.getItem(STORE_PREFIX + key.toLowerCase());
      if (!raw) return;
      const j = JSON.parse(raw);
      this.load(key, BigInt(j.from), BigInt(j.to), j.moves.map(strToBig));   // wins only if it reaches further
    } catch { try { this.store.removeItem(STORE_PREFIX + key.toLowerCase()); } catch { /* ignore */ } }
  }
  private persist(key: Address) {
    if (!this.store) return;
    const from = this.scannedFrom.get(key), to = this.scannedTo.get(key);
    if (from === undefined || to === undefined) return;
    try { this.store.setItem(STORE_PREFIX + key.toLowerCase(), JSON.stringify({ from: from.toString(), to: to.toString(), moves: [...(this.moves.get(key) ?? new Map()).values()].map(bigToStr) })); } catch { /* quota or private mode: in-memory only */ }
  }

  /** Movements for `pigeonhole` from `fromBlock` to the chain head. A lower `fromBlock` than before widens the scan. */
  async movements(pigeonhole: Address, fromBlock: bigint): Promise<Movement[]> {
    const key = getAddress(pigeonhole);
    this.hydrate(key);
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
    try { this.store?.removeItem(STORE_PREFIX + key.toLowerCase()); } catch { /* ignore */ }
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
    const bucket = this.moves.get(key) ?? new Map<string, Movement>();
    if (start <= latest) {
      // Checkpoint after every chunk: if the RPC gives up halfway through a long first walk, the next poll resumes
      // from the last completed chunk (minus the overlap) instead of starting the whole history again.
      await fetchMovements(this.client, key, start, latest, (moves, chunkEnd, progress) => {
        if ((this.gen.get(key) ?? 0) !== gen) return;
        for (const m of moves) { fresh.set(keyOf(m), m); bucket.set(keyOf(m), m); }
        this.moves.set(key, bucket);
        this.scannedFrom.set(key, newFrom);
        this.scannedTo.set(key, chunkEnd);
        if (progress.total > 1) this.persist(key);
        this.onProgress?.(key, progress);
      });
    }
    if ((this.gen.get(key) ?? 0) !== gen) return [...fresh.values()];   // invalidated meanwhile: report, don't persist
    for (const [k, m] of fresh) bucket.set(k, m);
    this.moves.set(key, bucket);
    this.scannedFrom.set(key, newFrom);
    if (start <= latest) this.scannedTo.set(key, latest); else if (prevTo !== undefined) this.scannedTo.set(key, prevTo);
    this.persist(key);
    return [...bucket.values()];
  }
}
