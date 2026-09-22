import { describe, it, expect } from "vitest";
import { predict, saltOf, addressForInvoice, reduceLogs, fmtUsdc18, initCode, knownPigeonholes, openInvoices, ARC, type Movement } from "../src/lib/pigeonhole";
import type { Address, Hex } from "viem";

// Known on-chain vectors from _specs/probes.md and the production deploy (build/deployments/arc-mainnet.json).
const PROBE_FACTORY = "0x51603EEfD23fda702c1ba3e93f908b8fA638e7d5" as Address;
const TREASURY = "0xA8965A47c9b6ed34F47B374f36cF6c752D24852a" as Address;
const PROD_FACTORY = "0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40" as Address;

describe("predict — matches on-chain address formula (I3)", () => {
  it("reproduces the probe pigeonhole 0x395ed6…", () => {
    // probes.md P6 row: salt = keccak("arc-microgrants-p6-invoice-1") → 0x395ed6ccDf3423E75FA15b616Ee8dAe753070a5E
    const salt = saltOf("arc-microgrants-p6-invoice-1");
    expect(predict(PROBE_FACTORY, TREASURY, salt).toLowerCase())
      .toBe("0x395ed6ccDf3423E75FA15b616Ee8dAe753070a5E".toLowerCase());
  });

  it("reproduces the production demo-paid pigeonhole 0xb356C6…", () => {
    // deployments/arc-mainnet.json firstCycle: salt keccak("demo-paid") → 0xb356C620E45d8d8C884a6235dD660c32f0a1F26b
    expect(addressForInvoice(PROD_FACTORY, TREASURY, "demo-paid").toLowerCase())
      .toBe("0xb356C620E45d8d8C884a6235dD660c32f0a1F26b".toLowerCase());
  });

  it("is deterministic and salt-sensitive", () => {
    const s = saltOf("x");
    expect(predict(PROD_FACTORY, TREASURY, s)).toBe(predict(PROD_FACTORY, TREASURY, s));
    expect(predict(PROD_FACTORY, TREASURY, saltOf("a"))).not.toBe(predict(PROD_FACTORY, TREASURY, saltOf("b")));
  });

  it("changes with the treasury", () => {
    const s = saltOf("x");
    expect(predict(PROD_FACTORY, TREASURY, s)).not.toBe(predict(PROD_FACTORY, "0x000000000000000000000000000000000000dEaD", s));
  });
});

describe("initCode", () => {
  it("is 22 bytes: 0x73 ++ treasury ++ 0xff", () => {
    const ic = initCode(TREASURY);
    expect(ic.length).toBe(2 + 22 * 2); // "0x" + 22 bytes hex
    expect(ic.slice(0, 4)).toBe("0x73");
    expect(ic.slice(-2)).toBe("ff");
    expect(ic.toLowerCase()).toContain(TREASURY.slice(2).toLowerCase());
  });
});

const mv = (block: bigint, logIndex: number, from: Address, to: Address, value: bigint): Movement =>
  ({ block, logIndex, tx: "0x00" as Hex, from, to, value });

describe("reduceLogs — the no-database ledger (I2)", () => {
  const P = "0xb356C620E45d8d8C884a6235dD660c32f0a1F26b" as Address;
  const PAYER = "0x1111111111111111111111111111111111111111" as Address;

  it("UNPAID with no logs", () => {
    expect(reduceLogs(P, []).status).toBe("UNPAID");
  });

  it("PAID after a payment in, unswept == balance", () => {
    const s = reduceLogs(P, [mv(1n, 0, PAYER, P, 20n * 10n ** 15n)]); // 0.02
    expect(s.status).toBe("PAID");
    expect(s.paidIn).toBe(20n * 10n ** 15n);
    expect(s.unswept).toBe(20n * 10n ** 15n);
    expect(s.payments).toHaveLength(1);
  });

  it("respects the merchant amount claim for PAID", () => {
    const partial = reduceLogs(P, [mv(1n, 0, PAYER, P, 5n * 10n ** 15n)], 20n * 10n ** 15n);
    expect(partial.status).toBe("UNPAID"); // 0.005 < 0.02 asked
    const enough = reduceLogs(P, [mv(1n, 0, PAYER, P, 20n * 10n ** 15n)], 20n * 10n ** 15n);
    expect(enough.status).toBe("PAID");
  });

  it("SWEPT when paid then fully swept out", () => {
    const s = reduceLogs(P, [
      mv(1n, 0, PAYER, P, 20n * 10n ** 15n),
      mv(2n, 3, P, TREASURY, 20n * 10n ** 15n),
    ]);
    expect(s.status).toBe("SWEPT");
    expect(s.unswept).toBe(0n);
    expect(s.sweeps).toHaveLength(1);
  });

  it("re-pay after sweep → PAID again (the reuse property, probe rows 4-5)", () => {
    const s = reduceLogs(P, [
      mv(1n, 0, PAYER, P, 10n * 10n ** 15n),
      mv(2n, 0, P, TREASURY, 10n * 10n ** 15n),
      mv(9n, 0, PAYER, P, 10n * 10n ** 15n), // later payment to the same address
    ]);
    expect(s.status).toBe("PAID");
    expect(s.unswept).toBe(10n * 10n ** 15n);
  });

  it("orders by (block, logIndex), not insertion", () => {
    const s = reduceLogs(P, [
      mv(2n, 0, P, TREASURY, 10n ** 15n),
      mv(1n, 0, PAYER, P, 10n ** 15n),
    ]);
    expect(s.payments[0].block).toBe(1n);
    expect(s.status).toBe("SWEPT");
  });
});

describe("fmtUsdc18 — 18-dec → 6-dec USDC display, no truncation of stored value", () => {
  it("formats whole and fractional", () => {
    expect(fmtUsdc18(20n * 10n ** 15n)).toBe("0.020000"); // 0.02
    expect(fmtUsdc18(10n ** 18n)).toBe("1.000000");
    expect(fmtUsdc18(1n)).toBe("0.000000"); // sub-microcent rounds to 0 in the 6-dec view but stored value is 1
    expect(fmtUsdc18(1234567n * 10n ** 12n)).toBe("1.234567");
  });
});

describe("ARC constants", () => {
  it("chain id and system emitter", () => {
    expect(ARC.chainId).toBe(5042);
    expect(ARC.systemEmitter).toBe("0xfffffffffffffffffffffffffffffffffffffffe");
  });
});

describe("knownPigeonholes / openInvoices — the treasury view's Sweep all set", () => {
  const F = "0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40" as const, T = "0xA8965A47c9b6ed34F47B374f36cF6c752D24852a" as const;
  const a = addressForInvoice(F, T, "a"), b = addressForInvoice(F, T, "b"), c = addressForInvoice(F, T, "c");
  it("unions Swept salts with browser invoices, de-duplicated by address, and keeps the id when both know it", () => {
    const known = knownPigeonholes(
      [{ salt: saltOf("a"), pigeonhole: a }, { salt: saltOf("b"), pigeonhole: b.toLowerCase() as any }, { salt: saltOf("a"), pigeonhole: a }],
      [{ id: "b", pigeonhole: b }, { id: "c", pigeonhole: c }],
    );
    expect(known.map((k) => k.pigeonhole)).toEqual([a, b, c]);
    expect(known.map((k) => k.id)).toEqual([undefined, "b", "c"]);
    expect(known[1].salt).toBe(saltOf("b"));
  });
  it("keeps only funded addresses, largest first, and totals what one sweepMany would move", () => {
    const known = knownPigeonholes([], [{ id: "a", pigeonhole: a }, { id: "b", pigeonhole: b }, { id: "c", pigeonhole: c }]);
    const { open, total } = openInvoices(known, [5n * 10n ** 15n, 0n, 20n * 10n ** 15n]);
    expect(open.map((o) => o.id)).toEqual(["c", "a"]);
    expect(total).toBe(25n * 10n ** 15n);
  });
  it("a missing balance counts as 0 (a getBalance that failed must not put an address into the sweep)", () => {
    const { open, total } = openInvoices(knownPigeonholes([], [{ id: "a", pigeonhole: a }, { id: "b", pigeonhole: b }]), [1n]);
    expect(open.map((o) => o.id)).toEqual(["a"]); expect(total).toBe(1n);
  });
});
