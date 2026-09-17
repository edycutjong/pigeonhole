// scripts/verify.ts — no wallet, no gas. Exit code is the verdict.
// Proves: (1) offline predict() == on-chain factory.predict() for N random ids;
//         (2) I2 (Σin − Σout == eth_getBalance) for every known pigeonhole;
//         (3) factory.treasury() == the fact-sheet treasury.
import { createPublicClient, http, parseAbi, getAddress, type Address, type Hex } from "viem";
import { predict, saltOf, reduceLogs, ARC, type Movement } from "../src/lib/pigeonhole";
import deployment from "../deployments/arc-mainnet.json" with { type: "json" };

const FACTORY = getAddress(deployment.factory as string);
const TREASURY = getAddress(deployment.treasury as string);
const N = Number(process.env.N ?? 50);

const client = createPublicClient({ transport: http(ARC.rpcUrl) });
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
  const knownIds = ["demo-paid"]; // grows as the seed script runs; discovery via Swept events happens in the page
  for (const id of knownIds) {
    const p = predict(FACTORY, TREASURY, saltOf(id));
    const transferEvent = { type: "event", name: "Transfer", inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ]} as const;
    const from0 = BigInt((deployment as any).deployBlock ?? 0);
    // Server-side topic filtering: the system emitter carries every native transfer, so filter by the pigeonhole.
    const [inLogs, outLogs] = await Promise.all([
      client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { to: p }, fromBlock: from0, toBlock: "latest" }),
      client.getLogs({ address: ARC.systemEmitter, event: transferEvent, args: { from: p }, fromBlock: from0, toBlock: "latest" }),
    ]);
    const movements: Movement[] = [...inLogs, ...outLogs].map((l) => ({
      block: l.blockNumber!, logIndex: l.logIndex!, tx: l.transactionHash as Hex,
      from: getAddress(l.args!.from as Address), to: getAddress(l.args!.to as Address), value: l.args!.value as bigint }));
    const state = reduceLogs(p, movements);
    const balance = await client.getBalance({ address: p });
    if (state.unswept !== balance) fail(`I2 ${id} @ ${p}: unswept ${state.unswept} != balance ${balance}`);
    else console.log(`  ok: I2 ${id} @ ${p} unswept==balance (${state.unswept})  status=${state.status}`);
  }

  if (fails) { console.error(`\nVERIFY FAILED: ${fails} check(s)`); process.exit(1); }
  console.log("\nVERIFY OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
