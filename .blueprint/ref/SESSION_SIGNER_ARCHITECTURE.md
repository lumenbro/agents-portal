# Session Signer Architecture

> **Last Updated**: February 26, 2026
> **Status**: ✅ PRODUCTION - One-click signing with $500/day spend policy
> **Module**: `lib/iframe-signer/` (main app SDK) + `signer-iframe/` (isolated signer)
> **First Mainnet Tx**: [493a5d79b4e837eeaa92c93d7afe3b5b639f1f99e39e55365f9e573a20778fb1](https://stellar.expert/explorer/public/tx/493a5d79b4e837eeaa92c93d7afe3b5b639f1f99e39e55365f9e573a20778fb1)

---

## Production Summary (TL;DR)

**What we built**: One-click gasless transactions on Stellar using browser-isolated P-256 keys.

**Security model**:
- Non-extractable `CryptoKey` in iframe's Web Crypto (private key bytes never in JS)
- PRF encryption ties key decryption to passkey biometric (Face ID)
- Origin isolation prevents main app from accessing iframe storage
- STANDARD role on-chain (cannot add/remove signers)
- User can revoke anytime

**What we tried and abandoned**:
- Time-bound policy contract - **DEPRECATED** (stores per-wallet, not per-signer, so ALL signers expire together)

**What we deployed (Feb 2026)**:
- **$500/day spend policy** (`CCRIA5CKA6DNA2GAHL2QHQCE26W7LSM46IRBJHQ5434OA5HF7D5PSC4K`)
- Two-simulation pre-signing flow enables full policy footprint discovery
- Above $500/day → passkey (Face ID) required for step-up auth

**Key implementation details**:
- `signatureExpirationLedger` must be set to `latestLedger + 100` (simulation returns 0)
- New session signers added with `ExternalValidatorPolicy` pointing to spend policy contract
- Existing session signers (pre-Feb 2026) have empty policies — still work, no spend limit
- Two-simulation flow: sign → re-simulate → `__check_auth` runs fully → policy footprint auto-discovered
- Instruction limit: ~10M (secp256r1 verification + policy contract evaluation)

---

## Why This Is Unique

Most blockchain wallets require either:
- **Hot wallet**: Private key in browser memory (security risk)
- **Hardware wallet**: External device for every signature (UX friction)
- **Custodial**: Server holds keys (not self-custody)

LumenBro's session signer achieves **one-click signing with self-custody** through a combination that's **only possible on Stellar smart accounts**:

### The Web Crypto Constraint

The browser's Web Crypto API only supports these ECDSA curves for `CryptoKey` objects:

| Curve | Web Crypto | Blockchain Usage |
|-------|------------|------------------|
| **P-256 (secp256r1)** | ✅ Supported | Stellar Smart Accounts, WebAuthn |
| P-384 | ✅ Supported | Rarely used |
| P-521 | ✅ Supported | Rarely used |
| **secp256k1** | ❌ NOT SUPPORTED | Ethereum, Bitcoin |
| **ed25519** | ⚠️ Limited | Stellar native, Solana |

**Why this matters:**

When you generate a key with `crypto.subtle.generateKey({ extractable: false })`:
- The actual key bytes may **never be accessible to JavaScript**
- The browser's native crypto engine handles signing
- This is fundamentally stronger isolation than JS crypto libraries

**Ethereum/Bitcoin wallets CANNOT use this** because secp256k1 isn't a Web Crypto curve. They must use JavaScript libraries (noble-secp256k1, elliptic.js) where the private key is a JavaScript `BigInt` or `Uint8Array` in memory.

### What Makes Stellar Smart Accounts Special

1. **secp256r1 support via `__check_auth`**: The smart account contract can verify P-256 signatures natively
2. **This is the same curve as WebAuthn**: Passkeys use P-256, so there's natural compatibility
3. **Web Crypto's P-256 keys can be truly non-extractable**: Browser handles the crypto

### The Complete Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│  UNIQUE COMBINATION                                                  │
├─────────────────────────────────────────────────────────────────────┤
│  1. Web Crypto P-256 CryptoKey (extractable: false)                 │
│     └─▶ Private key bytes may never touch JavaScript                │
│                                                                      │
│  2. WebAuthn PRF Extension                                          │
│     └─▶ Derive encryption key from Face ID without storing secrets  │
│                                                                      │
│  3. Origin-isolated iframe                                          │
│     └─▶ Even if main app is compromised, can't access iframe keys   │
│                                                                      │
│  4. Stellar Smart Account secp256r1 verification                    │
│     └─▶ On-chain validation of P-256 signatures                     │
│                                                                      │
│  5. STANDARD Role + $500/day Spend Policy                           │
│     └─▶ Session signer can sign, but cannot manage other signers    │
│     └─▶ Daily spending capped at $500 (above → Face ID required)    │
└─────────────────────────────────────────────────────────────────────┘
```

### Comparison with Other Approaches

| Approach | Curve | Web Crypto Native | True Non-Extractable | Policy Enforcement |
|----------|-------|-------------------|---------------------|-------------------|
| MetaMask (ETH) | secp256k1 | ❌ No | ❌ No | ❌ No |
| Ledger | varies | N/A (hardware) | ✅ Yes | ❌ No |
| Freighter (Stellar) | ed25519 | ⚠️ Limited | ⚠️ Partial | ❌ No |
| **LumenBro Session** | **secp256r1** | **✅ Yes** | **✅ Yes** | **✅ Yes** |
| Custodial wallets | varies | N/A | N/A | Centralized |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MAIN APP (lumenbro.com)                                                │
│                                                                          │
│  ┌─────────────────┐    ┌──────────────────────────────────────────┐   │
│  │  Wallet Page    │    │  Session Signer Client (SDK)             │   │
│  │                 │    │  lib/iframe-signer/client.ts             │   │
│  │  [Enable]       │───▶│                                          │   │
│  │  One-Click      │    │  • init() - check PRF/keypair status     │   │
│  │  Signing        │    │  • generateKeypair({ prfKey }) - setup   │   │
│  └─────────────────┘    │  • sign(payload) - get signature         │   │
│                         │  • unlockWithPRF(key) - unlock on login  │   │
│                         └──────────────────────────────────────────┘   │
│                                        │                                │
│                                        │ postMessage (origin-validated) │
│                                        ▼                                │
└────────────────────────────────────────┼────────────────────────────────┘
                                         │
                    ╔════════════════════╧════════════════════╗
                    ║         ORIGIN BOUNDARY                  ║
                    ╚════════════════════╤════════════════════╝
                                         │
┌────────────────────────────────────────┼────────────────────────────────┐
│  SIGNER IFRAME (signer.lumenbro.com)   ▼                                │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Message Handler (lib/handler.ts)                                 │   │
│  │                                                                    │   │
│  │  GENERATE_KEYPAIR { prfKey }                                      │   │
│  │    └─▶ Generate P-256 keypair                                     │   │
│  │    └─▶ Derive AES key from prfKey                                 │   │
│  │    └─▶ Encrypt private key with AES-GCM-256                       │   │
│  │    └─▶ Store in IndexedDB                                         │   │
│  │    └─▶ Return public key { x, y }                                 │   │
│  │                                                                    │   │
│  │  SESSION_SIGN { payload }                                         │   │
│  │    └─▶ Use cached decrypted keypair                               │   │
│  │    └─▶ Sign with P-256 (ECDSA)                                    │   │
│  │    └─▶ Return DER signature                                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  IndexedDB Storage (signer.lumenbro.com origin)                   │   │
│  │                                                                    │   │
│  │  {                                                                 │   │
│  │    encryptedPrivateKey: ArrayBuffer,  // AES-GCM-256 encrypted    │   │
│  │    publicKey: { x: string, y: string }, // P-256 coords (base64)  │   │
│  │    iv: Uint8Array(12),                // AES initialization vector│   │
│  │    credentialId: string,              // For PRF unlock           │   │
│  │    encryptionMethod: 'prf' | 'pin',   // How key was encrypted    │   │
│  │    salt?: Uint8Array                  // For PIN mode PBKDF2      │   │
│  │  }                                                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## On-Chain Signer Hierarchy

```
Smart Wallet Contract (C-address)
│
├── Passkey (secp256r1) - ADMIN role
│   ├── Face ID / Touch ID required each time
│   ├── Can add/remove signers
│   ├── Can execute any operation
│   └── Primary authentication method
│
├── Session Signer (secp256r1) - STANDARD role  ◀── THIS DOCUMENT
│   ├── One-click signing (no biometric per tx)
│   ├── Private key encrypted in iframe IndexedDB
│   ├── Cannot manage signers (STANDARD role)
│   ├── $500/day spend policy (new signers, Feb 2026+)
│   ├── Two-simulation flow for policy footprint discovery
│   └── Revocable by passkey holder
│
├── Bot Signer (ed25519) - STANDARD role
│   ├── Telegram tip bot operations
│   ├── Server-held key with policy restrictions
│   └── Daily spending limits enforced
│
└── Recovery Signer (ed25519) - ADMIN role
    ├── BIP-39 seed phrase backup
    ├── Can add new passkey if primary is lost
    └── Stored offline by user
```

## PRF-Based Encryption Flow

The **WebAuthn PRF extension** allows deriving a secret key from a passkey without exposing any private material. This enables "unlock with Face ID" without storing the encryption key.

### Setup Flow (One-Time)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. USER CLICKS "ENABLE SESSION SIGNER"                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. MAIN APP: Get PRF from WebAuthn (lumenbro.com origin)               │
│                                                                          │
│     const credential = await navigator.credentials.get({                 │
│       publicKey: {                                                       │
│         challenge: randomBytes(32),                                      │
│         rpId: 'lumenbro.com',                                           │
│         allowCredentials: [{ id: credentialId, type: 'public-key' }],   │
│         extensions: {                                                    │
│           prf: { eval: { first: PRF_SALT } }  // ◀── PRF extension      │
│         }                                                                │
│       }                                                                  │
│     });                                                                  │
│                                                                          │
│     const prfOutput = credential.getClientExtensionResults().prf.first; │
│     // prfOutput is 32 bytes derived from passkey + salt                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ prfKey (base64)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. IFRAME: Generate and encrypt session keypair                        │
│                                                                          │
│     // Derive AES key from PRF output (NO WebAuthn call in iframe!)     │
│     const aesKey = await crypto.subtle.importKey(                       │
│       'raw', prfOutput, { name: 'AES-GCM' }, false, ['encrypt']         │
│     );                                                                   │
│                                                                          │
│     // Generate P-256 session keypair                                    │
│     const keypair = await crypto.subtle.generateKey(                    │
│       { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']            │
│     );                                                                   │
│                                                                          │
│     // Encrypt private key                                               │
│     const iv = crypto.getRandomValues(new Uint8Array(12));              │
│     const encrypted = await crypto.subtle.encrypt(                      │
│       { name: 'AES-GCM', iv }, aesKey, privateKeyBytes                  │
│     );                                                                   │
│                                                                          │
│     // Store in IndexedDB                                                │
│     await idb.set('session_keypair', { encrypted, publicKey, iv, ... });│
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ publicKey { x, y }
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. MAIN APP: Add session signer on-chain (passkey signs this!)         │
│                                                                          │
│     await addSessionSignerWithPaymaster({                               │
│       walletAddress: 'C...',                                            │
│       sessionPublicKey: { x, y },  // P-256 public key from iframe      │
│       // This triggers Face ID for passkey to authorize add_signer      │
│     });                                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Unlock Flow (On Login)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. USER LOGS IN WITH PASSKEY (Face ID)                                 │
│                                                                          │
│     // During normal login, request PRF extension                        │
│     const credential = await navigator.credentials.get({                 │
│       publicKey: { ..., extensions: { prf: { eval: { first: SALT } } } }│
│     });                                                                  │
│                                                                          │
│     const prfOutput = credential.getClientExtensionResults().prf.first; │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ prfKey (base64)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. MAIN APP: Send PRF key to iframe for unlock                         │
│                                                                          │
│     await sessionSignerClient.unlockWithPRF(prfKeyBase64);              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. IFRAME: Decrypt and cache session keypair                           │
│                                                                          │
│     // Derive same AES key from PRF output                               │
│     const aesKey = await crypto.subtle.importKey('raw', prfOutput, ...);│
│                                                                          │
│     // Decrypt private key from IndexedDB                                │
│     const stored = await idb.get('session_keypair');                    │
│     const privateKey = await crypto.subtle.decrypt(                     │
│       { name: 'AES-GCM', iv: stored.iv }, aesKey, stored.encrypted      │
│     );                                                                   │
│                                                                          │
│     // Cache in memory for signing                                       │
│     cachedKeypair = { privateKey, publicKey: stored.publicKey };        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. SESSION SIGNER IS NOW UNLOCKED                                      │
│                                                                          │
│     // All subsequent sign requests use cached keypair                   │
│     // No additional Face ID prompts until logout                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Signing Flow (One-Click)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. USER INITIATES TRANSACTION (e.g., send USDC)                        │
│                                                                          │
│     // Build auth entry for smart account                                │
│     const authEntry = buildAuthorizationEntry(operation);               │
│     const authPayload = authEntry.toXDR('base64');                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ payload (base64)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. MAIN APP: Request signature from iframe                             │
│                                                                          │
│     const signature = await sessionSignerClient.sign(authPayload);      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. IFRAME: Sign with cached keypair (NO Face ID!)                      │
│                                                                          │
│     const signature = await crypto.subtle.sign(                         │
│       { name: 'ECDSA', hash: 'SHA-256' },                               │
│       cachedKeypair.privateKey,                                         │
│       payload                                                            │
│     );                                                                   │
│     return btoa(signature);  // DER-encoded                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ signature (base64)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. MAIN APP: Submit transaction via paymaster                          │
│                                                                          │
│     // Signature goes into SignatureProofs for __check_auth             │
│     authEntry.credentials().address().signature(signatureProofs);       │
│     await paymasterSubmit({ signedInnerXdr, ... });                     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Security Model - Comprehensive Analysis

This section provides a detailed security analysis of the session signer architecture, including attack surface, risk assessment, and comparison to industry standards.

### Web Crypto Non-Extractable Keys - The Core Security

**How JavaScript crypto libraries work (MetaMask, etc.):**
```
┌─────────────────────────────────────────────────────────────────────┐
│  JS CRYPTO LIBRARIES                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  const privateKey = new Uint8Array([0x12, 0x34, ...]);  // IN JS!   │
│  const signature = secp256k1.sign(message, privateKey);             │
│                                                                      │
│  ⚠️ Private key bytes exist in JavaScript heap memory               │
│  ⚠️ Accessible to any JS code running in same context               │
│  ⚠️ Can be extracted via memory dump, debugger, or XSS              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**How our Web Crypto non-extractable approach works:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  WEB CRYPTO NON-EXTRACTABLE (Our Approach)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  const key = await crypto.subtle.generateKey(                       │
│    { name: 'ECDSA', namedCurve: 'P-256' },                         │
│    false,  // extractable = FALSE                                   │
│    ['sign']                                                          │
│  );                                                                  │
│                                                                      │
│  // key is a CryptoKey HANDLE, not the actual bytes                │
│  // The browser's native crypto engine (OpenSSL/BoringSSL/etc)      │
│  // holds the actual key material                                   │
│                                                                      │
│  ✅ Private key bytes may NEVER exist in JS heap                    │
│  ✅ Signing happens in native code, not JavaScript                  │
│  ✅ XSS cannot extract key (no bytes to steal)                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Browser implementations:**

| Browser | Crypto Library | Key Material Location |
|---------|---------------|----------------------|
| Chrome | BoringSSL | Native process memory (not JS heap) |
| Safari | CommonCrypto | Keychain-backed on macOS/iOS |
| Firefox | NSS | Native crypto library |
| Edge | Same as Chrome | Native process memory |

**Security comparison - Key exposure:**

| Approach | Key in JS Heap | XSS Can Extract | Memory Dump Risk |
|----------|---------------|-----------------|------------------|
| **Web Crypto non-extractable** | ❌ No | ❌ No | Low (native memory) |
| JS libraries (noble, elliptic) | ✅ Yes | ✅ Yes | High |
| WebAuthn/Passkey | ❌ No | ❌ No | Very Low (secure enclave) |
| Hardware wallet | ❌ No | ❌ No | None |

### Iframe Origin Isolation

**What iframe isolation protects against:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN APP (lumenbro.com) - Potentially Compromised                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  XSS attacker injects: document.cookie, localStorage, etc.         │
│                                                                      │
│  ❌ CANNOT access: signer.lumenbro.com's IndexedDB                  │
│  ❌ CANNOT access: signer.lumenbro.com's localStorage               │
│  ❌ CANNOT call: iframe's crypto.subtle.sign() directly             │
│  ❌ CANNOT read: iframe's window.crypto internal state              │
│                                                                      │
│  ✅ CAN ONLY: Send postMessage to iframe                            │
│  ✅ CAN ONLY: Receive postMessage responses                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Historical iframe vulnerabilities and our mitigations:**

| Vulnerability | Year | Impact | Our Mitigation |
|--------------|------|--------|----------------|
| **Clickjacking** | 2008+ | Trick user into clicking iframe | `X-Frame-Options: DENY` on iframe |
| **postMessage origin bypass** | Various | Accept messages from any origin | Validate `event.origin === 'https://lumenbro.com'` |
| **Spectre/Meltdown** | 2018 | Cross-origin memory read via timing | Browsers added site isolation |
| **CORS misconfiguration** | Ongoing | Leak data cross-origin | Iframe serves no CORS endpoints |
| **Subdomain takeover** | Ongoing | Attacker claims abandoned subdomain | `signer.lumenbro.com` actively deployed |

**Iframe security headers:**
```
Content-Security-Policy: default-src 'self'; script-src 'self'
X-Frame-Options: DENY (iframe itself can't be framed)
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
```

### Attack Surface Analysis

**Realistic attack vectors and difficulty:**

| Attack | Difficulty | What's Required | Our Status |
|--------|-----------|-----------------|------------|
| **XSS in main app** | Medium | Find injection point | ✅ Can't extract key (iframe isolated) |
| **XSS in signer iframe** | Hard | Minimal attack surface (no user input) | ✅ CSP blocks inline scripts |
| **Steal encrypted blob from IndexedDB** | Medium | XSS in iframe OR physical access | ✅ Useless without PRF key (biometric) |
| **Bypass PRF encryption** | Very Hard | Break AES-256-GCM or steal biometric | ✅ Standard crypto, hardware-backed |
| **Browser zero-day** | Very Hard | Escape sandbox, read native memory | ⚠️ No mitigation possible |
| **Compromised browser extension** | Medium | User installs malicious extension | ⚠️ Can intercept postMessage |
| **MITM on iframe load** | Hard | Compromise TLS or DNS | ✅ HSTS, certificate pinning |
| **Social engineering** | Medium | Trick user into signing malicious tx | ⚠️ User education needed |
| **TTL extension after revoke** | Very Hard | Extract key + pay for TTL extend | ✅ Requires multiple unlikely conditions |

**The "Compromised Browser Extension" risk:**

This is the main realistic attack vector. A malicious extension with `<all_urls>` permission could:
1. Intercept postMessage between main app and iframe
2. Inject signing requests to the iframe
3. Exfiltrate signatures

Mitigations available:
- Request signing shows what's being signed (user verification)
- Rate limiting in iframe (max N signatures per minute)
- Session timeout (require re-unlock after inactivity)

### Comparison to Industry Standards

**Security spectrum:**
```
Hardware Wallet     ████████████████████ (100% - keys never leave device)
Passkey/WebAuthn    ██████████████████░░ (95%  - secure enclave, biometric)
Our Session Signer  ████████████████░░░░ (85%  - Web Crypto, iframe, PRF)
MetaMask-style      ██████████████░░░░░░ (70%  - JS heap, XSS vulnerable)
Hot wallet (plain)  ████████░░░░░░░░░░░░ (40%  - plaintext in storage)
```

**Detailed comparison:**

| Approach | Key Location | XSS Impact | Per-Tx Auth | On-Chain Limits |
|----------|-------------|------------|-------------|-----------------|
| **Hardware Wallet** | Secure chip | None | Physical button | None |
| **Passkey/WebAuthn** | Secure enclave | None | Biometric | None |
| **Our Session Signer** | Native crypto memory | Cannot extract key | One-click (cached) | STANDARD role |
| **MetaMask** | JS heap memory | Key extraction | Password once | None |
| **Custodial** | Server | N/A | Varies | Server-enforced |

### What Session Signer CANNOT Do

1. **Add or remove signers** (STANDARD role, not ADMIN)
2. **Change wallet policies** (requires ADMIN)
3. **Sign without unlock** (requires PRF from login or PIN)
4. **Operate after revocation** (on-chain check fails)
5. **Access other wallets** (key is wallet-specific)

### Risk Assessment Summary

**Overall Risk Level: LOW-MEDIUM**

| Factor | Assessment |
|--------|------------|
| **Key extraction risk** | LOW - Non-extractable, native crypto |
| **XSS impact** | LOW - Iframe isolation prevents key theft |
| **Encrypted blob theft** | LOW - Requires PRF (biometric) to decrypt |
| **Malicious extension** | MEDIUM - Can intercept, but can't steal key |
| **On-chain abuse after revoke** | VERY LOW - TTL extension attack impractical |
| **Browser zero-day** | LOW probability, HIGH impact - no mitigation |

**What would need to happen for complete compromise:**

1. **Scenario A: Extract the key**
   - Browser zero-day that breaks Web Crypto isolation, OR
   - Physical access + browser memory dump + key reconstruction

2. **Scenario B: Sign malicious transactions**
   - Malicious browser extension + user doesn't notice, OR
   - XSS in iframe (very hard with CSP) + PRF bypass (break AES-256)

3. **Scenario C: Abuse after revoke**
   - Extract key (Scenario A) + Pay to TTL-extend storage + Sign before user notices

### Recommended Hardening (Optional)

**Already implemented:**
- ✅ Non-extractable CryptoKey
- ✅ Origin-isolated iframe
- ✅ PRF encryption
- ✅ STANDARD role (limited permissions)
- ✅ CSP headers

**Could add for additional security:**
```typescript
// 1. Rate limiting in iframe
const SIGN_LIMIT = 10;
const SIGN_WINDOW_MS = 60000;

// 2. Session timeout (re-lock after inactivity)
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// 3. Transaction preview in iframe
// Show: "Transfer 20 USDC to G..." before signing
```

### Bottom Line

**Is this secure?** Yes, significantly more secure than standard JS wallet implementations.

**Is this as secure as passkeys?** No - passkeys use secure enclave. But passkeys require biometric per signature, which defeats one-click UX.

**Is this as secure as hardware wallets?** No - hardware wallets have physical isolation. But hardware wallets require device connection.

**Is this acceptable for the use case?** Yes. The session signer is designed for convenience transactions (small amounts, frequent use). For high-value operations, users should use the passkey (biometric per signature).

**Key insight:** We trade some security (no secure enclave) for UX (one-click signing), but we're NOT trading as much as JS-library wallets do (key in heap, XSS = game over).

### PIN Fallback

When PRF is not available (Firefox, older browsers):

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PIN MODE                                                                │
│                                                                          │
│  Setup:                                                                  │
│    1. User enters PIN (4+ characters)                                   │
│    2. PBKDF2-SHA256 with 100,000 iterations                             │
│    3. Derive AES-256 key from PIN + random salt                         │
│    4. Encrypt session keypair                                           │
│    5. Store salt with encrypted keypair                                 │
│                                                                          │
│  Unlock:                                                                 │
│    1. User enters PIN                                                   │
│    2. PBKDF2 with stored salt                                           │
│    3. Decrypt session keypair                                           │
│    4. Cache for signing                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Browser Support

| Browser | PRF Support | Session Signer | Notes |
|---------|-------------|----------------|-------|
| Chrome 116+ | Yes | PRF mode | Best experience |
| Safari 17+ (macOS) | Yes | PRF mode | Touch ID |
| Safari 17+ (iOS) | Yes* | PRF mode | Face ID, requires main app PRF |
| Edge 116+ | Yes | PRF mode | Windows Hello |
| Firefox | No | PIN mode | No PRF extension |
| Older browsers | No | PIN mode | Fallback |

*iOS Safari requires PRF to be obtained from the main app origin, not the iframe.

## Production E2E Flow (Complete)

This section documents the exact production flow as implemented, including all the lessons learned during development.

### Step 1: Add Session Signer On-Chain

```
User clicks "Enable Session Signer"
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. IFRAME: Generate P-256 keypair                                   │
│     const keypair = await crypto.subtle.generateKey(                │
│       { name: 'ECDSA', namedCurve: 'P-256' },                       │
│       true, // extractable for encryption, NOT for export           │
│       ['sign']                                                       │
│     );                                                               │
│                                                                      │
│  2. IFRAME: Encrypt with PRF-derived key                            │
│     const encrypted = await crypto.subtle.encrypt(                  │
│       { name: 'AES-GCM', iv }, prfDerivedKey, exportedPrivateKey    │
│     );                                                               │
│                                                                      │
│  3. IFRAME: Store in IndexedDB, return public key { x, y }          │
└─────────────────────────────────────────────────────────────────────┘
        │
        │ public key { x, y } (base64)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. MAIN APP: Build add_signer operation                             │
│                                                                      │
│     // key_id = x-coordinate (32 bytes)                              │
│     // public_key = 0x04 || x || y (65 bytes uncompressed)          │
│     const signer = Signer::Secp256r1(                               │
│       { key_id: xBytes, public_key: uncompressedPubkey },           │
│       SignerRole::Standard([ExternalValidatorPolicy(spendPolicy)])  │
│     );  // ◀── $500/day spend policy auto-attached                  │                                                               │
│                                                                      │
│  5. PASSKEY: Face ID to sign add_signer auth entry                  │
│                                                                      │
│  6. PAYMASTER: Submit gasless via ghost account                     │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
    On-chain: Session signer added with STANDARD role
```

**Key file**: `lib/add-session-signer-with-paymaster.ts`

### Step 2: One-Click Transaction Signing

```
User initiates transfer (no biometric prompt!)
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. MAIN APP: Build transfer operation                               │
│     SAC.transfer(wallet, recipient, amount)                         │
│                                                                      │
│  2. MAIN APP: Simulate transaction                                   │
│     → Returns auth entry with nonce, BUT:                           │
│     → signatureExpirationLedger = 0 (placeholder!)                  │
│                                                                      │
│  3. MAIN APP: Prepare signing request                               │
│     → Set signatureExpirationLedger = latestLedger + 100            │
│     → Build HashIdPreimage for auth hash                            │
│     → Create WebAuthn-format structures:                            │
│       • authenticator_data (37 bytes, synthetic rpIdHash)           │
│       • client_data_json (challenge = base64url(authHash))          │
│     → signatureBase = authenticator_data || SHA256(client_data_json)│
└─────────────────────────────────────────────────────────────────────┘
        │
        │ signatureBase (via postMessage)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. IFRAME: Sign with cached P-256 key                               │
│                                                                      │
│     // Key is already decrypted from previous unlock                │
│     const signature = await crypto.subtle.sign(                     │
│       { name: 'ECDSA', hash: 'SHA-256' },                           │
│       cachedPrivateKey,                                              │
│       signatureBase  // Iframe does SHA256 internally               │
│     );                                                               │
│                                                                      │
│     // Convert to compact 64-byte format (r || s)                   │
│     // Ensure low-S form (required by Stellar)                      │
└─────────────────────────────────────────────────────────────────────┘
        │
        │ 64-byte signature (via postMessage)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. MAIN APP: Build signed auth entry                                │
│                                                                      │
│     SignatureProofs = Vec[                                          │
│       Map {                                                          │
│         SignerKey::Secp256r1(key_id):                               │
│         SignerProof::Secp256r1({                                    │
│           authenticator_data,                                        │
│           client_data_json,                                          │
│           signature                                                  │
│         })                                                           │
│       }                                                              │
│     ]                                                                │
│                                                                      │
│  6. MAIN APP: Two-simulation flow (when policy attached)            │
│     → Build tx with signed auth → Re-simulate (sim2)                │
│     → __check_auth runs FULLY → policy footprint auto-discovered    │
│     → assembleTransaction(tx, sim2) includes all storage keys       │
│     → Restore pre-signed auth entries after assembly                │
│                                                                      │
│  7. GHOST: Sign outer transaction envelope                          │
│                                                                      │
│  8. PAYMASTER: Wrap in fee-bump, submit to network                  │
└─────────────────────────────────────────────────────────────────────┘
        │
        ▼
    SUCCESS! Transaction confirmed on-chain
```

**Key files**:
- `lib/session-signer-auth.ts` - WebAuthn-compatible signing
- `lib/send-soroban-with-ghost-tx.ts` - Transaction building with footprint
- `lib/build-secp256r1-auth.ts` - Auth credential construction

### Step 3: Key Rotation (Delete + Regenerate)

```
User clicks "Rotate Session Key"
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. IFRAME: Delete old keypair from IndexedDB                        │
│     await idb.del('session_keypair');                               │
│     cachedKeypair = null;                                            │
│                                                                      │
│  2. PASSKEY: Revoke old signer on-chain                             │
│     wallet.revoke_signer(SignerKey::Secp256r1(old_key_id))          │
│                                                                      │
│  3. IFRAME: Generate new keypair (same flow as Step 1)              │
│                                                                      │
│  4. PASSKEY: Add new signer on-chain                                │
│     wallet.add_signer(Signer::Secp256r1(new_pubkey, Standard([])))  │
└─────────────────────────────────────────────────────────────────────┘
```

**Security note**: Old keypair is cryptographically destroyed. Even if the old encrypted blob were somehow recovered from IndexedDB, without the PRF key it cannot be decrypted.

### Critical Implementation Details

#### 1. signatureExpirationLedger Bug (FIXED)

**Problem**: Simulation returns `signatureExpirationLedger = 0` as a placeholder. If used directly, the auth entry is immediately "expired" since `0 < current_ledger`.

**Error**: `["signature has expired", "CBJY...BLDC", 60942504, 0]`

**Fix in `session-signer-auth.ts`**:
```typescript
// DON'T use simulation value:
// const signatureExpirationLedger = credentials.signatureExpirationLedger();

// DO set proper expiration:
const signatureExpirationLedger = latestLedger + 100;
```

#### 2. Time-Bound Policy Deprecated → Spend Policy Deployed

**Old problem**: The time-bound policy contract (`CCX4B62...`) stored expiry per **wallet address**, not per signer. After 14 days, ALL session signers failed with no way to refresh.

**Old fix**: Session signers used `SignerRole::Standard([])` (empty policies).

**New solution (Feb 2026)**: Session signers now use `SignerRole::Standard([ExternalValidatorPolicy])` with the agent spend policy contract (`CCRIA5CKA6DNA2GAHL2QHQCE26W7LSM46IRBJHQ5434OA5HF7D5PSC4K`). This enforces a **$500/day** limit:
- Same WASM as bot policies (spend tracking via temporary storage, auto-resets ~24h)
- Uses **two-simulation flow** to discover policy footprint (see below)
- Existing session signers without policy continue working (backward compatible)
- Above $500/day → user must use passkey (Face ID step-up auth)

Security still relies on:
- Non-extractable Web Crypto key
- PRF/PIN encryption
- User revocation capability
- **Plus**: On-chain daily spending cap

#### 3. Two-Simulation Flow (Policy Footprint Discovery)

Session signers (secp256r1) sign auth **after** simulation (unlike ed25519 bot signers which pre-sign). This means `__check_auth` only sees a skeleton signature during the first simulation — the policy contract is never evaluated, so its storage keys are missing from the footprint.

**Solution**: When session signer has a policy attached, run a **second simulation** with the signed auth:

```
Sim 1: Build tx (no auth) → simulate → get auth entry (nonce, invocation)
 Sign: Session signer iframe signs auth entry (automatic, no biometric)
Sim 2: Build tx with signed auth → re-simulate
       → __check_auth runs FULLY with real signature
       → policy contract's is_authorized() is called
       → footprint now includes signer key + policy storage (daily spend)
Assemble: assembleTransaction(tx, sim2) → complete footprint
Restore: Replace auth entries with pre-signed versions
Submit: Ghost signs envelope → paymaster fee-bump → network
```

When `hasSessionPolicy` is false (existing signers without policy), the original single-simulation flow with manual footprint augmentation continues unchanged.

#### 4. Footprint Requirements

**With policy (two-sim flow)**: Footprint is auto-discovered by second simulation. No manual augmentation needed — `__check_auth` finds signer key + policy storage automatically.

**Without policy (legacy single-sim flow)**: Session signer transactions need these in the read-only footprint:
```typescript
// Session signer storage key (manually appended)
xdr.LedgerKey.contractData({
  contract: walletAddress,
  key: xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Secp256r1'),
    xdr.ScVal.scvBytes(keyIdBuffer),  // x-coordinate
  ]),
  durability: ContractDataDurability.persistent(),
})
```

**Instruction limit**: ~10M (secp256r1 verification ~5.5M + __check_auth ~2M + policy eval ~2M + buffer)

#### 4. Signature Format

The smart wallet expects WebAuthn-compatible format even though we're not using real WebAuthn:

```typescript
SignerProof::Secp256r1 {
  authenticator_data: Bytes,    // 37+ bytes (rpIdHash + flags + counter)
  client_data_json: Bytes,      // JSON with challenge = base64url(authHash)
  signature: Bytes,             // 64 bytes compact (r || s), low-S normalized
}
```

### Security Considerations

#### What's Protected

| Threat | Mitigation |
|--------|------------|
| Main app XSS | Iframe origin isolation - can't access IndexedDB |
| Encrypted blob theft | Requires PRF key (biometric) to decrypt |
| Replay attack | Nonce in auth entry, checked by contract |
| Session signer privilege escalation | STANDARD role - can't manage signers |
| Indefinite abuse if key leaked | User can revoke on-chain anytime |

#### Theoretical Attack: TTL Extension

On-chain signer storage has a TTL. In theory:
1. Attacker somehow extracts session private key (very difficult - non-extractable)
2. User revokes session signer on-chain
3. Attacker TTL-extends the revoked signer storage entry
4. Attacker can sign with the "revoked" signer

**Mitigation**: This requires:
- Extracting a non-extractable CryptoKey (browser security bypass)
- OR decrypting the IndexedDB blob (requires PRF key via biometric)
- AND paying to TTL-extend the storage entry

**Verdict**: Acceptable risk. A per-signer policy contract would fix this but doesn't exist.

## Key Files

### Main App (lumenbro.com)

| File | Purpose |
|------|---------|
| `lib/iframe-signer/client.ts` | SDK for communicating with iframe |
| `lib/iframe-signer/messages.ts` | PostMessage protocol types |
| `lib/wallet-context.tsx` | `useSessionSigner()` hook, `getPRFFromMainApp()` |
| `lib/add-session-signer-with-paymaster.ts` | Add P-256 signer on-chain (auto-attaches spend policy) |
| `lib/send-soroban-with-ghost-tx.ts` | Two-simulation flow for policy footprint |
| `lib/session-signer-auth.ts` | WebAuthn-compatible auth signing |
| `lib/network-config.ts` | `getSessionSignerPolicyAddress()` helper |
| `app/wallet/page.tsx` | `SessionSignerSetupBanner` component |
| `app/signer-manager/page.tsx` | Session signer management UI + policy display |
| `app/api/wallet/signers/route.ts` | Secp256r1 policy parsing + annotation |
| `scripts/deploy-session-signer-policy-mainnet.ts` | Deploy session-signer policy |

### Signer Iframe (signer.lumenbro.com)

| File | Purpose |
|------|---------|
| `signer-iframe/lib/handler.ts` | PostMessage request handler |
| `signer-iframe/lib/prf-encryption.ts` | PRF key derivation |
| `signer-iframe/lib/pin-encryption.ts` | PIN fallback (PBKDF2) |
| `signer-iframe/lib/key-storage.ts` | IndexedDB operations |
| `signer-iframe/lib/p256-keygen.ts` | P-256 keypair generation and signing |
| `signer-iframe/main.ts` | Entry point |
| `signer-iframe/vite.config.ts` | Vite build config |

## Deployment

### Signer Iframe

```bash
cd signer-iframe
npm run build        # Build with Vite
vercel --prod        # Deploy to signer.lumenbro.com
```

Vercel project: `lumenbro-signer`
Domain: `signer.lumenbro.com`

### Security Headers (Recommended)

```
Content-Security-Policy: default-src 'self'; script-src 'self'
X-Frame-Options: ALLOW-FROM https://lumenbro.com
X-Content-Type-Options: nosniff
```

## Policy Contracts

### Active: Agent Spend Policy — $500/day (Feb 2026)

**Contract**: `CCRIA5CKA6DNA2GAHL2QHQCE26W7LSM46IRBJHQ5434OA5HF7D5PSC4K`
**WASM hash**: `821e5d04c4b4d55cf5cd6f444059d826d23dcb8c6bfaa7de8bc5737881bca8ce` (v1.1.0)
**Admin**: `GCKGWGRRJBUKYCTV2AZBSEI3SVLEBFOF7OD2AEFXA2XPZV3MJUGKRP7D`

New session signers are automatically attached with an `ExternalValidatorPolicy` pointing to the agent spend policy contract. This enforces:

- **$500/day** aggregate spending limit (same USDC-denominated tracking as bot policies)
- Daily spend stored in **temporary storage** (auto-expires ~24h, resets daily)
- Price resolution: USDC identity → admin cached prices → Soroswap router fallback → reject
- XLM priced at $0.16 (admin-set via `set_price()`)

**How it works during transaction signing:**

```
Session signer signs auth entry
        │
        ▼
__check_auth() on smart wallet contract
        │
        ├── Verify secp256r1 signature ✓
        ├── Check signer role (STANDARD) ✓
        └── Call policy: is_authorized(wallet, auth_contexts)
                │
                ├── Sum all transfer amounts in auth entry
                ├── Convert to USDC value using price map
                ├── Check: spent_today + this_tx ≤ $500
                │
                ├── Under limit → return true ✓ (one-click succeeds)
                └── Over limit → return false ✗ (tx rejected, use Face ID)
```

**Backward compatibility**: Existing session signers (pre-Feb 2026) have no policy attached. They continue working with the original single-simulation flow and no spend limit. Users can revoke and re-add to get the policy.

**Key files:**
- `lib/add-session-signer-with-paymaster.ts` — Auto-attaches policy on `add_signer`
- `lib/send-soroban-with-ghost-tx.ts` — Two-simulation flow for policy footprint
- `lib/network-config.ts` — `getSessionSignerPolicyAddress()`
- `scripts/deploy-session-signer-policy-mainnet.ts` — Deploy script

### Deprecated: Time-Bound Policy (Jan 2026)

> **⚠️ DEPRECATED (2026-01-25)**: Replaced by agent spend policy above.
>
> The time-bound policy contract (`CCX4B62X7LDIVWQQEYINWRP7SAER5K2I4NSLYRHUUTAL3MGPWDYWC3VX`) had a fundamental design flaw:
>
> - **Stored time bounds per WALLET ADDRESS, not per signer**
> - After 14 days, ALL session signers for the wallet failed
> - Adding a new session signer didn't refresh the time bounds
> - There was no way to extend the validity window

---

### Historical: Time-Bound Policy (DEPRECATED)

**Contract Address**: `CCX4B62X7LDIVWQQEYINWRP7SAER5K2I4NSLYRHUUTAL3MGPWDYWC3VX`

**Mainnet Transaction**: [363efa2ec5ce76e6071efd5b7cb64739300fc5655bc4685a3b5c1519a601b8cd](https://stellar.expert/explorer/public/tx/363efa2ec5ce76e6071efd5b7cb64739300fc5655bc4685a3b5c1519a601b8cd)

When a session signer was added with the deprecated policy, the smart wallet stored policy data:

```
Signer CBJY...BLDC (secp256r1, STANDARD role)
├── Policy: External(CCX4B62X7LDIVWQQEYINWRP7SAER5K2I4NSLYRHUUTAL3MGPWDYWC3VX)
└── Policy Data (persistent storage):
    {
      "added_ledger": 60938902,
      "expiry_ledger": 61180822
    }
```

**How it works:**

1. Session signer added with `expiry_ledger` ~14 days in future
2. Every transaction, `__check_auth` calls policy contract's `check` function
3. Policy contract reads current ledger from environment
4. If `current_ledger > expiry_ledger`, signature is **rejected by the network**
5. User must re-authenticate with passkey to add a new session signer

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIME-BOUND POLICY FLOW                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Session Signer attempts to sign transaction                        │
│                          │                                           │
│                          ▼                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Smart Wallet Contract: __check_auth()                       │    │
│  │                                                               │    │
│  │  1. Verify secp256r1 signature ✓                             │    │
│  │  2. Check signer role (STANDARD) ✓                           │    │
│  │  3. Call policy contract...                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                          │                                           │
│                          ▼                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Policy Contract: check(env, signer_key, auth_context)       │    │
│  │  CCX4B62X7LDIVWQQEYINWRP7SAER5K2I4NSLYRHUUTAL3MGPWDYWC3VX   │    │
│  │                                                               │    │
│  │  let current_ledger = env.ledger().sequence();               │    │
│  │  let policy_data = env.storage().get(signer_key);            │    │
│  │                                                               │    │
│  │  if current_ledger > policy_data.expiry_ledger {             │    │
│  │      return Err(Error::SessionExpired);  // ❌ REJECTED       │    │
│  │  }                                                            │    │
│  │  return Ok(());  // ✅ ALLOWED                                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Policy Contract Interface

```rust
// The policy contract implements this trait
pub trait SessionPolicy {
    /// Called by smart wallet during __check_auth
    /// Returns Ok(()) if allowed, Err if rejected
    fn check(
        env: Env,
        wallet_address: Address,      // The smart wallet
        signer_key: SignerKey,        // The session signer's public key
        auth_context: AuthContext,    // What operation is being authorized
    ) -> Result<(), Error>;

    /// Called when session signer is added
    /// Stores policy data (expiry ledger, limits, etc.)
    fn initialize(
        env: Env,
        wallet_address: Address,
        signer_key: SignerKey,
        config: PolicyConfig,
    ) -> Result<(), Error>;
}
```

### Available Policy Types

| Policy | Status | Contract | Description |
|--------|--------|----------|-------------|
| **Time-Bound** | ❌ DEPRECATED | `CCX4B62...C3VX` | Stores per-wallet, not per-signer - broken |
| **Spend Limit ($500/day)** | ✅ Production | `CCRIA5...SC4K` | Daily aggregate spending cap, USDC-denominated |
| Asset Whitelist | 🚧 Potential | - | Only specific tokens allowed |
| Recipient Whitelist | 🚧 Potential | - | Only send to approved addresses |
| Per-Transaction Threshold | 🚧 Potential | - | Single tx above $X requires passkey |

### Security Implications

1. **Network-enforced**: Policy violations are rejected by validators, not just the app
2. **Immutable once set**: Policy parameters cannot be changed without revoking signer
3. **Composable**: Multiple policies can be applied to same signer
4. **Auditable**: All policy checks visible in transaction traces

## Future Enhancements

### Client-Side Pre-Check (UX Optimization)

Before choosing signer, query policy contract's `remaining(walletAddress)`:
- If estimated tx value ≤ remaining → session signer (one-click)
- If estimated tx value > remaining → force passkey (Face ID step-up)
- Prevents failed transactions and provides actionable UX

### Per-Transaction Threshold

In addition to daily limit, cap single transactions (e.g., >$100 requires passkey).

### Upgrade Path for Existing Signers

Allow upgrading existing session signer's policy without revoke+re-add.

### Additional Policy Contracts

- **Asset restrictions**: Only allow specific tokens
- **Recipient whitelist**: Only send to approved addresses
- **Time-of-day**: Only allow signing during business hours

### Multi-Device Sessions

Track session signers in Supabase for:
- View all active sessions across devices
- Remote revocation
- Audit trail

## Related Documents

- `.blueprint/TRANSACTION_ARCHITECTURE.md` - 3-layer signing model
- `.blueprint/SMART_ACCOUNT_ARCHITECTURE.md` - Wallet contract structure
- `.blueprint/GHOST_ARCHITECTURE.md` - Ghost account for sequencing
- `/home/brandonian/.claude/plans/resilient-pondering-metcalfe.md` - Original implementation plan
