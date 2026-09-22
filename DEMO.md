# DEMO — Pigeonhole

**Live:** https://pigeonhole.edycu.dev/ · **Factory:** [`0x942b8c10…9A40`](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40) · **Arc mainnet (5042)**

## 60-second reviewer path (≤ $0.10 of USDC on Arc, one wallet)
1. Open the live URL → **New invoice** → type any id (e.g. `demo-1`) and `0.02` → **Create deposit address**.
2. You get a fresh address + QR. Nothing is deployed yet — open it on the explorer and it's an empty account.
3. **Pay with wallet** (or send 0.02 USDC to the address from any Arc wallet). On the next 5-second poll the badge flips **PAID**, from a single `eth_getLogs` on the system emitter — no backend. (Measured: a deposit is in a block 452 ms p50 / 850 ms p95 after broadcast and visible to the log filter at 579 / 1,010 ms, N=10 — `bench/latency.json`; the poll adds up to one interval.)
4. **Sweep → treasury**. One transaction (~$0.0013). The explorer shows the balance leaving the address for the treasury, and the address returns to *no code, nonce 0*.
5. **Treasury view** lists that sweep, read from the factory's `Swept` events.

## Edge cases (all proven on mainnet — tx links)

| Case | Result | Tx |
|---|---|---|
| Pay a codeless predicted address (native send) — day-0 probe factory | 1 log: `Transfer` from system emitter `0xffff…fffE` → "PAID" is one filter | [`0xc80df136…`](https://explorer.arc.io/tx/0xc80df1360ab2cd4851b998d323840f6bfee1317a61fd0bfea48856ff711bfbd3) |
| Sweep to a **never-seen beneficiary** (v1 probe factory, wrong treasury `0x1804c8AB…` — a script bug) | 91,740 gas: +27,600 over steady state = the new-account cost of the *beneficiary*, not of the pigeonhole (every bench row is a first sweep of a never-seen address at 64,150–64,162) | [`0xb6fe10fe…`](https://explorer.arc.io/tx/0xb6fe10fe2575781f7811750463cddc7819c7d2bbac4ea7d97f4030864fb0e4a4) |
| Sweep after a **native send** (production factory, `demo-paid`, 0.02 USDC) | 64,162 gas ≈ $0.0013; `Transfer(pigeonhole → treasury)` + `Swept` | [`0xe639255a…`](https://explorer.arc.io/tx/0xe639255a52b96c7f4733608776f6cd11eca3c615748350877d2ea384a6988ea6) |
| **Pay via ERC-20 `transfer()`** (`demo-erc20`, `0x3600…0000.transfer(pigeonhole, 10000)`) | receipt has **two** logs: system emitter `0xffff…fffE` (1e16, 18-dec) + ERC-20 `0x3600…0000` (10000, 6-dec) — the page counts only the first, so PAID flips and nothing double-counts | [`0x64ce87be…`](https://explorer.arc.io/tx/0x64ce87be84ef57938c0af91b7c6a89c9eb736ff3a8627dbf2c4f1a069a936a64) |
| Sweep of the ERC-20-paid address | 64,162 gas — same as the native-paid case; address back to code `0x` / nonce 0 | [`0xf5883aea…`](https://explorer.arc.io/tx/0xf5883aeae9a0c872241de57b348ebe688bf6f80b58542f7d5166bfc24b5f8111) |
| Sweep of an empty address (probe factory; production: 8 `bench-empty-*` rows in `bench/rows.csv` at 64,162) | harmless no-op, `Swept(…, 0)` | [`0x2daaf54a…`](https://explorer.arc.io/tx/0x2daaf54abdd9b42e8990a3573cf00c63cddfa4ac3d34a07c652fb7c9e8a9fef9) |
| **Re-pay a swept address (later tx)** (probe factory) | succeeds — EIP-6780 fully deleted the throwaway, and Arc's destructed-account revert only applies *within* the same tx (measured, not doc-quoted) | [`0x531f09ff…`](https://explorer.arc.io/tx/0x531f09ffacdd006cb7c3f5c009e665ca62331c03cc867ebf5bdef2ef7cd6a76c) |
| **Re-sweep** (probe factory) | 64,140 gas (the probe factory's bytecode; production is 64,162), balance to treasury, address reset again | [`0x631814ad…`](https://explorer.arc.io/tx/0x631814adf42ce99763ac5ca53859e0b0f677538707a6246a23843bb4e83fef51) |
| Payer blocklisted / self-send | *documented only* — a blocklisted payer's tx reverts (no log, never PAID); a self-send emits no EIP-7708 log | — |

Screenshot of a same-tx create+destruct sweep rendering on the explorer (logged-out Blockscout): [`docs/explorer-resweep-0x631814-2026-09-17.png`](./docs/explorer-resweep-0x631814-2026-09-17.png).

## Reproduce the proof yourself
```sh
npm install
npm run verify                  # read-only: offline predict() == on-chain (N=50), invariant I2 for both seeded cycles. No wallet.
npm test                        # 25 vitest: formula vs real addresses, the no-DB reducer, decimals, eth_getLogs chunking/dedupe/overlap/race, 20,000 fast-check cases
git submodule update --init     # forge-std (or clone with --recurse-submodules)
forge test --root contracts     # 12 contract tests incl. fuzz + I1/I3
# gas benchmark (spends ~$0.05 of USDC on Arc; any funded cast keystore):
KS=/path/to/keystore.json PW=/path/to/password.txt N=25 R=8 zsh scripts/bench.sh
```

## Source verification (honest status)
The explorer's `/api` sits behind a Cloudflare managed challenge, so `forge verify-contract --verifier blockscout` cannot
submit (2026-09-18) and the factory shows as *unverified* on explorer.arc.io. What is provable without the explorer: the
on-chain runtime code (972 bytes, keccak256 `0x8806de8d0cfd20d31fcebdd6252ca2065fb6954d2a5398d65177e38d6c28cada`) is
**byte-identical** to `forge build`'s `deployedBytecode` for `contracts/src/PigeonholeFactory.sol` (solc 0.8.30, osaka,
optimizer 200) once the immutable treasury is substituted — zero mismatching bytes. Recipe in `deployments/arc-mainnet.json`.

## Benchmark (invariant I4 — sweep gas)
See `bench/results.json` and `bench/rows.csv`. A balance-moving sweep on the production factory is **64,162 gas at p50**
(N=25 bench rows: min 64,150 / p50 64,162 / max 64,162 — the three 64,150 rows are salts containing one zero byte, i.e. 12 gas of
calldata pricing, not execution — plus the two seeded cycles above at 64,162). The pre-stated
figure was 64,140, measured on the day-0 *probe* factory — a different contract (no `Create2Mismatch` check, no
zero-treasury guard), not a mis-measurement of this one.

(N=25 rows: p50 **64,162** / p95 **64,162** / max 64,162 — the distribution is flat because the sweep's work is fixed; only the
salt's zero bytes move it.)

## Latency (invoice → PAID)
Measured 2026-09-22 on mainnet, N=10 native sends of 0.001 USDC to fresh pigeonholes (`npm run latency`, `bench/latency.json`,
`bench/latency.csv` — every row is a tx hash). Two clocks from the sender's machine:

| clock | p50 | p95 | max |
|---|---|---|---|
| broadcast → receipt (inclusion) | **452 ms** | **850 ms** | 850 ms |
| broadcast → the page's own `eth_getLogs` filter returns the Transfer | **579 ms** | **1,010 ms** | 1,010 ms |

Every sample landed in the next block (block timestamp − send time = 1–2 s at 1 s granularity). The invoice page polls every
5 s (`src/main.ts`), so what a payer sees is the second row plus up to one poll interval: **≤ ~6 s worst case, ~3 s typical**.
That bound is the page's choice (0.4 getLogs/s stays under the public RPC's sustainable rate), not the chain's.
