// viem clients + Arc chain def + the RPC-capped log fetch the page depends on.
import { createPublicClient, http, defineChain, getAddress, parseAbi,
  type Address, type EIP1193Provider } from "viem";
import { ARC, reduceLogs, type InvoiceState } from "./lib/pigeonhole";
import { MovementCache, MAX_LOG_SPAN, CALL_PACE_MS, spans, withRetry } from "./lib/logs";
import deployment from "../deployments/arc-mainnet.json";
import checkpoints from "../deployments/history-checkpoints.json";

export const FACTORY = getAddress(deployment.factory);
export const TREASURY = getAddress(deployment.treasury);
export const DEPLOY_BLOCK = BigInt(deployment.deployBlock);

export const arc = defineChain({
  id: ARC.chainId,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpcUrl] } },
  blockExplorers: { default: { name: "Arc Explorer", url: ARC.explorer } },
});

export const pub = createPublicClient({ chain: arc, transport: http(ARC.rpcUrl, { retryCount: 0 }) }); // retries are paced in src/lib/logs.ts, not burst by viem
export const factoryAbi = parseAbi([
  "function predict(bytes32) view returns (address)",
  "function sweep(bytes32) returns (address)",
  "function sweepMany(bytes32[])",
  "function treasury() view returns (address)",
  "event Swept(bytes32 indexed salt, address indexed pigeonhole, uint256 amount)",
]);

// The public RPC rejects eth_getLogs spans of 10,000+ blocks (-32012) — see src/lib/logs.ts. Every scan is chunked
// and the invoice view polls incrementally through this cache.
const cache = new MovementCache(pub, typeof localStorage === "undefined" ? undefined : localStorage);
// The seeded invoices ship their eth_getLogs history (deployments/history-checkpoints.json): the first read walks only
// the tail since `to`. Every movement in that file is re-checked against its receipt by `npm run verify`.
for (const [addr, cp] of Object.entries((checkpoints as any).pigeonholes ?? {}) as [string, any][]) {
  const moves = (cp.moves as any[]).map((m) => ({ block: BigInt(m.block), logIndex: Number(m.logIndex), tx: m.tx as `0x${string}`, from: getAddress(m.from), to: getAddress(m.to), value: BigInt(m.value) }));
  cache.seed(getAddress(addr), BigInt(cp.from), BigInt(cp.to), moves);
}
/** Subscribe to walk progress for one address (the invoice view shows "chunk d / t"). Returns an unsubscribe. */
export function onScanProgress(f: (pigeonhole: Address, p: import("./lib/logs").Progress) => void) { cache.onProgress = f; return () => { if (cache.onProgress === f) cache.onProgress = undefined; }; }

/**
 * Full state for one pigeonhole, from the system emitter only (no double-count of the 6-dec ERC-20 log).
 * `fromBlock` is the block the invoice was created at (carried in the URL as ?from=); without it we scan from the
 * factory's deploy block, which gets slower as the chain grows (~170k blocks/day at 2 blocks/s).
 */
const mismatches = new Map<string, number>(); // consecutive I2 mismatches per pigeonhole

export type LiveInvoiceState = InvoiceState & { balance: bigint; i2: boolean; rescanned: boolean };

export async function invoiceState(pigeonhole: Address, amount18?: bigint, fromBlock: bigint = DEPLOY_BLOCK): Promise<LiveInvoiceState> {
  const key = getAddress(pigeonhole);
  const from = fromBlock < DEPLOY_BLOCK ? DEPLOY_BLOCK : fromBlock;
  let [movements, balance] = await Promise.all([cache.movements(key, from), pub.getBalance({ address: key })]);
  let state = reduceLogs(key, movements, amount18);
  let rescanned = false;
  if (state.unswept === balance) mismatches.delete(key);
  else {
    // Invariant I2, checked live: Σin − Σout must equal the chain balance. One mismatch is usually RPC head skew
    // (getBalance served by a backend ahead of getLogs) and heals on the next poll via the overlap re-read. Two in a
    // row means the scan window is wrong (e.g. an invoice id re-created after it was paid): rescan from the deploy block.
    const n = (mismatches.get(key) ?? 0) + 1; mismatches.set(key, n);
    if (n >= 2 && from > DEPLOY_BLOCK) {
      cache.invalidate(key);
      movements = await cache.movements(key, DEPLOY_BLOCK);
      state = reduceLogs(key, movements, amount18);
      rescanned = true;
      if (state.unswept === balance) mismatches.delete(key);
    }
  }
  return { ...state, balance, i2: state.unswept === balance, rescanned };
}

/** All Swept events from the factory → the treasury view's source of truth. */
export async function sweptEvents() {
  const latest = await pub.getBlockNumber();
  const out: any[] = [];
  let first = true;
  for (const [a, b] of spans(DEPLOY_BLOCK, latest, MAX_LOG_SPAN)) {
    if (!first) await new Promise((r) => setTimeout(r, CALL_PACE_MS)); // same pacing + retry as the invoice walk
    first = false;
    const logs = await withRetry(() => pub.getContractEvents({ address: FACTORY, abi: factoryAbi, eventName: "Swept", fromBlock: a, toBlock: b }));
    out.push(...logs);
  }
  return out;
}

export async function connectWallet(): Promise<{ address: Address; provider: EIP1193Provider }> {
  const eth = (window as any).ethereum as EIP1193Provider | undefined;
  if (!eth) throw new Error("No wallet found. Install MetaMask (or any EIP-1193 wallet).");
  await eth.request({ method: "wallet_addEthereumChain", params: [{
    chainId: "0x13b2", chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: [ARC.rpcUrl], blockExplorerUrls: [ARC.explorer],
  }] }).catch(() => {});
  await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13b2" }] }).catch(() => {});
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  return { address: getAddress(address), provider: eth };
}

export const txUrl = (h: string) => `${ARC.explorer}/tx/${h}`;
export const addrUrl = (a: string) => `${ARC.explorer}/address/${a}`;
