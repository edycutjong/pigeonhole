// Property-based verification (fast-check) of the two decisions that must never be wrong:
//   1. reduceLogs — the no-database ledger that decides UNPAID / PAID / SWEPT from raw system-emitter logs
//   2. predict    — the offline CREATE2 arithmetic a merchant hands to a payer before any code exists
// Plus the eth_getLogs chunker, whose one job is to never ask the RPC for a 10,000-block span.
// Every property runs NUM_RUNS random cases — 4 × NUM_RUNS = 20,000 verified cases per `npm test`.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getAddress, getContractAddress, keccak256, type Address, type Hex } from "viem";
import { predict, initCode, reduceLogs, type Movement } from "../src/lib/pigeonhole";
import { spans, MAX_LOG_SPAN } from "../src/lib/logs";

export const NUM_RUNS = 5_000;
const run = { numRuns: NUM_RUNS };

const hex = (n: number) => fc.uint8Array({ minLength: n, maxLength: n }).map((b) => ("0x" + Buffer.from(b).toString("hex")) as Hex);
const arbAddress = hex(20).map((h) => getAddress(h));
const arbSalt = hex(32);
const PH = getAddress("0xb356C620E45d8d8C884a6235dD660c32f0a1F26b");

/** A movement touching the pigeonhole (in OR out); the counterparty is never the pigeonhole itself (a self-send emits no log). */
const arbMovement = (ph: Address) =>
  fc.record({
    dir: fc.constantFrom("in", "out"),
    other: arbAddress.filter((a) => a !== ph),
    value: fc.bigInt({ min: 0n, max: 10n ** 24n }),
    block: fc.bigInt({ min: 21_337_182n, max: 21_337_182n + 10_000_000n }),
    logIndex: fc.nat({ max: 500 }),
    tx: hex(32),
  }).map(({ dir, other, value, block, logIndex, tx }): Movement =>
    dir === "in" ? { block, logIndex, tx, from: other, to: ph, value } : { block, logIndex, tx, from: ph, to: other, value });

describe(`property-based verification — ${NUM_RUNS} cases per property`, () => {
  it("ledger: unswept == Σin − Σout, SWEPT only at exactly zero after a payment, PAID never below the asked amount", () => {
    fc.assert(
      fc.property(fc.array(arbMovement(PH), { maxLength: 40 }), fc.option(fc.bigInt({ min: 1n, max: 10n ** 24n }), { nil: undefined }), (moves, asked) => {
        const s = reduceLogs(PH, moves, asked);
        const sumIn = moves.filter((m) => m.to === PH).reduce((a, m) => a + m.value, 0n);
        const sumOut = moves.filter((m) => m.from === PH).reduce((a, m) => a + m.value, 0n);
        expect(s.paidIn).toBe(sumIn);
        expect(s.sweptOut).toBe(sumOut);
        expect(s.unswept).toBe(sumIn - sumOut);
        if (s.status === "SWEPT") { expect(s.paidIn).toBeGreaterThan(0n); expect(s.unswept).toBe(0n); }
        if (s.status === "PAID") { expect(s.unswept).toBeGreaterThan(0n); if (asked !== undefined) expect(s.unswept >= asked).toBe(true); }
        if (s.status === "UNPAID") expect(asked !== undefined ? s.unswept < asked || s.paidIn === 0n : s.unswept <= 0n).toBe(true);
      }),
      run,
    );
  });

  it("ledger: the state is order-independent — any permutation of the same logs yields the same status and totals", () => {
    fc.assert(
      fc.property(fc.array(arbMovement(PH), { maxLength: 30 }).chain((ms) => fc.tuple(fc.constant(ms), fc.shuffledSubarray(ms, { minLength: ms.length, maxLength: ms.length }))), ([a, b]) => {
        const sa = reduceLogs(PH, a), sb = reduceLogs(PH, b);
        expect(sb.status).toBe(sa.status);
        expect(sb.unswept).toBe(sa.unswept);
        expect(sb.payments.map((m) => m.tx + m.logIndex)).toEqual(sa.payments.map((m) => m.tx + m.logIndex)); // canonical (block, logIndex) order
      }),
      run,
    );
  });

  it("predict: the hand-rolled CREATE2 arithmetic equals viem's independent getContractAddress for any factory/treasury/salt", () => {
    fc.assert(
      fc.property(arbAddress, arbAddress, arbSalt, (factory, treasury, salt) => {
        const expected = getContractAddress({ opcode: "CREATE2", from: factory, salt, bytecodeHash: keccak256(initCode(treasury)) });
        expect(predict(factory, treasury, salt)).toBe(getAddress(expected));
      }),
      run,
    );
  });

  it("spans: every chunk is < 10,000 blocks and the chunks tile [from, to] exactly once, for any range", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 9n }), fc.bigInt({ min: 0n, max: 300_000n }), (from, width) => {
        const to = from + width;
        const cs = [...spans(from, to)];
        let cursor = from;
        for (const [a, b] of cs) { expect(a).toBe(cursor); expect(b - a + 1n <= MAX_LOG_SPAN).toBe(true); expect(b - a + 1n < 10_000n).toBe(true); cursor = b + 1n; }
        expect(cursor).toBe(to + 1n);
      }),
      run,
    );
  }, 30_000);
});
