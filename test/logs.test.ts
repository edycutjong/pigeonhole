// Regression tests named after the defect they pin (2026-09-17 audit): the page scanned eth_getLogs in 90,000-block
// chunks; the public Arc RPC rejects any span of 10,000+ blocks with -32012 "requested range too large".
import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { spans, fetchMovements, MovementCache, MAX_LOG_SPAN, RESCAN_OVERLAP, type LogClient } from "../src/lib/logs";

const P = getAddress("0xb356C620E45d8d8C884a6235dD660c32f0a1F26b");
const T = getAddress("0xA8965A47c9b6ed34F47B374f36cF6c752D24852a");

/** A fake RPC that enforces the real cap and records every span it was asked for. */
function fakeClient(latest: bigint, logs: any[] = []) {
  const calls: [bigint, bigint][] = [];
  const client: LogClient = {
    getBlockNumber: async () => latest,
    getLogs: async ({ fromBlock, toBlock, args }) => {
      if (toBlock - fromBlock + 1n >= 10_000n) throw Object.assign(new Error("requested range too large"), { code: -32012 });
      calls.push([fromBlock, toBlock]);
      return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && (args.to ? getAddress(l.args.to) === args.to : getAddress(l.args.from) === args.from));
    },
  };
  return { client, calls };
}

describe("eth_getLogs chunking — RPC rejects 10k+ block spans with -32012", () => {
  it("no span ever reaches 10,000 blocks, and the spans tile the range exactly", () => {
    const out = [...spans(21_337_182n, 21_337_182n + 250_000n)];
    expect(out.every(([a, b]) => b - a + 1n <= MAX_LOG_SPAN && b - a + 1n < 10_000n)).toBe(true);
    expect(out[0][0]).toBe(21_337_182n);
    expect(out.at(-1)![1]).toBe(21_337_182n + 250_000n);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBe(out[i - 1][1] + 1n);
  });

  it("a 250k-block history (≈1.5 days of Arc) fetches without -32012 and finds logs in every chunk", async () => {
    const deploy = 21_337_182n, latest = deploy + 250_000n;
    const logs = [
      { blockNumber: deploy + 5n, logIndex: 0, transactionHash: "0x01", args: { from: T, to: P, value: 20_000_000_000_000_000n } },
      { blockNumber: deploy + 120_000n, logIndex: 1, transactionHash: "0x02", args: { from: P, to: T, value: 20_000_000_000_000_000n } },
      { blockNumber: latest, logIndex: 0, transactionHash: "0x03", args: { from: T, to: P, value: 1n } },
    ];
    const { client } = fakeClient(latest, logs);
    const m = await fetchMovements(client, P, deploy, latest);
    expect(m.map((x) => x.tx)).toEqual(["0x01", "0x02", "0x03"]);
  });

  it("the invoice poll is incremental: the second refresh asks only for blocks since the last scan", async () => {
    const deploy = 21_337_182n;
    let latest = deploy + 20_000n;
    const { client, calls } = fakeClient(latest);
    const dyn: LogClient = { getBlockNumber: async () => latest, getLogs: client.getLogs };
    const cache = new MovementCache(dyn);
    await cache.movements(P, deploy);
    const firstScan = calls.length; // 3 chunks × 2 directions
    expect(firstScan).toBe(6);
    latest += 7n; // 3 seconds of Arc
    await cache.movements(P, deploy);
    expect(calls.length - firstScan).toBe(2); // one tiny span (with the overlap tail), both directions
    expect(calls.at(-1)).toEqual([deploy + 20_000n - RESCAN_OVERLAP, latest]);
  });

  it("overlapping polls and the overlap tail never double-count a log (keyed by tx:logIndex)", async () => {
    const deploy = 21_337_182n; let latest = deploy + 100n;
    const logs = [{ blockNumber: deploy + 95n, logIndex: 3, transactionHash: "0xaa", args: { from: T, to: P, value: 5n } }];
    const { client } = fakeClient(latest, logs);
    const cache = new MovementCache({ getBlockNumber: async () => latest, getLogs: client.getLogs });
    const [a, b] = await Promise.all([cache.movements(P, deploy), cache.movements(P, deploy)]); // concurrent
    expect(a).toBe(b); // shared in-flight scan
    latest += 3n; const again = await cache.movements(P, deploy); // overlap re-reads block deploy+95
    expect(again.filter((m) => m.tx === "0xaa")).toHaveLength(1);
  });

  it("a lower fromBlock on a warm cache widens the scan instead of hiding earlier payments (re-created invoice id)", async () => {
    const deploy = 21_337_182n; const latest = deploy + 50_000n;
    const logs = [{ blockNumber: deploy + 10n, logIndex: 0, transactionHash: "0xold", args: { from: T, to: P, value: 7n } }];
    const { client } = fakeClient(latest, logs);
    const cache = new MovementCache(client);
    expect(await cache.movements(P, latest - 100n)).toHaveLength(0);   // narrow window: the old payment is out of range
    expect((await cache.movements(P, deploy)).map((m) => m.tx)).toEqual(["0xold"]); // widened: found, not duplicated
  });

  it("fromBlock beyond the head makes no RPC call and does not advance the scan", async () => {
    const deploy = 21_337_182n; const latest = deploy + 10n;
    const { client, calls } = fakeClient(latest);
    const cache = new MovementCache(client);
    expect(await cache.movements(P, latest + 1n)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
