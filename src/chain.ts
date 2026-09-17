// viem clients + Arc chain def + the RPC-capped log fetch the page depends on.
import { createPublicClient, http, defineChain, getAddress, parseAbi,
  type Address, type EIP1193Provider } from "viem";
import { ARC, reduceLogs, type InvoiceState } from "./lib/pigeonhole";
import { MovementCache, MAX_LOG_SPAN, spans } from "./lib/logs";
import deployment from "../deployments/arc-mainnet.json";

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

export const pub = createPublicClient({ chain: arc, transport: http(ARC.rpcUrl) });
export const factoryAbi = parseAbi([
  "function predict(bytes32) view returns (address)",
  "function sweep(bytes32) returns (address)",
  "function sweepMany(bytes32[])",
  "function treasury() view returns (address)",
  "event Swept(bytes32 indexed salt, address indexed pigeonhole, uint256 amount)",
]);

// The public RPC rejects eth_getLogs spans of 10,000+ blocks (-32012) — see src/lib/logs.ts. Every scan is chunked
// and the invoice view polls incrementally through this cache.
const cache = new MovementCache(pub);

/**
 * Full state for one pigeonhole, from the system emitter only (no double-count of the 6-dec ERC-20 log).
 * `fromBlock` is the block the invoice was created at (carried in the URL as ?from=); without it we scan from the
 * factory's deploy block, which gets slower as the chain grows (~170k blocks/day at 2 blocks/s).
 */
export async function invoiceState(pigeonhole: Address, amount18?: bigint, fromBlock: bigint = DEPLOY_BLOCK): Promise<InvoiceState> {
  const movements = await cache.movements(pigeonhole, fromBlock < DEPLOY_BLOCK ? DEPLOY_BLOCK : fromBlock);
  return reduceLogs(pigeonhole, movements, amount18);
}

/** All Swept events from the factory → the treasury view's source of truth. */
export async function sweptEvents() {
  const latest = await pub.getBlockNumber();
  const out: any[] = [];
  for (const [a, b] of spans(DEPLOY_BLOCK, latest, MAX_LOG_SPAN)) {
    const logs = await pub.getContractEvents({ address: FACTORY, abi: factoryAbi, eventName: "Swept", fromBlock: a, toBlock: b });
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
