# DX report — building Pigeonhole on Arc mainnet (2026-09-17)

An honest friction log, written as it happened. Arc mainnet went live 2026-09-16; this was day 2.

## What worked first try
- **Solidity/Foundry unchanged.** `solc 0.8.30`, `evm_version = "osaka"`, `forge build`/`forge test` — no Arc-specific changes. 12 contract tests (one of them a fuzz test) pass locally.
- **USDC as native gas.** Deploy + every sweep is paid in USDC; no ETH anywhere on Arc. Fees sit at the 20 Gwei floor → ~$0.0013 per sweep, quotable in cents up front.
- **The core mechanism.** A CREATE2 address receives native USDC before any code exists; a constructor-`SELFDESTRUCT` moves that balance to the treasury in one tx and emits an EIP-7708 `Transfer` from the system emitter. Exactly as `evm-differences.md` documents.
- **CCTP FAST + Forwarding Service** landed the first USDC on Arc end-to-end in one SDK call (~2 cents fee), with no gas needed on Arc first.

## Friction (each cost real time)
1. **The "first USDC on Arc" chicken-and-egg.** The CCTP mint (`receiveMessage`) is paid in USDC *on Arc* — which a fresh wallet doesn't have. The fix is the Forwarding Service (`useForwarder: true`), which submits the mint for you. Not obvious from the bridge quickstart; it's in a separate how-to. **A standard (SLOW) transfer additionally waits for Base hard finality** — ours was still unattested by Iris after 90 min. Use FAST + forwarder for a first transfer.
2. **`forge script` with a CREATE2 salt fails "Chain 5042 not supported."** `new X{salt:...}()` routes through Foundry's deterministic-deployer path, which guards on a known-chains list Arc isn't in yet. Workaround: deploy through the Arachnid factory (`0x4e59…`, present on Arc) directly with `cast` — still deterministic.
3. **`msg.sender` inside `forge script`'s `startBroadcast` is Foundry's default sender, not your keystore.** A probe sent 0.01 USDC to the wrong address this way. Always pass the treasury/owner as an explicit env var.
4. **The public RPC is a flaky multi-backend, and `eth_getLogs` is capped at 10,000 blocks per call** — measured: a 9,999-block span answers, 10,000 returns `-32012 requested range too large`. At ~2 blocks/s that is ~85 minutes of chain per call, so the page chunks every scan at 9,000 blocks, polls incrementally, and carries the invoice's creation block in its URL (`?from=`). *What we got wrong first:* day-2 code assumed a 100k cap and would have broken within hours of deploy; caught by a pre-submission audit on 2026-09-17. `eth_sendRawTransaction` also intermittently returns `-32601 method not supported` from some backends (viem and cast both hit it) — immediate-retry wrappers in the scripts. Early-mainnet infra noise, not a protocol issue.
5. **`rpc-endpoints.md` says mainnet RPC/explorer are "permissioned"** — but both answered anonymously on 2026-09-17 (explorer renders logged-out; RPC returns `eth_chainId` with CORS). Re-checked; the page depends on anonymous RPC, so this is the one external dependency to watch.
6. **Docs address drift.** `integrate_exchanges_cctp-bridging.md` names MessageTransmitter `0xE737e5cE…` (no code on mainnet); the live one is `0x81D40F21…` per `arc_references_contract-addresses.md`. Trust the reference page.

## Net
Two productive days from zero to a verified factory + a live page + a benchmark, entirely in USDC, for well under $1 of gas. The friction was all tooling/early-mainnet, never the protocol.
