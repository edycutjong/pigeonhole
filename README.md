<div align="center">

<img src="docs/assets/icon-animated.svg" alt="Pigeonhole" width="144" height="144">

# Pigeonhole

### A fresh USDC deposit address per invoice — with no private key to guard

Every invoice gets its own Arc address that exists *before any contract does*. When it's paid, one
permissionless transaction sweeps it to your treasury and the address disappears — reusable forever,
with no key anywhere in the system.

<img src="docs/assets/readme-hero-animated.svg" alt="A throwaway contract is born at the codeless address, sweeps its USDC into the treasury, and vanishes." width="100%">

<br/>

[![Live on Arc mainnet](https://img.shields.io/badge/▶_Live-Arc_mainnet-06b6d4?style=for-the-badge)](https://pigeonhole.edycu.dev/)
[![For reviewers](https://img.shields.io/badge/⚖_For-reviewers-3ddc84?style=for-the-badge)](https://pigeonhole.edycu.dev/#/judge)
[![Demo video](https://img.shields.io/badge/▶_Demo-2:30_on_YouTube-FF0000?style=for-the-badge)](https://youtu.be/BGuzotTXQEA)
[![Pitch deck](https://img.shields.io/badge/📽️_Pitch-Deck_12_slides-06b6d4?style=for-the-badge)](https://pigeonhole.edycu.dev/deck.html)
[![Factory on explorer](https://img.shields.io/badge/🏭_Factory-0x942b…9A40-4ea1ff?style=for-the-badge)](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40)
[![Arc Microgrants](https://img.shields.io/badge/DoraHacks-Arc_Microgrants-8b5cf6?style=for-the-badge)](https://dorahacks.io/hackathon/arc-microgrants/detail)
[![BUIDL](https://img.shields.io/badge/BUIDL-49026-8b5cf6?style=for-the-badge)](https://dorahacks.io/buidl/49026)

<br/>

![Arc](https://img.shields.io/badge/Arc-mainnet_5042-4ea1ff?style=flat)
![USDC-as-gas](https://img.shields.io/badge/gas-USDC-3ddc84?style=flat)
![Solidity](https://img.shields.io/badge/Solidity_0.8.30-363636?style=flat&logo=solidity&logoColor=white)
![Foundry](https://img.shields.io/badge/Foundry-000000?style=flat&logo=ethereum&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![viem](https://img.shields.io/badge/viem-1e1e1e?style=flat)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![tests](https://img.shields.io/badge/tests-38_passing-3ddc84?style=flat)
![property cases](https://img.shields.io/badge/fast--check-20%2C000_cases-3ddc84?style=flat)
[![CI](https://github.com/edycutjong/pigeonhole/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/pigeonhole/actions/workflows/ci.yml)
[![CodeQL](https://github.com/edycutjong/pigeonhole/actions/workflows/codeql.yml/badge.svg)](https://github.com/edycutjong/pigeonhole/actions/workflows/codeql.yml)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat)
[![Release](https://img.shields.io/github/v/release/edycutjong/pigeonhole?sort=semver)](https://github.com/edycutjong/pigeonhole/releases/latest)

</div>

---

**In three lines**

- **Problem:** a deposit address per invoice normally means a private key per address (a KMS), a sweep transaction someone has to sign, an indexer to see it paid, and a gas token to pay for all of it.
- **On Arc:** USDC is the native balance, so a CREATE2-predicted address receives USDC before any code exists; one transaction later a 61-line contract is born there, `SELFDESTRUCT` moves the balance to the immutable treasury, and it is gone. No key, no indexer — PAID and SWEPT are read straight from the system emitter's logs.
- **Proof:** factory [`0x942b…9A40`](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40) on Arc mainnet · sweep 64,162 gas ≈ $0.0013 (N=25) · batch sweep 43,345 gas/address at N=50 · PAID 452 ms p50 / 850 ms p95 (N=10) · 14 Foundry + 28 vitest + 20,000 property cases · on-chain bytecode == `forge build`.

---

## 📸 See it in action

**Demo video (2:30):** [youtu.be/BGuzotTXQEA](https://youtu.be/BGuzotTXQEA) — a real cycle on Arc mainnet recorded from the live page (invoice `acme-2026-0922`: pay 0.02 USDC → PAID → sweep → SWEPT), captions included.

<div align="center">
  <img src="docs/assets/broll.gif" alt="The live page, real time: the invoice flips from UNPAID to PAID as the payment log lands, then from PAID to SWEPT as the sweep log lands and a second movement row appears" width="100%">
  <sub>Real cycle on the production factory, recorded from the live page at 1× speed — two 4.5-second windows from the demo video: the moment the pay log lands (UNPAID → PAID) and the moment the sweep log lands (PAID → SWEPT).</sub>
</div>

<div align="center">
  <img src="docs/assets/screenshot-invoice-swept.png" alt="The seeded demo-paid invoice: SWEPT, paid in 0.02 USDC, unswept 0, invariant I2 holds, two movements with explorer links" width="100%">
</div>

> **Invoice id → codeless address → PAID from one log → Sweep in one tx → address gone.** The screenshot is the seeded
> `demo-paid` cycle on the production factory, read live from Arc mainnet — `Paid in`, `Unswept` and the `I2 · Σlogs == balance`
> line come from `eth_getLogs` + `eth_getBalance`, nothing else. Reviewer path, receipts and reproduce steps: [`JUDGE.md`](./JUDGE.md).

---

## 💡 The problem

A merchant or exchange that wants one deposit address per customer/invoice does it the hard way:
HD-derived addresses, each a private key to generate, store, guard, and later sign a sweep with.
Circle's own exchange-integration guide prescribes exactly this. Keys are the liability.

## 🕊️ What Pigeonhole does

The deposit address is a **counterfactual `CREATE2` address** — computable offline, with no code and
no key. It receives USDC like any address. To collect, anyone calls `sweep(salt)`: the factory deploys
a 22-byte throwaway (`PUSH20 treasury; SELFDESTRUCT`) at that exact address; its constructor moves the
whole balance to an **immutable treasury** and self-destructs in the same transaction. EIP-6780 fully
deletes it, so the address returns to *no code, nonce 0* and can be paid and swept again forever.

**There is no private key for any deposit address, and funds can only ever reach the treasury.**

## 🏗️ Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-dark.png">
  <img src="docs/assets/architecture-light.png" alt="Architecture: the browser page (no backend) predicts a CREATE2 address per invoice and reads PAID/SWEPT from one eth_getLogs filter on Arc's system emitter; on Arc mainnet the factory holds an immutable treasury, the payer sends native USDC to the codeless address, and anyone's sweep(salt) CREATE2-deploys a 22-byte throwaway there that SELFDESTRUCTs the whole balance to the treasury in the same transaction" width="100%">
</picture>

Three lanes, one transaction. The page never talks to anything but Arc's public RPC; the chain never needs a key for the address; the treasury is the only place funds can go. Line-by-line: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 🔵 Why this needs Arc — and only Arc

It uses **Arc for the one property no other EVM chain has: USDC *is* the native balance.**

- On Arc, a codeless address holds native USDC and `SELFDESTRUCT` moves it (docs: *"SELFDESTRUCT is allowed on Arc, including during contract deployment"* and moves the native balance). On every other EVM chain USDC is an ERC-20 in the token contract — a self-destruct can't touch it, so the whole mechanism is impossible.
- **USDC-as-gas** → deposit addresses, sweeps, and the merchant all live in one asset; no ETH, ever.
- **EIP-7708 native `Transfer` logs** from the system emitter → "PAID" is a single `eth_getLogs`; **no backend, no database, no indexer.**
- **Deterministic finality** → a payment is final in the block that includes it; the page polls the log every 5 s and never shows a confirmation counter. (Latency benchmarked on mainnet: inclusion 452 ms p50 / 850 ms p95 — see `DEMO.md`.)

Take Arc out and you'd need: a key-management service (HD wallets + signing), an ERC-20 sweep contract per address or a hot wallet, an indexer to detect payments, and a separate gas token. Pigeonhole replaces all four with one 61-line contract and a static page.

## 🧾 Proof (all on mainnet)

- **Verified live:** `npm run verify` — offline `predict()` byte-matches on-chain `predict()` for 50 random ids, and invariant I2 (Σin − Σout == balance) holds for both seeded invoices. No wallet needed. The page runs the same I2 check on every refresh and shows it.
- **42 tests:** 14 Foundry (incl. a fuzz test, invariants I1 no-code-after-sweep, I3 funds-only-to-treasury, and the `sweepMany` gas shape) + 28 vitest (offline formula vs real on-chain addresses, the no-DB reducer, the *Sweep all* set, decimals, and eight regression tests named for the `eth_getLogs` defects they pin: the 10k-block cap, poll overlap, RPC head skew, re-created invoice ids, the invalidate-while-scanning race).
- **Solidity coverage 100 % / 100 % / 100 % / 100 %** (lines · statements · branches · functions) on `src/PigeonholeFactory.sol` — `forge coverage`, gated in CI at 100 % lines; the one revert the mechanism can produce (`Create2Mismatch`, a CREATE2 collision) is exercised by planting code at the predicted address.
- **20,000 property-based cases** (fast-check, `test/properties.test.ts`) per `npm test`: the ledger's Σin − Σout identity and status rules over random log sets, order-independence under any permutation, `predict()` against viem's *independent* CREATE2 implementation for random factory/treasury/salt triples, and the chunker never asking the RPC for ≥ 10,000 blocks.
- **38 E2E checks** (Playwright, desktop + mobile — `npx playwright test --list`) against the production bundle, read-only on mainnet: `/judge` renders with no session, the seeded `demo-paid` invoice reads SWEPT from the system emitter with I2 holding, the treasury view lists real `Swept` events and re-reads every known address for *Sweep all*.
- **Benchmark (invariant I4):** a balance-moving sweep on the production factory costs **64,162 gas (p50 and p95) ≈ $0.0013** — N=25 in `bench/results.json`, min 64,150 when the salt happens to contain a zero byte (calldata pricing, not execution); the probe factory, a different contract, measures 64,140.
- **Batch sweep:** *Sweep all* in the treasury view is one `sweepMany(salts)` — measured **43,345 gas per address at N=50** (2,167,267 gas, $0.044 for fifty invoices) against 64,162 one at a time; gas ≈ 21,722 + 42,911 × N on mainnet (`bench/many.json`, tx links in [`DEMO.md`](./DEMO.md#batch-sweep-sweepmany--readme-milestone-1-measured-2026-09-22)).
- **Latency, measured:** a deposit is in a block **452 ms p50 / 850 ms p95** after broadcast and visible to the page's `eth_getLogs` filter at **579 / 1,010 ms** — N=10 mainnet sends, every row a tx hash in `bench/latency.csv` (`npm run latency`); the page's 5 s poll adds up to one interval on top.
- **Edge cases with tx links** (re-pay after sweep, empty sweep, native send **and** ERC-20 `transfer()` payment — both flip PAID from the same system-emitter log): [`DEMO.md`](./DEMO.md).

## 🚀 Run it
```sh
git clone --recurse-submodules https://github.com/edycutjong/pigeonhole && cd pigeonhole
npm install
npm run verify                 # read-only proof, no wallet
npm test                       # 28 vitest incl. 20,000 fast-check cases
forge test --root contracts    # 14 contract tests (forge-std is a submodule: `git submodule update --init` if you cloned plain)
npm run dev                    # the page locally
```
No `.env`, no keys: the page is static and reads Arc mainnet anonymously. Only the gas benchmark spends (`.env.example`).

> **For reviewers:** open **[/#/judge](https://pigeonhole.edycu.dev/#/judge)** — the 60-second path, every
> mainnet receipt, and the honest limitations on one page. Mirror: [`JUDGE.md`](./JUDGE.md).

## 🧪 Testing & CI

**6-stage pipeline:** Quality (web + contracts) → Security → Build → E2E → Performance → Deploy gate → GitHub Pages

```sh
npm run ci               # audit + oxlint + tsc + vitest with coverage
npm run e2e              # Playwright (builds and serves dist/ itself)
npm run lighthouse       # Lighthouse CI (100 / 100 / 100 / 91 measured 2026-09-18)
npm run security-scan    # npm audit + gitleaks over the full history
npm run readiness        # fails if any placeholder is left in judge-facing docs
```

| Layer | Tool | Status |
|---|---|---|
| Code quality | oxlint + `tsc --noEmit` | ✅ |
| Unit tests | vitest, 97% statements / 99% lines on `src/lib` | ✅ 25 |
| Property-based | fast-check, 4 properties × 5,000 cases | ✅ 20,000 |
| Contracts | Foundry: fuzz + invariants I1/I3 + gas snapshot | ✅ 13 |
| E2E | Playwright, chromium + Pixel 7, read-only vs mainnet | ✅ 34 |
| Security (SAST) | CodeQL | ✅ |
| Security (SCA) | Dependabot (npm, actions, submodule) + npm audit + license check | ✅ |
| Secret scanning | gitleaks, full history, on every push | ✅ |
| Performance | Lighthouse CI (a11y ≥ 0.9 hard gate) + JS bundle budget | ✅ |
| Releases | semantic tags from conventional commits | ✅ |

## 🎯 Who this is for
Exchanges, PSPs, and invoicing tools that need per-customer deposit addresses without a key-management
system. Pigeonhole is the deposit primitive; the same Arc properties make a small family of
key-optional payment primitives possible.

## 🔭 What's next
- **Batch reconciliation** across thousands of invoices from `Swept` events alone.
- A **primitive family** on the same Arc foundations: keeper-less standing orders (exact gas reimbursed in USDC), exactly-once payment keys, and card-style authorize/capture holds.

## 🎯 What a microgrant would fund
The first proof exists: the mechanism, the invariants, the measurements. What is missing is the part that only shows up under
load, and that is what the next 6–8 weeks would buy — with Arc office hours used for the two questions only Arc can answer.

| # | milestone | what it proves | how it's measured |
|---|---|---|---|
| 1 | ~~**`sweepMany` on the page**~~ — **done 2026-09-22**: the treasury view lists every known pigeonhole with its live balance and *Sweep all* sends one `sweepMany(salts)` | a merchant with hundreds of open invoices settles in one transaction | measured on mainnet: **64,681 / 45,083 / 43,345 gas per address at N = 1 / 10 / 50** — one more address in a batch costs 42,911 gas, 33 % under a standalone sweep (`bench/many.json`, three tx links in `DEMO.md`) |
| 2 | **Batch reconciliation** from `Swept` events alone — thousands of invoices, no per-invoice scan | the ledger stays correct when the invoice count outgrows the `eth_getLogs` budget (≈0.5 calls/s on the public RPC) | time-to-reconcile for 1,000 synthetic invoices; must stay under the 9,000-block chunk cap without a backend |
| 3 | **Blocklist recovery drill** — a documented, tested path when the immutable treasury is blocklisted (today's single point of failure, see Limitations): new factory, same salts, re-predicted addresses | the failure mode has a rehearsed exit, not a paragraph | Foundry test that migrates every open invoice; a written runbook |
| 4 | **Two questions for Arc office hours**: (a) is anonymous RPC access a commitment for early mainnet, or should a merchant run a node — the page's design hinges on it; (b) `SELFDESTRUCT`-in-creation-tx (EIP-6780) is what lets the address be reused — is that behaviour stable across Arc upgrades? | the two assumptions the whole design rests on are confirmed or the design changes early | written answers linked from this README |

Not on the list, on purpose: a backend, a token, a dashboard. The value of the project is that a merchant needs none of them.

The DX report behind milestone 4 is filed with Arc as [circlefin/arc-node#455](https://github.com/circlefin/arc-node/issues/455).

## 🩹 What we got wrong (dated, kept here rather than edited away)
- **2026-09-17 — the `eth_getLogs` cap.** Day-2 code assumed the RPC allowed 100k-block spans; it allows 9,999 (10,000 → `-32012`). At ~2 blocks/s the live page would have frozen at "UNPAID" a few hours after deploy. Found by a pre-submission audit, fixed the same evening: every scan is chunked at 9,000 blocks, polled incrementally, and invoice URLs carry their creation block (`?from=`). Three regression tests pin it.
- **2026-09-17 — "first-sweep cost 91,740".** The probe notes read the v1 sweep's 91,740 gas as the cost of sweeping a never-seen *address*. The bench refuted that: all 25 first sweeps cost 64,150–64,162. The extra 27,600 was the never-seen *beneficiary* (v1's wrong treasury). `DEMO.md` now says so.
- **2026-09-17 — "64,140 corrected to 64,162".** Not a correction: 64,140 is the probe factory's bytecode, 64,162 is this one's. Different contracts, both right.

## ⚠️ Limitations (honest)
- The treasury's immutability is also a **single point of failure**: if it were ever blocklisted, unswept invoices freeze until it's unblocked; recovery means a new factory.
- The static page needs an **anonymous Arc RPC** (the docs call early-mainnet RPC "permissioned"), and it scans logs in 9,000-block chunks, one call at a time, paced to what `rpc.mainnet.arc.io` sustains (measured 2026-09-20: ≈0.5 `eth_getLogs`/s; bursts are refused with `-32005`). An invoice URL without `?from=` scans from the factory's deploy block — ≈38 calls per day of chain, so a first read of an old invoice takes minutes (progress is shown; each completed chunk is checkpointed in the browser, so it is never repeated). The seeded `demo-paid` / `demo-erc20` ship a committed history checkpoint (`deployments/history-checkpoints.json` — refresh with `npm run checkpoints`; `npm run verify` re-checks every movement against its receipt) so they open in seconds; the treasury view always scans from the deploy block. When the live I2 check mismatches twice in a row, the page rescans that invoice from the deploy block.
- **Sweep all** knows only the addresses it can derive without a database: every salt the factory has ever emitted in `Swept` plus this browser's own invoices. An invoice that was paid but never swept, created on another device, is not in the set until it is swept once (or opened here).
- The `?amt=` amount is the merchant's claim — the chain proves what was *paid*.

## 📁 Project structure
```
pigeonhole/
├── contracts/            # PigeonholeFactory.sol (61 lines), Foundry tests, Deploy script
├── src/                  # the static page: lib/ (predict, ledger, chunked getLogs), chain.ts, main.ts
├── test/                 # vitest: formula vs mainnet addresses, reducer, regression + property tests
├── e2e/                  # Playwright specs (smoke, invoice flow, live mainnet, responsive, /judge)
├── scripts/              # verify.ts (read-only proof), bench.sh + bench_stats.py, readiness gate
├── bench/                # N=25 mainnet benchmark rows + results
├── deployments/          # arc-mainnet.json — factory, treasury, seeded cycles, tx hashes
├── docs/                 # DX-REPORT.md, explorer screenshot, README assets
├── DEMO.md · JUDGE.md · ARCHITECTURE.md
└── .github/              # CI/CD, CodeQL, gitleaks, release, Dependabot, community files
```

## 📄 License
[MIT](LICENSE) © 2026 Edy Cu

## 🙏 Acknowledgments
Built for the **Arc Microgrants** program (Circle), September 2026 — on Arc's native-USDC EVM, whose
[documented EVM differences](https://docs.arc.io) are the whole reason this mechanism exists. Thank you for reviewing.
