# Architecture — Pigeonhole

*Judge-facing. Regenerated from the code in this repo, not from a pre-build spec.*

## One idea
A merchant needs a fresh deposit address per invoice. The industry answer (see Circle's own
`integrate/exchanges/deposits`) is HD-derived addresses — every one a private key to generate,
guard, and later sign a sweep with. **Pigeonhole has no key.** The deposit address is a
counterfactual `CREATE2` address; it receives USDC before any contract exists; and one
permissionless transaction deploys a 22-byte throwaway that `SELFDESTRUCT`s the balance to an
immutable treasury and disappears — leaving the address reusable forever.

This is only possible because **on Arc, USDC is the native balance.** On any other EVM chain USDC
is an ERC-20 living in the token contract; `SELFDESTRUCT` cannot move it, and a codeless address
cannot "hold" it in a way a self-destruct can sweep. The mechanism is Arc-specific by construction.

## The contract (`contracts/src/PigeonholeFactory.sol`, 61 lines)

```solidity
address public immutable treasury;                       // the only place funds can go
function initCode() -> 0x73 ‖ treasury ‖ 0xff            // PUSH20 treasury; SELFDESTRUCT  (22 bytes)
function predict(salt) -> CREATE2(this, salt, keccak256(initCode))   // pure function of (factory, salt, treasury)
function sweep(salt)   -> create2(initCode, salt); emit Swept(salt, addr, balanceBefore)
function sweepMany(salts[])
```

Because `initCode` embeds the immutable `treasury`, the deposit address is a pure function of
`(factory, salt, treasury)`. **Invariant I3:** funds a sweep moves can only ever reach `treasury` —
there is no parameter, no owner, no admin path that redirects them.

## Why the address is reusable (EIP-6780)
`sweep` deploys the throwaway and self-destructs it in the **same** transaction, so EIP-6780 fully
deletes it: afterwards `code.length == 0` and `nonce == 0` (**invariant I1**). The address can be paid
again and swept again indefinitely. Arc's rule that a value transfer to an account destructed *earlier
in the same transaction* reverts does **not** apply across transactions — verified on mainnet
(a later payment to a swept address succeeds; see `DEMO.md`).

## State is a pure function of logs — there is no database
Every native USDC movement emits an EIP-7708 `Transfer` log from the **system emitter
`0xffff…fffE`** (18 decimals). The page and `scripts/verify.ts` derive everything from it:

```
paidIn  = Σ value where topics.to   == pigeonhole
sweptOut= Σ value where topics.from == pigeonhole
unswept = paidIn − sweptOut            (invariant I2: == eth_getBalance(pigeonhole))
status  = UNPAID | PAID (unswept ≥ asked) | SWEPT (paid>0 && unswept==0)
```

The ERC-20 interface at `0x3600…0000` also emits a 6-decimal `Transfer` for `transfer()` calls (two logs per ERC-20
payment, proven in `DEMO.md`) — the reducer counts the system emitter only, never both. Ordering key is `(block, logIndex)`, never `block.timestamp`
(Arc timestamps are non-decreasing, not strictly increasing). `src/lib/pigeonhole.ts` holds the pure
`predict`/`reduceLogs`/`fmtUsdc18`; its `predict` is unit-tested to byte-match the on-chain
`predict` against real mainnet addresses.

```mermaid
sequenceDiagram
  participant M as Merchant page
  participant P as Payer wallet
  participant H as Pigeonhole (no code)
  participant F as PigeonholeFactory
  participant E as System emitter 0xffff…fffE
  participant T as Treasury (immutable)
  M->>M: addr = CREATE2(F, keccak256(id), treasury) — offline, no tx
  M-->>P: address + QR
  P->>H: native USDC send (21,000 gas)
  E-->>M: Transfer(P → H)   → PAID within 1 block (deterministic finality)
  M->>F: sweep(salt)  (anyone; 64,162 gas p50, N=25)
  F->>H: create2 → constructor SELFDESTRUCT
  H->>T: whole balance
  E-->>M: Transfer(H → T) + Swept(salt, H, amount)
  Note over H: EIP-6780 full delete → code 0x, nonce 0 → payable again
```

## Stack
| Layer | Choice |
|---|---|
| Contract | Solidity 0.8.30, Foundry, `evm_version=osaka`; deployed via the Arachnid CREATE2 factory (deterministic) |
| Client | Vite + TypeScript + viem 2; a small hash router; `qrcode` for the QR; no framework |
| State | none server-side — `eth_getLogs` (system emitter, topic-filtered, chunked ≤ 9,000 blocks, polled incrementally with a 10-block overlap and (tx, logIndex) dedupe: the RPC rejects 10k+ spans and its backends' heads can differ) + a live I2 check (`Σlogs == eth_getBalance`, rescans from the deploy block on mismatch) + `localStorage` for the merchant's own invoice ids and their creation blocks |
| Tests | 12 Foundry (incl. fuzz + I1/I3) + 19 vitest (predict vs on-chain, reducer, decimals, `eth_getLogs` chunking/dedupe/overlap) |
| Scripts | `verify.ts` (offline==on-chain, I2 via `eth_getBalance`), `bench.sh` (I4 gas distribution) |
| Hosting | GitHub Pages (static) |

## Residual risks (honest)
- **Treasury is a single point of failure.** The immutability that removes key risk also removes recovery: if the treasury were ever blocklisted, every unswept invoice freezes until it's unblocked; the only forward path is a new factory with a new treasury.
- **Anonymous RPC/explorer.** The static page needs an anonymous Arc RPC; both worked on 2026-09-17 but the docs describe them as permissioned during early mainnet. A credentialed RPC would mean adding a provider key.
- **Off-chain amount.** `?amt=` is the merchant's claim; the chain proves what was paid, the URL says what was asked. Stated on the page.
