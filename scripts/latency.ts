// scripts/latency.ts — invoice→PAID latency on Arc mainnet, measured, not assumed.
//   KS=/path/to/keystore.json PW=/path/to/password-file N=10 npx tsx scripts/latency.ts
// Spends N × 0.001 USDC (+ ~0.0004 USDC gas each) from the keystore: each sample is a native USDC send to a fresh
// pigeonhole address, exactly what a payer does. The key stays inside `cast` (child process); nothing here reads it.
//
// Two clocks per sample, both from this machine's wall clock:
//   inclusion  = t(receipt available) − t(cast send --async returned the hash)   — polled every 300 ms
//   visible    = t(the page's own eth_getLogs filter returns the Transfer) − t(hash)  — one getLogs after inclusion
// The invoice page polls every 5 s (src/main.ts), so what a payer sees is `visible` + up to 5 s; that bound is reported
// separately rather than folded into the measurement. Output: bench/latency.json + bench/latency.csv.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createPublicClient, http, getAddress, type Hex } from "viem";
import { predict, saltOf, ARC } from "../src/lib/pigeonhole";
import { transferEvent } from "../src/lib/logs";
import deployment from "../deployments/arc-mainnet.json" with { type: "json" };

const KS = process.env.KS, PW = process.env.PW;
if (!KS || !PW) { console.error("set KS=/path/to/keystore.json PW=/path/to/password-file"); process.exit(2); }
const N = Number(process.env.N ?? 10);
const RPC = "https://rpc.mainnet.arc.io";
const FACTORY = getAddress(deployment.factory as string);
const TREASURY = getAddress(deployment.treasury as string);
const VALUE = 1_000_000_000_000_000n; // 0.001 USDC, 18-decimal native
const client = createPublicClient({ transport: http(RPC, { retryCount: 0 }) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

type Row = { id: string; pigeonhole: string; tx: Hex; block: number; inclusionMs: number; visibleMs: number; blockTsDeltaS: number };
const rows: Row[] = [];
const stamp = Math.floor(Date.now() / 1000);

for (let i = 1; i <= N; i++) {
  const id = `latency-${stamp}-${i}`;
  const pigeonhole = predict(FACTORY, TREASURY, saltOf(id));
  const fromBlock = await client.getBlockNumber();
  const t0 = Date.now();
  // --async: cast returns as soon as the node has accepted the transaction, so t0→hash is broadcast, not inclusion.
  const tx = execFileSync("cast", ["send", pigeonhole, "--value", VALUE.toString(), "--rpc-url", RPC, "--keystore", KS, "--password-file", PW, "--async"], { encoding: "utf8" }).trim() as Hex;
  const tSent = Date.now();
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>> | undefined;
  while (!receipt) {
    await sleep(300);
    try { receipt = await client.getTransactionReceipt({ hash: tx }); } catch { /* not yet, or a 429 — keep polling */ }
    if (Date.now() - tSent > 60_000) throw new Error(`no receipt for ${tx} after 60 s`);
  }
  const tIncl = Date.now();
  // The page's filter, verbatim (src/lib/logs.ts): system-emitter Transfer with `to` = the pigeonhole.
  let seen = false;
  while (!seen) {
    try {
      const logs = await client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { to: pigeonhole }, fromBlock, toBlock: "latest" });
      seen = logs.some((l) => l.transactionHash === tx);
    } catch { /* 429 — the page backs off the same way */ }
    if (!seen) await sleep(500);
    if (Date.now() - tIncl > 60_000) throw new Error(`log for ${tx} not visible after 60 s`);
  }
  const tSeen = Date.now();
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const row: Row = { id, pigeonhole, tx, block: Number(receipt.blockNumber), inclusionMs: tIncl - tSent, visibleMs: tSeen - tSent, blockTsDeltaS: Number(block.timestamp) - Math.floor(t0 / 1000) };
  rows.push(row);
  console.log(`${i}/${N} ${id} block ${row.block} inclusion ${row.inclusionMs} ms · visible ${row.visibleMs} ms · block ts − t0 = ${row.blockTsDeltaS} s · ${tx}`);
  await sleep(2000); // stay under the public RPC's sustainable getLogs rate between samples
}

const incl = rows.map((r) => r.inclusionMs), vis = rows.map((r) => r.visibleMs);
const out = {
  network: "arc-mainnet", chainId: 5042, factory: FACTORY, measured: new Date().toISOString().slice(0, 19) + "Z", n: rows.length,
  valueUsdcEach: "0.001", rpc: RPC,
  inclusionMs: { min: Math.min(...incl), p50: pct(incl, 50), p95: pct(incl, 95), max: Math.max(...incl) },
  visibleMs: { min: Math.min(...vis), p50: pct(vis, 50), p95: pct(vis, 95), max: Math.max(...vis) },
  pagePollS: 5,
  note: "inclusion = cast send --async → receipt (300 ms poll); visible = → the page's own eth_getLogs filter returns the Transfer. What a payer sees on the invoice page is `visible` + up to one 5 s poll interval.",
};
writeFileSync("bench/latency.json", JSON.stringify(out, null, 2) + "\n");
writeFileSync("bench/latency.csv", "id,pigeonhole,tx,block,inclusionMs,visibleMs,blockTsDeltaS\n" + rows.map((r) => [r.id, r.pigeonhole, r.tx, r.block, r.inclusionMs, r.visibleMs, r.blockTsDeltaS].join(",")).join("\n") + "\n");
console.log(`\ninclusion p50 ${out.inclusionMs.p50} ms · p95 ${out.inclusionMs.p95} ms · visible p50 ${out.visibleMs.p50} ms · p95 ${out.visibleMs.p95} ms → bench/latency.json`);
