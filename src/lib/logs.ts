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

/**
 * Incremental cache: the first call scans fromBlock..latest; later calls scan only the blocks since the last
 * scan, so a 3-second poll costs one small getLogs pair, not a full-history walk.
 */
export class MovementCache {
  private scannedTo = new Map<string, bigint>();
  private moves = new Map<string, Movement[]>();
  constructor(private client: LogClient) {}

  async movements(pigeonhole: Address, fromBlock: bigint): Promise<Movement[]> {
    const key = getAddress(pigeonhole);
    const latest = await this.client.getBlockNumber();
    const prev = this.scannedTo.get(key);
    const start = prev === undefined ? fromBlock : prev + 1n;
    if (start <= latest) {
      const fresh = await fetchMovements(this.client, key, start, latest);
      this.moves.set(key, [...(this.moves.get(key) ?? []), ...fresh]);
      this.scannedTo.set(key, latest);
    }
    return this.moves.get(key) ?? [];
  }
}
