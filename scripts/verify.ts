// scripts/verify.ts — no wallet, no gas. Exit code is the verdict.
// Proves: (1) offline predict() == on-chain factory.predict() for N random ids;
//         (2) I2 (Σin − Σout == eth_getBalance) for every known pigeonhole;
//         (3) factory.treasury() == the fact-sheet treasury.
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { predict, saltOf, reduceLogs } from "../src/lib/pigeonhole";
import { MovementCache, type LogClient } from "../src/lib/logs";
import deployment from "../deployments/arc-mainnet.json" with { type: "json" };
import checkpoints from "../deployments/history-checkpoints.json" with { type: "json" };

const FACTORY = getAddress(deployment.factory as string);
const TREASURY = getAddress(deployment.treasury as string);
const N = Number(process.env.N ?? 50);

const client = createPublicClient({ transport: http("https://rpc.mainnet.arc.io", { retryCount: 0 }) });
// (4) the committed history checkpoints are chain data: every movement must be a real system-emitter log in its receipt,
//     and the cache is seeded from them so (2) walks only the tail (the RPC sustains ≈0.5 getLogs/s — src/lib/logs.ts).
const cache = new MovementCache(client as unknown as LogClient);
const cps = Object.entries((checkpoints as any).pigeonholes ?? {}) as [string, any][];
for (const [addr, cp] of cps) cache.seed(getAddress(addr), BigInt(cp.from), BigInt(cp.to), cp.moves.map((m: any) => ({ block: BigInt(m.block), logIndex: Number(m.logIndex), tx: m.tx, from: getAddress(m.from), to: getAddress(m.to), value: BigInt(m.value) })));
const factoryAbi = parseAbi(["function predict(bytes32) view returns (address)", "function treasury() view returns (address)"]);

let fails = 0;
const fail = (m: string) => { console.error("  FAIL:", m); fails++; };

async function main() {
  // (3) treasury
  const onchainTreasury = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "treasury" });
  if (getAddress(onchainTreasury) !== TREASURY) fail(`treasury ${onchainTreasury} != ${TREASURY}`);
  else console.log(`  ok: treasury == ${TREASURY}`);

  // (1) offline == on-chain for N random ids
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const id = `verify-${i}-${Math.random().toString(36).slice(2)}`;
    const salt = saltOf(id);
    const offline = predict(FACTORY, TREASURY, salt);
    const onchain = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "predict", args: [salt] });
    if (getAddress(onchain) !== offline) fail(`predict mismatch id=${id}: offline ${offline} != onchain ${onchain}`);
    else ok++;
  }
  console.log(`  ok: ${ok}/${N} offline predict() == on-chain predict()`);

  // (2) I2 for the known demo pigeonholes: reduce their system-emitter logs and compare to balance.
  const knownIds = ["demo-paid", "demo-erc20"]; // the two seeded cycles (native send; ERC-20 transfer()) — discovery via Swept events happens in the page
  for (const id of knownIds) {
    const p = predict(FACTORY, TREASURY, saltOf(id));
    // Chunked (≤9,000 blocks per call): the RPC rejects 10k+ spans with -32012. See src/lib/logs.ts.
    const from0 = BigInt((deployment as any).deployBlock ?? 0);
    const movements = await cache.movements(p, from0);
    const state = reduceLogs(p, movements);
    const balance = await client.getBalance({ address: p });
    if (state.unswept !== balance) fail(`I2 ${id} @ ${p}: unswept ${state.unswept} != balance ${balance}`);
    else console.log(`  ok: I2 ${id} @ ${p} unswept==balance (${state.unswept})  status=${state.status}`);
  }

  // (4) checkpoint movements vs receipts
  const EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for (const [addr, cp] of cps) {
    for (const m of cp.moves as any[]) {
      const r = await client.getTransactionReceipt({ hash: m.tx });
      const log = r.logs.find((l) => Number(l.logIndex) === Number(m.logIndex));
      const okLog = !!log && log.address.toLowerCase() === EMITTER && log.topics[0] === TRANSFER
        && getAddress(`0x${log.topics[1]!.slice(26)}`) === getAddress(m.from) && getAddress(`0x${log.topics[2]!.slice(26)}`) === getAddress(m.to)
        && BigInt(log.data) === BigInt(m.value) && r.blockNumber === BigInt(m.block);
      if (!okLog) fail(`checkpoint ${cp.id} @ ${addr}: ${m.tx}#${m.logIndex} does not match its receipt`);
      else console.log(`  ok: checkpoint ${cp.id} ${m.tx.slice(0, 10)}…#${m.logIndex} == receipt (block ${m.block}, ${m.value} wei)`);
    }
  }

  if (fails) { console.error(`\nVERIFY FAILED: ${fails} check(s)`); process.exit(1); }
  console.log("\nVERIFY OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
