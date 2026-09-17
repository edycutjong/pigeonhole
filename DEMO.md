# DEMO — Pigeonhole

**Live:** https://edycutjong.github.io/pigeonhole-arc/ · **Factory:** [`0x942b8c10…9A40`](https://explorer.arc.io/address/0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40) · **Arc mainnet (5042)**

## 60-second reviewer path (≤ $0.10 of USDC on Arc, one wallet)
1. Open the live URL → **New invoice** → type any id (e.g. `demo-1`) and `0.02` → **Create deposit address**.
2. You get a fresh address + QR. Nothing is deployed yet — open it on the explorer and it's an empty account.
3. **Pay with wallet** (or send 0.02 USDC to the address from any Arc wallet). Within one block the badge flips **PAID**, from a single `eth_getLogs` on the system emitter — no backend.
4. **Sweep → treasury**. One transaction (~$0.0013). The explorer shows the balance leaving the address for the treasury, and the address returns to *no code, nonce 0*.
5. **Treasury view** lists that sweep, read from the factory's `Swept` events.

## Edge cases (all proven on mainnet — tx links)

| Case | Result | Tx |
|---|---|---|
| Pay a codeless predicted address (native send) | 1 log: `Transfer` from system emitter `0xffff…fffE` → "PAID" is one filter | [`0xc80df136…`](https://explorer.arc.io/tx/0xc80df1360ab2cd4851b998d323840f6bfee1317a61fd0bfea48856ff711bfbd3) |
| First sweep of a never-seen address | 91,740 gas (new-account cost) | [`0xb6fe10fe…`](https://explorer.arc.io/tx/0xb6fe10fe2575781f7811750463cddc7819c7d2bbac4ea7d97f4030864fb0e4a4) |
| Steady-state sweep (production factory) | 64,162 gas ≈ $0.0013; `Transfer(pigeonhole → treasury)` + `Swept` | [`0xe639255a…`](https://explorer.arc.io/tx/0xe639255a52b96c7f4733608776f6cd11eca3c615748350877d2ea384a6988ea6) |
| Sweep of an empty address | harmless no-op, `Swept(…, 0)` | [`0x2daaf54a…`](https://explorer.arc.io/tx/0x2daaf54abdd9b42e8990a3573cf00c63cddfa4ac3d34a07c652fb7c9e8a9fef9) |
| **Re-pay a swept address (later tx)** | succeeds — address is reusable (EIP-6780 delete is same-tx only) | [`0x531f09ff…`](https://explorer.arc.io/tx/0x531f09ffacdd006cb7c3f5c009e665ca62331c03cc867ebf5bdef2ef7cd6a76c) |
| **Re-sweep** | 64,162 gas, balance to treasury, address reset again | [`0x631814ad…`](https://explorer.arc.io/tx/0x631814adf42ce99763ac5ca53859e0b0f677538707a6246a23843bb4e83fef51) |
| Payer blocklisted / self-send | *documented only* — a blocklisted payer's tx reverts (no log, never PAID); a self-send emits no EIP-7708 log | — |

Screenshot of a same-tx create+destruct sweep rendering on the explorer: `../assets/explorer-resweep-0x631814-2026-09-17.png`.

## Reproduce the proof yourself
```sh
cd build
npm install
npm run verify        # read-only: offline predict() == on-chain (N=50), invariant I2. No wallet.
cd contracts && forge test   # 12 contract tests incl. fuzz + I1/I3
# gas benchmark (spends ~$0.05 of USDC on Arc; needs the deployer keystore):
PRIVATE_KEY=$(cast wallet decrypt-keystore …) N=25 R=8 zsh scripts/bench.sh
```

## Benchmark (invariant I4 — sweep gas)
See `bench/results.json` and `bench/rows.csv`. Steady-state balance-moving sweep is **~64,162 gas**
(the spec pre-stated 64,140 from a single probe; the N-sample run is the corrected figure).
