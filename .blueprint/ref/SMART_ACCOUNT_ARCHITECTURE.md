# Stellar Smart Account Architecture

> **Source**: `ReferenceRepos/stellar-smart-account/`
> **Last Updated**: January 2026

This document describes the core architecture of the Stellar Smart Account contract that powers all LumenBro wallets.

## Overview

The Smart Account is a Soroban contract that acts as a programmable wallet with multi-signer support. Each wallet deployed through LumenBro is an instance of this contract.

## Core Types

### Signer Types

```rust
// From: contracts/smart-account-interfaces/src/auth/types.rs

/// A signer can be either Ed25519 or Secp256r1 (WebAuthn/Passkey)
pub enum Signer {
    Ed25519(Ed25519Signer, SignerRole),
    Secp256r1(Secp256r1Signer, SignerRole),
}

/// Ed25519 signer (used for recovery, bots)
pub struct Ed25519Signer {
    pub public_key: BytesN<32>,
}

/// Secp256r1 signer (used for passkeys)
pub struct Secp256r1Signer {
    pub key_id: Bytes,          // Credential ID from WebAuthn
    pub public_key: BytesN<65>, // Uncompressed P-256 public key
}
```

### Signer Roles

```rust
pub enum SignerRole {
    Admin,                          // Full control, can manage signers
    Standard(Vec<SignerPolicy>),    // Limited, optionally restricted by policies
}
```

### Signer Keys (Storage Keys)

```rust
/// Key used to store/lookup signers in contract storage
pub enum SignerKey {
    Ed25519(BytesN<32>),    // Public key
    Secp256r1(Bytes),       // Credential ID (key_id)
}
```

**XDR Serialization**:
- `SignerKey::Ed25519(pubkey)` → `Vec[Symbol("Ed25519"), Bytes(pubkey)]`
- `SignerKey::Secp256r1(key_id)` → `Vec[Symbol("Secp256r1"), Bytes(key_id)]`

### Signature Proofs

```rust
// From: contracts/smart-account/src/auth/proof.rs

/// Proof of signature for authorization
pub enum SignerProof {
    Ed25519(BytesN<64>),            // Raw Ed25519 signature
    Secp256r1(Secp256r1Signature),  // WebAuthn signature with metadata
}

/// WebAuthn signature data
pub struct Secp256r1Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

/// Map of signer keys to their proofs (used in auth credentials)
pub struct SignatureProofs(pub Map<SignerKey, SignerProof>);
```

**XDR Serialization**:
- `SignerProof::Ed25519(sig)` → `Vec[Symbol("Ed25519"), Bytes(sig)]`
- `SignatureProofs` → `Vec[Map<SignerKey, SignerProof>]`

## Contract Functions

### Signer Management

```rust
/// Add a new signer to the wallet
fn add_signer(signer: Signer) -> Result<(), Error>;

/// Remove a signer from the wallet
fn revoke_signer(signer_key: SignerKey) -> Result<(), Error>;

/// Check if a signer exists
fn has_signer(signer_key: SignerKey) -> bool;

/// Downgrade an admin signer to standard (irreversible)
fn downgrade_signer(signer_key: SignerKey) -> Result<(), Error>;
```

### Authorization

```rust
/// Called by Soroban to verify transaction authorization
fn __check_auth(
    signature_payload: BytesN<32>,
    signature: SignatureProofs,
    auth_contexts: Vec<Context>,
) -> Result<(), Error>;
```

## Transaction Flow

### Adding a Passkey (via Recovery)

1. Build `add_signer` operation with `Signer::Secp256r1(..., SignerRole::Admin)`
2. Simulate transaction (auth fails, no signature yet)
3. Extract auth entry, sign with Ed25519 recovery keypair
4. **Augment footprint** with recovery signer key (not included in simulation)
5. Assemble transaction with signed auth
6. Sign envelope with ghost keypair
7. Submit via paymaster

### Auth Entry Format

The auth entry's `signature` field must be `SignatureProofs`:

```typescript
// TypeScript/XDR representation
const signatureProofs = xdr.ScVal.scvVec([
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Ed25519'),
        xdr.ScVal.scvBytes(publicKeyBytes),
      ]),
      val: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Ed25519'),
        xdr.ScVal.scvBytes(signatureBytes),
      ]),
    }),
  ]),
]);
```

## Storage Layout

Signers are stored in persistent contract data:

| Key | Value | Durability |
|-----|-------|------------|
| `SignerKey::Ed25519(pubkey)` | `Signer` | Persistent |
| `SignerKey::Secp256r1(key_id)` | `Signer` | Persistent |
| `LedgerKeyContractInstance` | Contract instance data | Persistent |

## LumenBro Signer Hierarchy

```
Smart Account Wallet (C-address)
├── Passkey (Secp256r1) - ADMIN
│   └── Face ID / Touch ID required
│   └── key_id = credential ID from WebAuthn
│   └── public_key = 65-byte uncompressed P-256
│
├── Recovery (Ed25519) - ADMIN
│   └── Derived from BIP-39 12-word phrase
│   └── public_key = 32-byte Ed25519
│   └── Used only when passkey is lost
│
└── [Optional] Bot (Ed25519) - STANDARD
    └── For automated operations (Telegram bot, etc.)
    └── Limited by policy contracts
```

## Key Files in Reference Repo

| File | Description |
|------|-------------|
| `contracts/smart-account-interfaces/src/auth/types.rs` | Signer, SignerKey, SignerRole definitions |
| `contracts/smart-account/src/auth/proof.rs` | SignerProof, SignatureProofs, Secp256r1Signature |
| `contracts/smart-account/src/auth/signer.rs` | Signature verification implementation |
| `contracts/smart-account/src/account.rs` | Main contract implementation |
| `contracts/contract-factory/src/lib.rs` | Factory for deploying new wallets |

## Related LumenBro Files

| File | Purpose |
|------|---------|
| `lib/ghost-tx/index.ts` | Unified transaction builder |
| `lib/ghost-tx/footprint-augmentation.ts` | Footprint augmentation for recovery |
| `lib/build-secp256r1-auth.ts` | Passkey auth credential building |
| `lib/crossmint-webauthn-mobile.ts` | WebAuthn signing implementation |
| `app/api/recovery/add-passkey-signer/route.ts` | Recovery flow API |
