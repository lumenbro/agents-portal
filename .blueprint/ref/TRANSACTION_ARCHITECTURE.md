# Transaction Architecture

> **Last Updated**: January 2026
> **Status**: CANONICAL - This is the official transaction architecture
> **Module**: `lib/ghost-tx/` (universal transaction builder)

## The 3-Layer Transaction Architecture

Every gasless Soroban transaction has THREE layers of signing:

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: INNER AUTH (Authorization Entry)                       │
├─────────────────────────────────────────────────────────────────┤
│ WHO SIGNS: Passkey (secp256r1) or Recovery Key (ed25519)        │
│ WHAT IT DOES: Authorizes the CONTRACT CALL                      │
│ TRIGGERS: Face ID / manual signature                            │
│                                                                  │
│ This is the "permission" to execute the smart contract          │
│ function. The wallet's __check_auth verifies this.              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: ENVELOPE (Transaction Envelope)                        │
├─────────────────────────────────────────────────────────────────┤
│ WHO SIGNS: Ghost G-address (ed25519)                            │
│ WHAT IT DOES: Stellar PROTOCOL sequencing                       │
│ TRIGGERS: Automatic (keypair from SecureStore/HKDF)             │
│                                                                  │
│ The ghost is a sponsored 0-balance account. It signs the        │
│ outer envelope for Stellar's sequence number protocol.          │
│ It has NO authority over wallet funds.                          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: FEE-BUMP (Paymaster Wrapper)                           │
├─────────────────────────────────────────────────────────────────┤
│ WHO SIGNS: Paymaster (ed25519 on server)                        │
│ WHAT IT DOES: Pays all network fees                             │
│ TRIGGERS: Server-side after validation                          │
│                                                                  │
│ The paymaster wraps the already-signed inner transaction        │
│ in a FeeBumpTransaction and pays the fees.                      │
└─────────────────────────────────────────────────────────────────┘
```

### Critical Insight: Ghost is NOT a Wallet Signer

The ghost G-address:
- Signs the ENVELOPE (Layer 2)
- Does NOT sign auth entries (Layer 1)
- Is NOT added as a signer to the wallet contract
- Has ZERO authority over wallet funds
- Only exists for Stellar protocol sequencing
- Is derived deterministically from passkey public key + server salt

---

## Universal Transaction Module: `lib/ghost-tx/`

The `lib/ghost-tx/` module is the single entry point for all Stellar transactions.

### Module Structure

```
lib/ghost-tx/
├── index.ts                  # Main entry point, high-level APIs
├── types.ts                  # TypeScript interfaces
├── ensure-ghost-ready.ts     # Ghost account derivation + sponsorship
├── fetch-passkey-info.ts     # Passkey credential retrieval
├── challenge-manager.ts      # Paymaster challenge handling
├── submit-with-retry.ts      # Submission with sequence retry
├── footprint-augmentation.ts # Recovery mode footprint fixes
└── __tests__/                # Unit tests
```

### API Levels

```typescript
import {
  // Low-level: any operation
  executeGhostTransaction,

  // High-level: token transfers
  sendToken,
  smartSend,

  // Signer management
  addSigner,
  removeSigner,
  addPasskeyWithRecovery,

  // Contract calls
  callContract,
  callWalletFunction,

  // Plugin operations
  installPlugin,
  uninstallPlugin,
} from '@/lib/ghost-tx';
```

### Usage Examples

```typescript
// 1. Send tokens (high-level)
await sendToken({
  walletAddress: 'C...',
  asset: 'USDC', // or contract address
  to: 'G...',
  amount: '10.50',
});

// 2. Smart send (auto-resolve recipient)
await smartSend({
  walletAddress: 'C...',
  asset: 'XLM',
  recipient: 'user@email.com', // or phone, username, address
  amount: '5.00',
});

// 3. Low-level: any operation
await executeGhostTransaction({
  walletAddress: 'C...',
  operation: Operation.invokeContractFunction(...),
  signerType: 'passkey', // or 'session', 'recovery'
});

// 4. Recovery: add passkey with BIP-39
await addPasskeyWithRecovery({
  walletAddress: 'C...',
  recoveryKeypair,
  newPasskeyKeyIdBase64: '...',
  newPasskeyPublicKeyBase64: '...',
  ghostKeypair,
  ghostAddress: 'G...',
});
```

### Signer Types

| Type | Auth Method | Use Case |
|------|-------------|----------|
| `passkey` | Face ID / Touch ID (WebAuthn) | Normal transactions |
| `session` | Iframe signer (one-click) | Frequent operations |
| `recovery` | BIP-39 Ed25519 keypair | Account recovery |

---

## Ghost Account Derivation (v2 Secure)

### Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│  SERVER (/api/ghost/derive-salt)                                │
│                                                                  │
│  user_salt = HMAC-SHA256(GHOST_MASTER_KEY, passkey_pubkey)      │
│                                                                  │
│  • GHOST_MASTER_KEY stays secret on server                      │
│  • user_salt is safe to store client-side                       │
│  • Same passkey always gets same salt (deterministic)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT (lib/ghost-address-derivation.ts)                       │
│                                                                  │
│  HKDF-SHA256(                                                   │
│    IKM: "stellar-ghost-v1-2025",                                │
│    Salt: passkey_pubkey + user_salt,  ← Includes server secret  │
│    Info: "ghost-address"                                        │
│  )                                                               │
│           │                                                      │
│           ▼                                                      │
│      32-byte seed → Ed25519 Keypair → Ghost G-Address           │
└─────────────────────────────────────────────────────────────────┘
```

### Derivation Functions

```typescript
// Client-side (browser) - auto-fetches salt via HTTP
import { deriveGhostKeypairSecure } from '@/lib/ghost-address-derivation';
const keypair = await deriveGhostKeypairSecure(passkeyPubkeyBase64);

// Server-side (API routes) - inline salt derivation
import { deriveGhostKeypairServerSide } from '@/lib/ghost-address-derivation';
const keypair = await deriveGhostKeypairServerSide(passkeyPubkeyBase64);

// CRITICAL: NEVER use deriveGhostKeypair without salt (produces different address!)
```

---

## Auth Entry Structure (SignatureProofs)

The smart account contract expects a specific format for signatures:

```typescript
// SignerKey enum: Vec[Symbol("variant"), data]
const signerKey = xdr.ScVal.scvVec([
  xdr.ScVal.scvSymbol('Ed25519'),           // or 'Secp256r1'
  xdr.ScVal.scvBytes(publicKeyBytes),        // 32 bytes for Ed25519, 65 for Secp256r1
]);

// SignerProof enum: Vec[Symbol("variant"), signature]
const signerProof = xdr.ScVal.scvVec([
  xdr.ScVal.scvSymbol('Ed25519'),
  xdr.ScVal.scvBytes(signatureBytes),        // 64 bytes
]);

// SignatureProofs: MUST wrap Map in Vec (tuple struct!)
const signatureProofsMap = xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: signerKey, val: signerProof }),
]);
const signatureProofs = xdr.ScVal.scvVec([signatureProofsMap]);  // <-- CRITICAL Vec wrapper!

// Apply to auth entry
const creds = authEntry.credentials().address();
creds.signatureExpirationLedger(latestLedger + 100);
creds.signature(signatureProofs);
```

### Pain Point: SignatureProofs is a Tuple Struct

In Rust, `SignatureProofs(Map<SignerKey, SignerProof>)` is a tuple struct with one element. Soroban serializes tuple structs as Vec, so the Map must be wrapped in a Vec. Missing this causes `txBadAuth`.

---

## The Footprint Problem

### What is the Footprint?

The footprint is a list of all storage keys the transaction will read or write. Soroban requires this upfront for resource allocation.

### The Problem

When you simulate a transaction, the auth entry has a PLACEHOLDER signature (zeros). The simulation runs but:

1. Auth check fails (invalid signature)
2. `__check_auth` doesn't fully execute
3. Storage keys read by `__check_auth` aren't in the footprint

### The Solution

After assembly, manually add the signer's data key to the footprint:

```typescript
// Build the signer's storage key (how wallet stores signers)
const signerKey = xdr.ScVal.scvVec([
  xdr.ScVal.scvSymbol('Ed25519'),
  xdr.ScVal.scvBytes(Buffer.from(publicKeyRawBytes)),
]);

// Build ledger key for contract data
const signerDataKey = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: Address.fromString(walletAddress).toScAddress(),
    key: signerKey,
    durability: xdr.ContractDataDurability.persistent(),
  })
);

// Add to footprint AFTER assembleTransaction
const resources = tx.operations[0].ext.sorobanData().resources();
const footprint = resources.footprint();
footprint.readOnly().push(signerDataKey);
```

### When This is Needed

- `add_signer` via recovery key
- `remove_signer` via recovery key
- Any operation where `__check_auth` needs to verify a signer

The `lib/ghost-tx/footprint-augmentation.ts` module handles this automatically for recovery mode.

---

## Complete Transaction Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser/Mobile)                   │
├──────────────────────────────────────────────────────────────────┤
│  1. Ensure ghost account exists (derive + sponsor if needed)     │
│  2. Build operation (invokeContractFunction)                     │
│  3. Simulate to get auth entry                                   │
│  4. Sign auth entry with passkey/recovery key (LAYER 1)          │
│  5. Assemble transaction with signed auth                        │
│  6. Add signer to footprint (if needed for __check_auth)         │
│  7. Sign envelope with ghost keypair (LAYER 2)                   │
│  8. Submit to /api/paymaster/submit                              │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         SERVER (Paymaster)                        │
├──────────────────────────────────────────────────────────────────┤
│  1. Verify ghost is sponsored                                    │
│  2. Verify challenge signature                                   │
│  3. Lazy-deploy ghost if needed (with correct sequence)          │
│  4. Wrap in FeeBumpTransaction (LAYER 3)                         │
│  5. Sign with paymaster keypair                                  │
│  6. Submit to Soroban RPC                                        │
│  7. Return { hash, ledger }                                      │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         STELLAR NETWORK                           │
├──────────────────────────────────────────────────────────────────┤
│  1. Validate fee-bump envelope (paymaster signature)             │
│  2. Validate inner envelope (ghost signature)                    │
│  3. Execute Soroban contract call                                │
│  4. Contract's __check_auth verifies auth entry (passkey/rec)    │
│  5. If valid, execute the function                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `txBadSeq` | Invalid source account sequence | Use ghost with correct sequence (create before tx build) |
| `txBadAuth` | Invalid auth signature | Check SignatureProofs format (Vec wrapper) |
| `txBadAuth` | Signer not in footprint | Add signer data key to footprint after assembly |
| `trying to access contract data key outside of footprint` | `__check_auth` reads signer storage | Same as above - add to footprint |
| `Ghost account does not exist` | Inconsistent ghost derivation | Use deriveGhostKeypairSecure consistently |

---

## SDK Gotchas and Pitfalls

### ⚠️ Account Object Auto-Increment (The +2 Sequence Bug)

**Problem**: The Stellar SDK's `Account` class **auto-increments its internal sequence** when you call `TransactionBuilder.build()`. This is a hidden side effect that can cause `tx_bad_seq` errors.

**Symptom**: Transaction uses sequence N+2 instead of N+1, causing `tx_bad_seq`.

**Example of the bug**:
```typescript
// ❌ WRONG: Reusing the same Account object for multiple builds
const account = new Account(address, '100');  // Account has sequence 100

const tx1 = new TransactionBuilder(account, {...}).build();
// tx1 has sequence 101, account's internal sequence is now 100

const tx2 = new TransactionBuilder(account, {...}).build();
// tx2 has sequence 102 (NOT 101!) because account was already incremented
```

**The fix**: Create a **fresh Account object** for each transaction build:
```typescript
// ✅ CORRECT: Store the sequence string, create fresh Account each time
const sequenceFromHorizon = '100';  // Store as string

// For assembly transaction
const assemblyAccount = new Account(address, sequenceFromHorizon);
const tx1 = new TransactionBuilder(assemblyAccount, {...}).build();
// tx1 has sequence 101

// For final transaction - create FRESH Account with SAME original sequence
const finalAccount = new Account(address, sequenceFromHorizon);
const tx2 = new TransactionBuilder(finalAccount, {...}).build();
// tx2 also has sequence 101 ✓
```

**Real-world scenario**: In `send-soroban-with-ghost-tx.ts`, we build TWO transactions:
1. Assembly transaction (for simulation/auth)
2. Final transaction (with modified resources)

Both must use the same sequence number. The fix stores `ghostAccountSequence` as a string and creates fresh `Account` objects for each build.

**Reference commit**: `132a809 fix: prevent +2 sequence error by using fresh Account objects`

---

### ⚠️ Failed Transactions Consume Sequence Numbers

**Problem**: In Stellar, transactions that **fail during execution** (not validation) still consume the sequence number. Horizon may show a stale sequence.

**Symptom**: Horizon returns sequence N, but using N+1 gives `tx_bad_seq` because a failed tx already consumed it.

**Example**:
```
1. Account has sequence 100 on Horizon
2. You submit tx with sequence 101
3. Tx fails during execution (e.g., scecExceededLimit)
4. Sequence 101 is CONSUMED even though tx failed
5. Horizon still shows 100 (only updated on SUCCESS)
6. Next tx with sequence 101 fails with tx_bad_seq
```

**The fix**: Implement retry logic that increments sequence on `tx_bad_seq`:
```typescript
if (errorMessage.includes('tx_bad_seq') && maxRetries > 0) {
  const currentSeq = BigInt(tx.sequence);
  const nextSeq = currentSeq + 1n;

  // Modify sequence in XDR directly
  const envelope = tx.toEnvelope();
  envelope.v1().tx().seqNum(xdr.SequenceNumber.fromString(nextSeq.toString()));
  envelope.v1().signatures([]);  // Clear signatures

  // Rebuild and re-sign
  const correctedTx = TransactionBuilder.fromXDR(envelope.toXDR('base64'), networkPassphrase);
  correctedTx.sign(keypair);

  return submitWithRetry(correctedTx, keypair, maxRetries - 1);
}
```

**Note**: Auth entry signatures are **independent** of transaction sequence (they have their own nonce), so re-signing the envelope doesn't invalidate the auth.

---

### ⚠️ Horizon Sequence vs Transaction Sequence

**Confusion**: "Horizon returned X but transaction uses X+1"

**Explanation**: This is **expected behavior**:
- Horizon returns the **account's current sequence** (last used)
- Transaction must use **current + 1** (next to use)

```
Horizon sequence: 100  →  Transaction must use: 101
After success:    101  →  Next transaction:     102
```

The SDK's `Account` class handles this automatically - when you create `new Account(address, '100')` and build a transaction, it uses sequence 101.

---

## Key Files

### Transaction Building (ghost-tx module)
- `lib/ghost-tx/index.ts` - Main entry point
- `lib/ghost-tx/ensure-ghost-ready.ts` - Ghost derivation + sponsorship
- `lib/ghost-tx/submit-with-retry.ts` - Submission with sequence retry
- `lib/ghost-tx/footprint-augmentation.ts` - Recovery mode footprint fixes

### Ghost Account
- `lib/ghost-address-derivation.ts` - HKDF derivation (canonical)
- `lib/lazy-deploy-ghost.ts` - Lazy deployment for ghost accounts
- `app/api/ghost/derive-salt/route.ts` - Server salt derivation API

### Auth Building
- `lib/build-secp256r1-auth.ts` - Passkey signature building
- `lib/crossmint-webauthn-mobile.ts` - WebAuthn signing

### Paymaster
- `app/api/paymaster/submit/route.ts` - Fee-bump and submission
- `app/api/paymaster/create-ghost/route.ts` - Ghost sponsorship
- `app/api/paymaster/challenge/route.ts` - Challenge generation

---

## Related Documents

- `.blueprint/GHOST_ARCHITECTURE.md` - Ghost derivation details
- `.blueprint/SMART_ACCOUNT_ARCHITECTURE.md` - Wallet contract structure
- `SKILLS/PASSKEY_SIGNING.md` - WebAuthn/passkey details
- `SKILLS/GHOST_ACCOUNT_DERIVATION.md` - HKDF derivation details
