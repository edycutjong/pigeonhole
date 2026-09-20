# For reviewers — `JUDGE.md`

Live mirror of this page: **https://pigeonhole.edycu.dev/#/judge** (no auth, no wallet needed to render).

> **A fresh USDC deposit address per invoice, no key to guard, swept in one transaction. Live on Arc mainnet.**

## The 60-second path (one Arc wallet holding ≥ 0.05 USDC; total cost ≤ $0.10)
1. Open **https://pigeonhole.edycu.dev/** → type any invoice id and `0.02` → **Create deposit address**. No transaction: the address is `CREATE2(factory, keccak256(id), treasury)`, computed offline.
2. Open that address on https://explorer.arc.io — an empty account: no code, nonce 0.
3. **Pay with wallet** (or send 0.02 USDC from any Arc wallet). The badge flips **PAID** on the next 3-second poll — one `eth_getLogs` on the system emitter `0xffff…fffE`. No backend, no database.
4. **Sweep → treasury**. One transaction (≈ $0.0013): the 22-byte throwaway is born at that exact address, its constructor moves the whole balance to the immutable treasury and self-destructs — same tx. The address is back to no code, nonce 0, and can be paid again.
5. **Treasury** view lists the sweep from the factory's `Swept` events.

## No wallet? Read the receipts (all on Arc mainnet, chain 5042)
| What | Tx |
|---|---|
| Pay `demo-paid` — 0.02 USDC native send to the codeless address (production factory) | [`0x5fdef1b0…`](https://explorer.arc.io/tx/0x5fdef1b0d140e493152a26ed361d3c185b024987987cf79e0de79becc9dad59f) |
| Its sweep — 64,162 gas ≈ $0.0013, `Transfer(pigeonhole → treasury)` + `Swept` | [`0xe639255a…`](https://explorer.arc.io/tx/0xe639255a52b96c7f4733608776f6cd11eca3c615748350877d2ea384a6988ea6) |
| Pay a codeless predicted address (native send) — day-0 probe factory | [`0xc80df136…`](https://explorer.arc.io/tx/0xc80df1360ab2cd4851b998d323840f6bfee1317a61fd0bfea48856ff711bfbd3) |
| Pay via ERC-20 `transfer()` (two logs; the page counts one) | [`0x64ce87be…`](https://explorer.arc.io/tx/0x64ce87be84ef57938c0af91b7c6a89c9eb736ff3a8627dbf2c4f1a069a936a64) |
| Its sweep — same 64,162 gas | [`0xf5883aea…`](https://explorer.arc.io/tx/0xf5883aeae9a0c872241de57b348ebe688bf6f80b58542f7d5166bfc24b5f8111) |
| Re-pay an already-swept address (later tx) — probe factory | [`0x531f09ff…`](https://explorer.arc.io/tx/0x531f09ffacdd006cb7c3f5c009e665ca62331c03cc867ebf5bdef2ef7cd6a76c) |
| Re-sweep it — 64,140 gas (the probe factory's bytecode) | [`0x631814ad…`](https://explorer.arc.io/tx/0x631814adf42ce99763ac5ca53859e0b0f677538707a6246a23843bb4e83fef51) |

Full edge-case table with the empty-sweep and never-seen-beneficiary cases: [`DEMO.md`](./DEMO.md).

## Receipt block
| | |
|---|---|
| Factory | [`0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40`](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40) (deployed via the deterministic CREATE2 factory, 266,797 gas) |
| Source | unverified on the explorer (its API is behind a Cloudflare challenge) — but the on-chain runtime code is byte-identical to `forge build` output, keccak `0x8806de8d…`, see [`DEMO.md`](./DEMO.md#source-verification-honest-status) |
| Treasury | [`0xA8965A47c9b6ed34F47B374f36cF6c752D24852a`](https://explorer.arc.io/address/0xA8965A47c9b6ed34F47B374f36cF6c752D24852a) |
| Sweep gas | **64,162 p50** (N=25 in [`bench/results.json`](./bench/results.json); min 64,150 — salts with a zero byte) ≈ **$0.0013** |
| Tests | **37** — 12 Foundry (fuzz + invariants I1/I3) + 25 vitest (8 regression tests named for the `eth_getLogs` defects they pin) |
| Property cases | **20,000** fast-check cases per `npm test`: ledger identity Σin−Σout, order-independence, `predict` vs viem's independent CREATE2, chunker never ≥ 10,000 blocks |
| E2E | 34 Playwright checks across desktop + mobile, read-only against mainnet (`/judge` with no session, the seeded `demo-paid` cycle reading SWEPT, the treasury view) |
| Backend | none — PAID/SWEPT are `eth_getLogs` on the system emitter; the page checks invariant I2 (Σlogs == `eth_getBalance`) live on every poll |
| Keys held | **0** |

## Reproduce (read-only, no wallet)
```sh
git clone --recurse-submodules https://github.com/edycutjong/pigeonhole && cd pigeonhole
npm install
npm run verify              # offline predict() == on-chain predict() for 50 random ids; invariant I2 for both seeded cycles
npm test                    # 25 vitest incl. 20,000 property cases
forge test --root contracts # 12 contract tests
npm run e2e                 # Playwright against the production bundle
```
The gas benchmark is the only thing that spends: `KS=… PW=… N=25 R=8 zsh scripts/bench.sh` (≈ $0.05 of USDC on Arc).

## Honest limitations
- The immutable treasury is a **single point of failure**: if it were blocklisted, unswept invoices freeze until a new factory is deployed.
- The static page needs an **anonymous Arc RPC** and scans logs in 9,000-block chunks — an invoice URL without `?from=` scans from the deploy block and gets slower every day; the treasury view always does.
- **PAID latency is not benchmarked**; `sweepMany` is on-chain and tested but the page calls `sweep` only.
- The `?amt=` is the merchant's claim — the chain proves what was *paid*.

## Links
Repo: https://github.com/edycutjong/pigeonhole · Live: https://pigeonhole.edycu.dev/ · [DEMO.md](./DEMO.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail)
