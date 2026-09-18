# Security Policy

## Supported versions
| Version | Supported |
|---|---|
| latest (`main`) · factory `0x942b8c102e73aeea1a652ebC8F2d319fD08D9A40` on Arc mainnet | ✅ |

## What the design guarantees (and the test that proves each)
- **Funds can only reach the treasury.** The throwaway's init-code is `PUSH20 treasury; SELFDESTRUCT` with the treasury
  immutable in the factory; any caller can sweep, none can redirect. Foundry invariant **I3** (`test/PigeonholeFactory.t.sol`)
  and the `Create2Mismatch` check pin this.
- **No key exists for any deposit address.** The address is CREATE2 arithmetic (`predict`), verified against viem's
  independent implementation across 5,000 random factory/treasury/salt triples (`test/properties.test.ts`).
- **No address keeps code after a sweep** (invariant **I1**), so nothing at the address can ever be called.
- **The page holds no secrets** — it is static, talks to the public RPC anonymously, and asks your wallet to sign.

## Known limitations (disclosed, not hidden)
- The immutable treasury is a single point of failure: if it were blocklisted, unswept invoices freeze until a new factory.
- The `?amt=` in an invoice URL is the merchant's claim; the chain proves only what was paid.

## Reporting a vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead, report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after triage. Please give us a reasonable
window to patch before public disclosure.
