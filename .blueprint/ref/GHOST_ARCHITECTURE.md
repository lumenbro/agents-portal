# Ghost Account Architecture

> **Last Updated**: January 2025
> **Status**: CANONICAL - This is the official architecture

## The ONE Way: Secure HKDF Derivation (v2)

### Security Model

**Problem**: v1 derivation used only public inputs - anyone could derive ghost keypairs.

**Solution**: v2 adds server-derived salt from `GHOST_CHALLENGE_KEY`:

```
┌─────────────────────────────────────────────────────────────────┐
│  SERVER (/api/ghost/derive-salt)                                │
│                                                                  │
│  user_salt = HMAC-SHA256(GHOST_CHALLENGE_KEY, passkey_pubkey)   │
│                                                                  │
│  • GHOST_CHALLENGE_KEY stays secret on server                   │
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

### Key Properties
- **Deterministic**: Same passkey + same server salt → Same ghost (forever)
- **Secure**: Attacker cannot derive ghost without server salt
- **No DB Required**: Salt is deterministic from GHOST_CHALLENGE_KEY
- **Zero Balance**: Ghost has 0 XLM, sponsored by paymaster
- **Sequencing Only**: Ghost signs transaction envelope, NOT authorization

### Key Files
```
lib/ghost-address-derivation.ts          # Derivation with optional salt
app/api/ghost/derive-salt/route.ts       # Server salt derivation API
```

### Usage Patterns
```typescript
// Client-side: Use secure method (auto-fetches salt)
import { deriveGhostKeypairSecure } from './ghost-address-derivation';
const keypair = await deriveGhostKeypairSecure(passkeyPubkey);

// Server-side: Derive salt inline
import crypto from 'crypto';
const userSalt = crypto.createHmac('sha256', GHOST_CHALLENGE_KEY)
  .update(passkeyPubkey).digest('base64');
const keypair = await deriveGhostKeypair(passkeyPubkey, userSalt);

// Backwards compatibility (old ghosts without salt)
const keypair = await deriveGhostKeypair(passkeyPubkey); // Warns in console
```

## DEAD CODE - TO BE REMOVED

These files implement alternative approaches that are NO LONGER USED:

| File | What it does | Why it's dead |
|------|--------------|---------------|
| `lib/ghost-carousel.ts` | Pool of random ghosts | Requires DB storage, not deterministic |
| `lib/ghost-carousel-client.ts` | Client for carousel | Dead with carousel |
| `lib/ghost-carousel-auto-rotation.ts` | Rotate carousel slots | Dead with carousel |
| `lib/ghost-carousel-scaling.ts` | Scale carousel pool | Dead with carousel |
| `lib/carousel-seed-encryption.ts` | Encrypt carousel seeds | Dead with carousel |
| `lib/ghost-seed-encryption.ts` | Encrypt ghost seeds | Not needed with HKDF |
| `lib/sovereign-ghost-account.ts` | User-funded ghosts | Only for imported wallets, edge case |
| `lib/ghost-account-mode.ts` | Switch between modes | Only one mode now |
| `lib/ghost-keystore-browser.ts` | IndexedDB cache | Optional optimization, not required |

## Transaction Signing Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRANSACTION STRUCTURE                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  INNER TRANSACTION (built client-side)               │    │
│  │                                                      │    │
│  │  Source: Ghost G-address (for sequencing)           │    │
│  │  Operation: invokeContractFunction(...)             │    │
│  │                                                      │    │
│  │  Auth Entry:                                        │    │
│  │    - Signed by PASSKEY (secp256r1) for normal ops   │    │
│  │    - Signed by RECOVERY KEY (ed25519) for recovery  │    │
│  │                                                      │    │
│  │  Envelope Signature: Ghost (ed25519)                │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  FEE-BUMP WRAPPER (added by paymaster)              │    │
│  │                                                      │    │
│  │  Fee Source: Paymaster                              │    │
│  │  Signature: Paymaster                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Recovery Flow

When user loses passkey but has recovery phrase:

1. **Authenticate**: Recovery phrase → Ed25519 keypair
2. **Find Ghost**:
   - Try to get old passkey from DB/on-chain
   - Derive ghost via HKDF
   - If ghost doesn't exist → derive from NEW passkey + sponsor
3. **Add New Passkey**: Recovery key signs auth, ghost signs envelope
4. **Store**: New passkey becomes primary, gets its own HKDF ghost

## Network Configuration

**ALWAYS** detect mainnet properly:

```typescript
const isMainnet = process.env.STELLAR_NETWORK === 'mainnet'
  || process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';

const SOROBAN_RPC_URL = isMainnet
  ? 'https://rpc.lightsail.network/'
  : 'https://soroban-testnet.stellar.org';

const HORIZON_URL = isMainnet
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

const NETWORK_PASSPHRASE = isMainnet
  ? 'Public Global Stellar Network ; September 2015'
  : 'Test SDF Network ; September 2015';
```

## Files That Matter

### Core (KEEP)
- `lib/ghost-address-derivation.ts` - HKDF derivation (canonical)
- `lib/ghost-account-manager.ts` - Get/create ghost (uses HKDF)
- `lib/send-with-ghost-tx.ts` - Transaction building pattern

### APIs (KEEP)
- `app/api/recovery/setup-ghost/route.ts` - Sponsor new ghost
- `app/api/recovery/add-passkey-signer/route.ts` - Add passkey via recovery
- `app/api/recovery/get-ghost-derivation/route.ts` - Get passkey for derivation

### To Remove (DEAD)
- All carousel files
- Sovereign mode (or move to /legacy)
- Multiple derivation methods
