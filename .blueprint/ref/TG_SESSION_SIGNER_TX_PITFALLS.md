# Telegram Session Signer - Transaction Pitfalls & Solutions

> **Last Updated**: February 6, 2026
> **Status**: PRODUCTION - First successful mainnet tip transaction
> **First Mainnet Tx**: [9662fb705d24559d374b1164465f6faa1c3efc44552b2ec6f1657e8059da935a](https://stellar.expert/explorer/public/tx/9662fb705d24559d374b1164465f6faa1c3efc44552b2ec6f1657e8059da935a)
> **Module**: `app/mini-app/sign/page.tsx` (client-side mini-app, formerly `app/tg-sign/page.tsx`)
> **Commits**: `301e7f9` through `22a0024` (10 debugging commits)

---

## Architecture Overview

The Telegram tip bot uses a **client-side ed25519 session signer** flow that differs
from the main app's passkey (secp256r1) flow in one critical way:

| | Main App (Passkey) | Telegram (Session Signer) |
|---|---|---|
| **Auth signer** | secp256r1 (Face ID) | ed25519 (PIN-encrypted) |
| **Envelope signer** | Ghost ed25519 | Same ed25519 key |
| **Auth signed before simulation?** | No (unsigned skeleton) | **Yes (fully signed)** |
| **`__check_auth` runs in simulation?** | No (partial) | **Yes (full)** |
| **Footprint augmentation needed?** | Yes (must add signer/WASM) | **No (simulation has everything)** |

This difference caused every major bug in this integration.

---

## Pitfall 1: Duplicate Footprint Keys (txSorobanInvalid)

**Error**: `tx_soroban_invalid` (-17) with no diagnostic events

**Root Cause**: When ed25519 auth is signed BEFORE simulation, `__check_auth` fully
executes during simulation. The simulation footprint already includes the signer key,
wallet instance, and WASM code. Calling `appendFootprint()` adds duplicates.

**Evidence** (decoded XDR):
```
RO[0]: Token INSTANCE       <- simulation
RO[1]: Ed25519 signer       <- simulation (from __check_auth)
RO[2]: Wallet INSTANCE       <- simulation (from __check_auth)
RO[3]: WASM code             <- simulation (from __check_auth)
RO[4]: Ed25519 signer       <- appendFootprint DUPLICATE!
RO[5]: Wallet INSTANCE       <- appendFootprint DUPLICATE!
RO[6]: WASM code             <- appendFootprint DUPLICATE!
```

**Fix**: Deduplicate by comparing XDR of existing keys before appending:
```typescript
const existingKeySet = new Set([
  ...existingRO.map(k => k.toXDR("base64")),
  ...existingRW.map(k => k.toXDR("base64")),
]);
const newKeys = candidateKeys.filter(
  k => !existingKeySet.has(k.toXDR("base64"))
);
// Only append truly new keys (usually 0 for ed25519 signed auth)
if (newKeys.length > 0) {
  finalSorobanData = new SorobanDataBuilder(original)
    .appendFootprint(newKeys, [])
    .build();
}
```

**Rule**: Always deduplicate before `appendFootprint()`. Stellar rejects any
transaction with duplicate keys within read-only, within read-write, or overlapping
between the two sets.

---

## Pitfall 2: Raw XDR Manipulation Corrupts Transactions

**Error**: `tx_soroban_invalid` — XDR decoder found invalid VarArray length (4 billion)
at byte offset 1152 in the footprint region.

**Root Cause**: Building the assembled tx, then manipulating raw XDR to modify
auth entries and footprint:
```typescript
// BAD: XDR manipulation corrupts structure
const assembledTx = assembledBuilder.build();
const envelope = assembledTx.toEnvelope();
const body = envelope.v1().tx();
body.operations()[0].body().invokeHostFunctionOp().auth([signedAuth]); // modifies XDR
body.ext(new xdr.TransactionExt(1, augmentedSorobanData));             // corrupts
const finalTx = TransactionBuilder.fromXDR(envelope.toXDR("base64")); // corrupt XDR
```

**Fix**: Use the SDK's `setSorobanData()` on the TransactionBuilder, then replace
auth entries on the built Transaction object:
```typescript
// GOOD: SDK methods preserve XDR integrity
let builder = rpc.assembleTransaction(txWithAuth, simulation);
builder = builder.setSorobanData(augmentedSorobanData);
const finalTx = builder.build();

// Replace auth entries AFTER build (on the Transaction, not XDR)
(finalTx.operations[0] as any).auth = [signedAuthEntry];
finalTx.sign(keypair);
```

**Rule**: Never manipulate raw XDR envelopes to modify transaction contents. Use SDK
builder methods (`setSorobanData`, property assignment on Transaction objects).

---

## Pitfall 3: Auth Entry Replacement Timing

**Error**: Transaction executes with simulation's unsigned auth skeleton instead
of the signed ed25519 auth entry.

**Root Cause**: `assembleTransaction()` overwrites operation auth entries with
the simulation's unsigned skeletons. If you replace auth BEFORE assembly,
assembly overwrites your signed entry.

**Fix**: Always replace auth AFTER `assembledBuilder.build()`:
```typescript
const finalTx = assembledBuilder.build();
// AFTER build — this is the last step before signing
(finalTx.operations[0] as any).auth = [signedAuthEntry];
finalTx.sign(keypair);
```

**Reference**: `lib/ghost-tx/index.ts` lines 393-397 uses the same pattern.

---

## Pitfall 4: Single SDK Import (instanceof Failure)

**Error**: `assembleTransaction` throws "Expected a Transaction" or similar
`instanceof` check failures.

**Root Cause**: Importing from both `@stellar/stellar-sdk` and
`@stellar/stellar-sdk/rpc` separately causes webpack to bundle TWO copies of
the Transaction class. `assembleTransaction` does `tx instanceof Transaction`
but the tx was created from a different copy of Transaction.

**Fix**: Single import, destructure everything from one module:
```typescript
// GOOD: Single import
const stellarSdk = await import("@stellar/stellar-sdk");
const { Keypair, TransactionBuilder, xdr, Networks, Operation, rpc } = stellarSdk;
const SorobanServer = rpc.Server;

// BAD: Dual import creates two class hierarchies
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
```

---

## Pitfall 5: Paymaster Challenge Format

**Error**: `401 Invalid signature` from paymaster.

**Root Cause**: Challenge format is `nonce:timestamp:expiresAt:hmac` (colon-separated),
NOT pure hex. `Buffer.from(str, 'hex')` only parses hex chars up to the first `:`.
In browser (no Buffer polyfill), the manual hex parser was parsing the entire string.

**Challenge format** (from `lib/paymaster-challenge-store.ts`):
```
ad1b918ce813eadf...64-hex-chars...:1738824306:1738824426:hmac-signature
├─── nonce (32 random bytes as hex) ───┤├── ts ──┤├── exp ─┤├── hmac ──┤
```

**Fix**: Extract only the leading hex portion before signing:
```typescript
// Browser (no Buffer polyfill):
const hexPart = challenge.match(/^[0-9a-fA-F]*/)?.[0] || "";
const challengeBytes = new Uint8Array(
  (hexPart.match(/.{1,2}/g) || []).map(b => parseInt(b, 16))
);
const sig = keypair.sign(challengeBytes);
const signature = btoa(String.fromCharCode(...sig));

// Node.js (with Buffer):
const challengeBuffer = Buffer.from(challenge, 'hex'); // stops at first ':'
const signature = Buffer.from(keypair.sign(challengeBuffer)).toString('base64');
```

**Rule**: `Buffer.from(str, 'hex')` silently stops at non-hex characters. The browser
implementation must replicate this behavior exactly.

---

## Pitfall 6: Buffer Polyfill Disabled

**Context**: `next.config.mjs` has `buffer: false` in webpack resolve fallbacks.

**Impact**: `Buffer.from()`, `Buffer.alloc()`, etc. are not available in
client-side (browser) code. Any code using Buffer must use browser-native alternatives.

**Alternatives**:
```typescript
// Buffer.from(hex, 'hex') → Uint8Array
const bytes = new Uint8Array(
  (hexString.match(/.{1,2}/g) || []).map(b => parseInt(b, 16))
);

// Buffer.from(bytes).toString('base64') → btoa
const base64 = btoa(String.fromCharCode(...bytes));

// Buffer.from(base64, 'base64') → atob + Uint8Array
const bytes = new Uint8Array(atob(base64).split("").map(c => c.charCodeAt(0)));
```

---

## Pitfall 7: Sequence Number Double-Increment

**Error**: Transaction rejected with wrong sequence number.

**Root Cause**: `TransactionBuilder.build()` increments the Account object's internal
sequence counter. Building TWO transactions from the same Account object produces
sequence N+1 and N+2 instead of both using N+1.

**Fix**: Use separate Account objects, or only build one transaction:
```typescript
// If you need two transactions from the same sequence:
const account1 = new Account(pubkey, sequenceNumber);
const account2 = new Account(pubkey, sequenceNumber);
const tx1 = new TransactionBuilder(account1, ...).build(); // N+1
const tx2 = new TransactionBuilder(account2, ...).build(); // N+1

// Better: only build one transaction (current approach)
```

---

## Pitfall 8: txSorobanInvalid Has No Diagnostics

**Problem**: `tx_soroban_invalid` is a PRE-EXECUTION validation failure. The RPC
does NOT return diagnostic events because the transaction never executed.

**Error result XDR decodes to**:
```
txFeeBumpInnerFailed → tx_soroban_invalid
fee charged: ~31K stroops
inner operations: void (no details)
```

**Debugging approach**: Since there are no diagnostics, you must:
1. Decode the full transaction XDR to inspect structure
2. Check footprint for duplicates (RO/RO, RW/RW, RO/RW overlap)
3. Verify resource fee covers declared resources
4. Verify transaction fee >= baseFee + resourceFee
5. Verify XDR structure is valid (no corruption from manipulation)

**Common causes of txSorobanInvalid**:
- Duplicate footprint keys (most common in our experience)
- Corrupted XDR from raw manipulation
- Resource fee insufficient for declared resources
- Transaction fee < baseFee + resourceFee
- Resources exceed network limits

---

## The Correct Flow (Final Working Implementation)

```
Step 1: Parse auth skeleton from sign request
Step 2: Get latest ledger for signature expiration
Step 3: Build ed25519 auth preimage and sign
Step 4: Construct signature proofs (sorted sig map)
Step 5: Create signed SorobanAuthorizationEntry
Step 6: Parse base transaction, extract operation
Step 7: Get fresh account (sequence number)
Step 8: Build new tx with signed auth entry
Step 9: Simulate (with signed auth → __check_auth runs fully)
Step 10: Deduplicate footprint keys (simulation already has signer/WASM)
Step 11: assembleTransaction → setSorobanData → build
Step 12: Replace auth entries AFTER build
Step 13: Sign outer envelope with session keypair
Step 14: Fetch paymaster challenge, sign nonce portion
Step 15: Submit to /api/paymaster/submit for fee-bump wrapping
```

**Key insight**: Because ed25519 auth is signed BEFORE simulation (unlike passkey
flow where auth is unsigned during simulation), the simulation footprint is COMPLETE.
Footprint augmentation adds zero new keys — the dedup check filters them all out.

---

## Reference Files

| File | Purpose |
|------|---------|
| `app/mini-app/sign/page.tsx` | Client-side TG signing mini-app (this flow) |
| `lib/ghost-tx/index.ts` | Reference: `setSorobanData()` + auth replacement pattern |
| `lib/ghost-tx/footprint-augmentation.ts` | Reference: `appendFootprint()` + instruction bump |
| `lib/ghost-tx/challenge-manager.ts` | Reference: challenge signing pattern |
| `lib/ghost-tx/submit-with-retry.ts` | Reference: paymaster submission with retry |
| `lib/paymaster-challenge-store.ts` | Challenge format: `nonce:ts:exp:hmac` |
| `app/api/paymaster/submit/route.ts` | Paymaster: verify + fee-bump + submit |
| `app/api/paymaster/challenge/route.ts` | Challenge endpoint |

---

## Diagnostic Checklist

When a Soroban transaction fails, check in this order:

- [ ] **Is the SDK imported from a single entry point?** (no dual imports)
- [ ] **Are footprint keys deduplicated?** (no duplicates within or across RO/RW)
- [ ] **Was XDR manipulated directly?** (use SDK methods instead)
- [ ] **Are auth entries replaced AFTER assembly?** (not before)
- [ ] **Is the resource fee sufficient?** (must cover instructions + read/write + entries)
- [ ] **Is the transaction fee >= baseFee + resourceFee?**
- [ ] **Is the sequence number correct?** (beware of double-increment from dual build)
- [ ] **Is the challenge nonce signed correctly?** (hex portion only, not full string)
