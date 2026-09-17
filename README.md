<div align="center">

# ▦ Pigeonhole

### A fresh USDC deposit address per invoice — with no private key to guard

Every invoice gets its own Arc address that exists *before any contract does*. When it's paid, one
permissionless transaction sweeps it to your treasury and the address disappears — reusable forever,
with no key anywhere in the system.

**[▶ Live on Arc mainnet](https://edycutjong.github.io/pigeonhole-arc/)** · [Factory `0x942b8c10…9A40`](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40) · [Demo & proof](./DEMO.md) · [Architecture](./ARCHITECTURE.md)

![Arc mainnet](https://img.shields.io/badge/Arc-mainnet%205042-4ea1ff) ![USDC-as-gas](https://img.shields.io/badge/gas-USDC-3ddc84) ![tests](https://img.shields.io/badge/tests-25%20passing-3ddc84) ![license](https://img.shields.io/badge/license-MIT-blue)

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
- **Deterministic sub-second finality** → PAID flips within one block, no confirmation spinner.

Take Arc out and you'd need: a key-management service (HD wallets + signing), an ERC-20 sweep contract per address or a hot wallet, an indexer to detect payments, and a separate gas token. Pigeonhole replaces all four with one 61-line contract and a static page.

## Proof (all on mainnet)

- **Verified live:** `npm run verify` — offline `predict()` byte-matches on-chain `predict()` for 50 random ids, and invariant I2 (Σin − Σout == balance) holds. No wallet needed.
- **25 tests:** 12 Foundry (incl. a fuzz test + invariants I1 post-sweep-delete, I3 funds-only-to-treasury) + 13 vitest (offline formula vs real on-chain addresses, the no-DB reducer, decimals).
- **Benchmark (invariant I4):** steady-state balance-moving sweep ≈ **64,162 gas ≈ $0.0013** — see `bench/results.json` (N-sample; the spec pre-stated 64,140 from one probe, corrected here).
- **Edge cases with tx links** (re-pay after sweep, empty sweep, native vs ERC-20 payment): [`DEMO.md`](./DEMO.md).

## Run it
```sh
cd build && npm install
npm run verify                 # read-only proof, no wallet
cd contracts && forge test     # 12 contract tests
npm run dev                    # the page locally
```

## Who this is for
Exchanges, PSPs, and invoicing tools that need per-customer deposit addresses without a key-management
system. Pigeonhole is the deposit primitive; the same Arc properties make a small family of
key-optional payment primitives possible.

## What's next
- **Batch reconciliation** across thousands of invoices from `Swept` events alone.
- A **primitive family** on the same Arc foundations: keeper-less standing orders (exact gas reimbursed in USDC), exactly-once payment keys, and card-style authorize/capture holds.

## Limitations (honest)
- The treasury's immutability is also a **single point of failure**: if it were ever blocklisted, unswept invoices freeze until it's unblocked; recovery means a new factory.
- The static page needs an **anonymous Arc RPC** (worked on 2026-09-17; the docs call early-mainnet RPC "permissioned").
- The `?amt=` amount is the merchant's claim — the chain proves what was *paid*.

## License
MIT · built for the Arc Microgrants program, Sep 2026. Thank you for reviewing.
