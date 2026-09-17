// scripts/bench.ts — measures sweep gas on Arc mainnet to settle invariant I4 (gas per balance-moving sweep).
// Funds N fresh pigeonholes with a tiny amount, sweeps each (all funds return to treasury == deployer, so net cost is gas),
// then does R re-sweeps of already-swept addresses (empty no-ops). Writes bench/results.json + bench/rows.csv.
// Run: PRIVATE_KEY=$(...) N=30 R=10 tsx scripts/bench.ts
import { createWalletClient, createPublicClient, http, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync } from "node:fs";
import { predict, saltOf, ARC } from "../src/lib/pigeonhole";
import { arc, factoryAbi } from "../src/chain";
import deployment from "../deployments/arc-mainnet.json" with { type: "json" };

const FACTORY = getAddress(deployment.factory);
const TREASURY = getAddress(deployment.treasury);
const N = Number(process.env.N ?? 30);
const R = Number(process.env.R ?? 10);
const FUND = 10n ** 15n; // 0.001 USDC per pigeonhole, swept back to treasury

const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const wallet = createWalletClient({ account, chain: arc, transport: http(ARC.rpcUrl) });
const pub = createPublicClient({ chain: arc, transport: http(ARC.rpcUrl) });

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function sweepGas(salt: Hex): Promise<{ gasUsed: number; effGasPrice: number }> {
  const data = encodeFunctionData({ abi: factoryAbi, functionName: "sweep", args: [salt] });
  const hash = await wallet.sendTransaction({ to: FACTORY, data, maxFeePerGas: 25_000_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  return { gasUsed: Number(r.gasUsed), effGasPrice: Number(r.effectiveGasPrice) };
}

async function main() {
  const rows: string[] = ["kind,id,pigeonhole,gasUsed,effGasPriceGwei,feeUsdc,tx"];
  const moving: number[] = [], empty: number[] = [];
  console.log(`bench: N=${N} balance-moving sweeps + R=${R} empty re-sweeps on Arc mainnet`);

  for (let i = 0; i < N; i++) {
    const id = `bench-${Date.now()}-${i}`;
    const salt = saltOf(id);
    const p = predict(FACTORY, TREASURY, salt);
    const fh = await wallet.sendTransaction({ to: p, value: FUND });
    await pub.waitForTransactionReceipt({ hash: fh });
    const { gasUsed, effGasPrice } = await sweepGas(salt);
    moving.push(gasUsed);
    const fee = (gasUsed * effGasPrice) / 1e18;
    rows.push(`moving,${id},${p},${gasUsed},${(effGasPrice / 1e9).toFixed(3)},${fee.toFixed(9)},`);
    if (i % 5 === 0) process.stdout.write(`  moving ${i + 1}/${N} gas=${gasUsed}\n`);
  }
  for (let i = 0; i < R; i++) {
    const salt = saltOf(`bench-empty-${Date.now()}-${i}`);
    const { gasUsed, effGasPrice } = await sweepGas(salt);
    empty.push(gasUsed);
    rows.push(`empty,,,${gasUsed},${(effGasPrice / 1e9).toFixed(3)},${((gasUsed * effGasPrice) / 1e18).toFixed(9)},`);
  }

  const summ = (xs: number[]) => ({ n: xs.length, min: Math.min(...xs), p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs), mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) });
  const results = {
    network: "arc-mainnet", chainId: 5042, factory: FACTORY, when: new Date().toISOString(),
    movingSweepGas: summ(moving), emptySweepGas: summ(empty),
    preStated_I4: 64140, note: "I4 pre-stated from probe n=1 (row 5). This is the N-sample distribution.",
  };
  writeFileSync("bench/results.json", JSON.stringify(results, null, 2));
  writeFileSync("bench/rows.csv", rows.join("\n") + "\n");
  console.log("\n" + JSON.stringify(results, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
