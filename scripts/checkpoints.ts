// scripts/checkpoints.ts — refresh deployments/history-checkpoints.json: the committed eth_getLogs history of the
// seeded invoices, so the page's first read of `demo-paid` / `demo-erc20` walks only the tail since the last refresh
// instead of the whole history from the deploy block (the public RPC sustains ≈0.5 getLogs/s; see src/lib/logs.ts).
// Chain data only: every movement is a (tx, logIndex) on the system emitter and `npm run verify` re-checks each one
// against its receipt. No wallet, no gas. Run: `npm run checkpoints` (walks from the previous `to` to the head).
import { createPublicClient, http, getAddress } from "viem";
import { readFileSync, writeFileSync } from "fs";
import { fetchMovements, MovementCache, type LogClient } from "../src/lib/logs";
import deployment from "../deployments/arc-mainnet.json" with { type: "json" };

const FILE = new URL("../deployments/history-checkpoints.json", import.meta.url).pathname;
const client = createPublicClient({ transport: http("https://rpc.mainnet.arc.io", { retryCount: 0 }) }) as unknown as LogClient;
const DEPLOY = BigInt(deployment.deployBlock);
const seeded: Record<string, string> = { "demo-paid": deployment.firstCycle.pigeonhole, "demo-erc20": deployment.erc20Cycle.pigeonhole };

type Entry = { id: string; from: string; to: string; moves: { block: string; logIndex: number; tx: string; from: string; to: string; value: string }[] };
let prev: { pigeonholes: Record<string, Entry> } = { pigeonholes: {} };
try { prev = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* first run */ }

const latest = await client.getBlockNumber();
const out: Record<string, Entry> = {};
for (const [id, addr] of Object.entries(seeded)) {
  const key = getAddress(addr);
  const old = prev.pigeonholes[key.toLowerCase()];
  const cache = new MovementCache(client);
  if (old) cache.seed(key, BigInt(old.from), BigInt(old.to), old.moves.map((m) => ({ ...m, tx: m.tx as `0x${string}`, from: getAddress(m.from), to: getAddress(m.to), block: BigInt(m.block), value: BigInt(m.value) })));
  process.stdout.write(`  ${id} ${key}: ${old ? `tail from ${old.to}` : `full walk from ${DEPLOY}`} → ${latest} … `);
  const moves = await cache.movements(key, DEPLOY);
  moves.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  out[key.toLowerCase()] = { id, from: DEPLOY.toString(), to: latest.toString(), moves: moves.map((m) => ({ block: m.block.toString(), logIndex: m.logIndex, tx: m.tx, from: m.from, to: m.to, value: m.value.toString() })) };
  console.log(`${moves.length} movement(s)`);
}
writeFileSync(FILE, JSON.stringify({ generated: new Date().toISOString().slice(0, 19) + "Z", toBlock: latest.toString(), rpc: "https://rpc.mainnet.arc.io", note: "eth_getLogs history of the seeded invoices, committed so the page walks only the tail; refresh with `npm run checkpoints`; `npm run verify` checks every movement against its receipt", pigeonholes: out }, null, 2) + "\n");
console.log(`  wrote ${FILE} @ block ${latest}`);
void fetchMovements;
