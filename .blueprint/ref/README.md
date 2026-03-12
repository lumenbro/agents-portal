# Reference Architecture (from LumenBro Main Platform)

These docs are ported from the production LumenBro platform (`v0-agent-trading-platform/.blueprint/`). The main platform is a consumer wallet app (lumenbro.com) — the agents-portal is its mirror for agent operators. Same smart account contract, same transaction patterns, same auth model.

**Read these when debugging.** Most transaction, auth, and footprint issues have already been solved on the main platform.

## Quick Reference

| Doc | When to read |
|-----|-------------|
| `TG_SESSION_SIGNER_TX_PITFALLS.md` | **Any Soroban tx failure** — 8 pitfalls with fixes (footprint dupes, XDR corruption, auth timing, SDK imports, challenge format, sequence bugs) |
| `TRANSACTION_ARCHITECTURE.md` | Understanding the 3-layer tx pattern (auth → envelope → fee-bump), ghost derivation, SignatureProofs format, footprint problem |
| `SMART_ACCOUNT_ARCHITECTURE.md` | Signer types (Ed25519 / Secp256r1), SignerKey/SignerProof XDR format, `__check_auth` flow, storage layout |
| `SESSION_SIGNER_ARCHITECTURE.md` | PRF-based passkey persistence, iframe P-256 session signers, spend policy integration, two-simulation flow |
| `GHOST_ARCHITECTURE.md` | Ghost account derivation v2 (HKDF + server salt), zero-balance sponsorship, recovery flow |
| `SECURITY_AUDIT_2026-02-15.md` | 90+ findings from 7 parallel audit agents — CSP, auth gaps, secret storage, attack chains |

## Key Patterns Already Solved

1. **Footprint deduplication** — Always deduplicate before `appendFootprint()` (XDR base64 comparison)
2. **Auth entry replacement timing** — Replace auth AFTER `assembledBuilder.build()`, never before
3. **SignatureProofs tuple struct** — Map must be wrapped in Vec (`scvVec([scvMap([...])])`)
4. **Two-simulation flow** — Unsigned sim for footprint → sign auth → re-simulate with signed auth
5. **Fee-bump minimum** — Inner fee from simulation is the minimum for fee-bump
6. **Low-S normalization** — secp256r1 signatures must have `s <= N/2` for Soroban
7. **Ghost is NOT a wallet signer** — Signs envelope only, zero authority over funds
8. **Account sequence auto-increment** — `TransactionBuilder.build()` mutates Account object
