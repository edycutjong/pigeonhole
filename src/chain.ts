// viem clients + Arc chain def + the RPC-capped log fetch the page depends on.
import { createPublicClient, http, custom, defineChain, getAddress, parseAbi,
  type Address, type Hex, type EIP1193Provider } from "viem";
import { ARC, reduceLogs, type Movement, type InvoiceState } from "./lib/pigeonhole";
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

const transferEvent = {
  type: "event", name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const MAX_RANGE = 90_000n; // RPC caps eth_getLogs at 100k blocks / 2000 results — we filter by topic so results stay tiny

async function getLogsChunked(args: { address: Address; argFilter: { to?: Address; from?: Address } }) {
  const latest = await pub.getBlockNumber();
  const out: any[] = [];
  for (let start = DEPLOY_BLOCK; start <= latest; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE > latest ? latest : start + MAX_RANGE;
    const logs = await pub.getLogs({ address: args.address, event: transferEvent, args: args.argFilter, fromBlock: start, toBlock: end });
    out.push(...logs);
  }
  return out;
}

function toMovements(logs: any[]): Movement[] {
  return logs.map((l) => ({
    block: l.blockNumber as bigint, logIndex: l.logIndex as number, tx: l.transactionHash as Hex,
    from: getAddress(l.args.from as Address), to: getAddress(l.args.to as Address), value: l.args.value as bigint,
  }));
}

/** Full state for one pigeonhole, from the system emitter only (no double-count of the 6-dec ERC-20 log). */
export async function invoiceState(pigeonhole: Address, amount18?: bigint): Promise<InvoiceState> {
  const [inLogs, outLogs] = await Promise.all([
    getLogsChunked({ address: ARC.systemEmitter, argFilter: { to: pigeonhole } }),
    getLogsChunked({ address: ARC.systemEmitter, argFilter: { from: pigeonhole } }),
  ]);
  return reduceLogs(pigeonhole, toMovements([...inLogs, ...outLogs]), amount18);
}

/** All Swept events from the factory → the treasury view's source of truth. */
export async function sweptEvents() {
  const latest = await pub.getBlockNumber();
  const out: any[] = [];
  for (let start = DEPLOY_BLOCK; start <= latest; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE > latest ? latest : start + MAX_RANGE;
    const logs = await pub.getContractEvents({ address: FACTORY, abi: factoryAbi, eventName: "Swept", fromBlock: start, toBlock: end });
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
