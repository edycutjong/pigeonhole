// Pigeonhole — pure client logic. No backend: every value here is derived from chain data.
// The offline `predict` must byte-match the on-chain PigeonholeFactory.predict (verified by scripts/verify.ts).
import { type Address, type Hex, keccak256, encodePacked, getAddress, concatHex, pad, slice } from "viem";

/** Arc mainnet facts (arc_references_contract-addresses.md, usdc-system-events.md). */
export const ARC = {
  chainId: 5042,
  rpcUrl: "https://rpc.mainnet.arc.io",
  explorer: "https://explorer.arc.io",
  /** EIP-7708 native-value Transfer logs come from this system emitter (18 decimals). */
  systemEmitter: "0xfffffffffffffffffffffffffffffffffffffffe" as Address,
  /** keccak256("Transfer(address,address,uint256)") */
  transferTopic: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex,
} as const;

/** saltOf(invoiceId) = keccak256(utf8 bytes of the id). The merchant chooses the id. */
export function saltOf(invoiceId: string): Hex {
  return keccak256(new TextEncoder().encode(invoiceId));
}

/** The 22-byte sweeper init-code: PUSH20 <treasury>; SELFDESTRUCT. */
export function initCode(treasury: Address): Hex {
  return encodePacked(["bytes1", "address", "bytes1"], ["0x73", treasury, "0xff"]);
}

/** Offline CREATE2 address = last 20 bytes of keccak256(0xff ++ factory ++ salt ++ keccak256(initCode)). */
export function predict(factory: Address, treasury: Address, salt: Hex): Address {
  const initHash = keccak256(initCode(treasury));
  const packed = concatHex(["0xff", factory, salt, initHash]);
  return getAddress(slice(keccak256(packed), 12)); // last 20 bytes
}

/** Convenience: predict straight from a human invoice id. */
export function addressForInvoice(factory: Address, treasury: Address, invoiceId: string): Address {
  return predict(factory, treasury, saltOf(invoiceId));
}

export type Movement = {
  block: bigint;
  logIndex: number;
  tx: Hex;
  from: Address;
  to: Address;
  value: bigint; // 18-dec native units
};

export type Status = "UNPAID" | "PAID" | "SWEPT";

export type InvoiceState = {
  pigeonhole: Address;
  amount18?: bigint; // merchant's claim from the URL; the chain proves what was actually paid
  paidIn: bigint;
  sweptOut: bigint;
  unswept: bigint; // I2: must equal eth_getBalance(pigeonhole)
  status: Status;
  payments: Movement[];
  sweeps: Movement[];
};

/**
 * Reduce system-emitter Transfer logs for ONE pigeonhole into an invoice state.
 * Count only the system emitter (0xffff…fffE); an ERC-20 transfer() also logs from 0x3600…0000
 * at 6 decimals and must not be double-counted. Ordering is (block, logIndex), never timestamp.
 */
export function reduceLogs(pigeonhole: Address, movements: Movement[], amount18?: bigint): InvoiceState {
  const p = getAddress(pigeonhole);
  const sorted = [...movements].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  const payments: Movement[] = [];
  const sweeps: Movement[] = [];
  let paidIn = 0n;
  let sweptOut = 0n;
  for (const m of sorted) {
    if (getAddress(m.to) === p) { payments.push(m); paidIn += m.value; }
    else if (getAddress(m.from) === p) { sweeps.push(m); sweptOut += m.value; }
  }
  const unswept = paidIn - sweptOut;
  let status: Status = "UNPAID";
  if (paidIn > 0n && unswept === 0n) status = "SWEPT";
  else if (amount18 !== undefined ? unswept >= amount18 : unswept > 0n) status = "PAID";
  return { pigeonhole: p, amount18, paidIn, sweptOut, unswept, status, payments, sweeps };
}

/** 18-dec native units → a 6-decimal USDC string, with no truncation of the stored value. */
export function fmtUsdc18(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10n ** 18n;
  const frac6 = (a % 10n ** 18n) / 10n ** 12n; // to 6 decimals
  const s = `${whole}.${frac6.toString().padStart(6, "0")}`;
  return neg ? `-${s}` : s;
}
