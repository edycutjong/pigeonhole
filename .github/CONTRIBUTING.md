# Contributing

Thanks for your interest in improving Pigeonhole! 🎉

## Getting started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Clone with the contract dependency: `git clone --recurse-submodules …` (or `git submodule update --init`)
3. Install: `npm install` — Foundry for the contracts: https://getfoundry.sh
4. Run the page locally: `npm run dev`

No keys, no `.env`: the page is static and reads Arc mainnet anonymously. Only `scripts/bench.sh` spends USDC
(see `.env.example`).

## Before you open a PR
- `npm run ci` passes (audit, oxlint, tsc, vitest + 20,000 fast-check cases with coverage).
- `forge test --root contracts` passes (12 tests incl. fuzz + invariants I1/I3).
- `npm run e2e` passes (Playwright, read-only against Arc mainnet).
- `npm run readiness` still exits 0 (no placeholders in judge-facing docs).
- Every claim in `README.md` / `DEMO.md` / `ARCHITECTURE.md` still matches the code (test counts, gas numbers, addresses).
- Add or update tests for any behaviour change. Regression tests are **named for the defect they pin**.
- Keep commits conventional (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`) — releases are cut from them.

## Reporting bugs / requesting features
Open an issue using the provided templates. Include repro steps, expected vs. actual behaviour, and — for anything
on-chain — the transaction hash on https://explorer.arc.io.
