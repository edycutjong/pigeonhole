<div align="center">

# ▦ Pigeonhole

### A fresh USDC deposit address per invoice — with no private key to guard

Every invoice gets its own Arc address that exists *before any contract does*. When it's paid, one
permissionless transaction sweeps it to your treasury and the address disappears — reusable forever,
with no key anywhere in the system.

**[▶ Live on Arc mainnet](https://edycutjong.github.io/pigeonhole-arc/)** · [Factory `0x942b8c10…9A40`](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40) · [Demo & proof](./DEMO.md) · [Architecture](./ARCHITECTURE.md)

![Arc mainnet](https://img.shields.io/badge/Arc-mainnet%205042-4ea1ff) ![USDC-as-gas](https://img.shields.io/badge/gas-USDC-3ddc84) ![tests](https://img.shields.io/badge/tests-31%20passing-3ddc84) ![license](https://img.shields.io/badge/license-MIT-blue)

</div>

## The problem

A merchant or exchange that wants one deposit address per customer/invoice does it the hard way:
HD-derived addresses, each a private key to generate, store, guard, and later sign a sweep with.
Circle's own exchange-integration guide prescribes exactly this. Keys are the liability.

## What Pigeonhole does

The deposit address is a **counterfactual `CREATE2` address** — computable offline, with no code and
no key. It receives USDC like any address. To collect, anyone calls `sweep(salt)`: the factory deploys
a 22-byte throwaway (`PUSH20 treasury; SELFDESTRUCT`) at that exact address; its constructor moves the
whole balance to an **immutable treasury** and self-destructs in the same transaction. EIP-6780 fully
deletes it, so the address returns to *no code, nonce 0* and can be paid and swept again forever.

**There is no private key for any deposit address, and funds can only ever reach the treasury.**

## Why this needs Arc — and only Arc

It uses **Arc for the one property no other EVM chain has: USDC *is* the native balance.**

- On Arc, a codeless address holds native USDC and `SELFDESTRUCT` moves it (docs: *"SELFDESTRUCT is allowed on Arc, including during contract deployment"* and moves the native balance). On every other EVM chain USDC is an ERC-20 in the token contract — a self-destruct can't touch it, so the whole mechanism is impossible.
- **USDC-as-gas** → deposit addresses, sweeps, and the merchant all live in one asset; no ETH, ever.
- **EIP-7708 native `Transfer` logs** from the system emitter → "PAID" is a single `eth_getLogs`; **no backend, no database, no indexer.**
- **Deterministic finality** → a payment is final in the block that includes it; the page polls the log every 3 s and never shows a confirmation counter. (Latency was not benchmarked — see `DEMO.md`.)

Take Arc out and you'd need: a key-management service (HD wallets + signing), an ERC-20 sweep contract per address or a hot wallet, an indexer to detect payments, and a separate gas token. Pigeonhole replaces all four with one 61-line contract and a static page.

## Proof (all on mainnet)

- **Verified live:** `npm run verify` — offline `predict()` byte-matches on-chain `predict()` for 50 random ids, and invariant I2 (Σin − Σout == balance) holds for both seeded invoices. No wallet needed. The page runs the same I2 check on every refresh and shows it.
- **31 tests:** 12 Foundry (incl. a fuzz test + invariants I1 no-code-after-sweep, I3 funds-only-to-treasury) + 19 vitest (offline formula vs real on-chain addresses, the no-DB reducer, decimals, and six regression tests named for the `eth_getLogs` defects they pin: the 10k-block cap, poll overlap, RPC head skew, re-created invoice ids).
- **Benchmark (invariant I4):** a balance-moving sweep on the production factory costs **64,162 gas (p50) ≈ $0.0013** — N=25 in `bench/results.json`, min 64,150 when the salt happens to contain a zero byte (calldata pricing, not execution); the probe factory, a different contract, measures 64,140.
- **Edge cases with tx links** (re-pay after sweep, empty sweep, native send **and** ERC-20 `transfer()` payment — both flip PAID from the same system-emitter log): [`DEMO.md`](./DEMO.md).

## Run it
```sh
npm install
npm run verify                 # read-only proof, no wallet
npm test                       # 19 vitest
forge test --root contracts    # 12 contract tests (forge-std is a submodule: clone with --recurse-submodules or run `git submodule update --init`)
npm run dev                    # the page locally
```

## Who this is for
Exchanges, PSPs, and invoicing tools that need per-customer deposit addresses without a key-management
system. Pigeonhole is the deposit primitive; the same Arc properties make a small family of
key-optional payment primitives possible.

## What's next
- **Batch reconciliation** across thousands of invoices from `Swept` events alone.
- A **primitive family** on the same Arc foundations: keeper-less standing orders (exact gas reimbursed in USDC), exactly-once payment keys, and card-style authorize/capture holds.

## What we got wrong (dated, kept here rather than edited away)
- **2026-09-17 — the `eth_getLogs` cap.** Day-2 code assumed the RPC allowed 100k-block spans; it allows 9,999 (10,000 → `-32012`). At ~2 blocks/s the live page would have frozen at "UNPAID" a few hours after deploy. Found by a pre-submission audit, fixed the same evening: every scan is chunked at 9,000 blocks, polled incrementally, and invoice URLs carry their creation block (`?from=`). Three regression tests pin it.
- **2026-09-17 — "first-sweep cost 91,740".** The probe notes read the v1 sweep's 91,740 gas as the cost of sweeping a never-seen *address*. The bench refuted that: all 25 first sweeps cost 64,150–64,162. The extra 27,600 was the never-seen *beneficiary* (v1's wrong treasury). `DEMO.md` now says so.
- **2026-09-17 — "64,140 corrected to 64,162".** Not a correction: 64,140 is the probe factory's bytecode, 64,162 is this one's. Different contracts, both right.

## Limitations (honest)
- The treasury's immutability is also a **single point of failure**: if it were ever blocklisted, unswept invoices freeze until it's unblocked; recovery means a new factory.
- The static page needs an **anonymous Arc RPC** (worked on 2026-09-17; the docs call early-mainnet RPC "permissioned"), and it scans logs in 9,000-block chunks — an invoice URL without `?from=` scans from the factory's deploy block, which gets slower every day (~19 chunks ≈ 38 `eth_getLogs` calls per day of chain); the treasury view always scans from the deploy block.
- **Not built:** per-invoice unswept totals and a *Sweep all* button in the treasury view (`sweepMany` exists on-chain and is tested; the page calls `sweep` only). PAID latency is not benchmarked.
- The `?amt=` amount is the merchant's claim — the chain proves what was *paid*.

## License
MIT · built for the Arc Microgrants program, Sep 2026. Thank you for reviewing.
