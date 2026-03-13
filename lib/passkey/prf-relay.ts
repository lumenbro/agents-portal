/**
 * PRF Relay Module — Stateless PRF-Derived Stellar Deposit Address
 *
 * Derives an ed25519 keypair from WebAuthn PRF output via HKDF.
 * Uses @stellar/stellar-sdk Keypair (already in bundle) instead of
 * @noble/ed25519 — simpler, no additional dependency.
 *
 * Flow: Face ID → PRF output (32 bytes) → HKDF → ed25519 seed → Keypair → G-address
 *
 * The PRF G-address is the user's deposit address for:
 * - Coinbase Onramp
 * - External deposits
 * - Exchange withdrawals (supports MEMO, unlike C-address)
 *
 * Funds are swept from PRF → C-address (smart wallet vault) after arrival.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { getRpId } from './crossmint-webauthn';

const PRF_SALT = 'lumenbro:stellar:relay:v1';
const HKDF_INFO = 'lumenbro:ed25519:seed:v1';

/**
 * Derive a 32-byte ed25519 seed from PRF output using HKDF-SHA256.
 *
 * Even though PRF output is already 32 bytes of high-entropy material,
 * HKDF adds domain separation — ensuring the same PRF output used for
 * different purposes produces different keys.
 */
async function deriveEd25519Seed(prfOutput: Uint8Array): Promise<Buffer> {
  // Copy to a fresh ArrayBuffer to satisfy strict TypeScript BufferSource typing
  const inputBuffer = new ArrayBuffer(prfOutput.length);
  new Uint8Array(inputBuffer).set(prfOutput);

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    inputBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );

  const seedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // empty salt (all zeros) — matches main app
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    256
  );

  return Buffer.from(seedBits);
}

/**
 * Derive a Stellar Keypair from PRF output.
 * Uses stellar-sdk Keypair.fromRawEd25519Seed() — no @noble/ed25519 needed.
 */
export async function deriveRelayKeypair(prfOutput: Uint8Array): Promise<Keypair> {
  const seed = await deriveEd25519Seed(prfOutput);
  return Keypair.fromRawEd25519Seed(seed);
}

/**
 * Derive relay G-address from PRF output.
 */
export async function deriveRelayAddress(prfOutput: Uint8Array): Promise<string> {
  const kp = await deriveRelayKeypair(prfOutput);
  return kp.publicKey();
}

/**
 * Request WebAuthn PRF output from the user's passkey.
 * Returns 32 bytes of deterministic, passkey-bound material.
 *
 * @param credentialId - base64url-encoded credential ID from registration
 * @returns PRF output (32 bytes) or null if PRF not supported
 */
export async function getPrfOutput(credentialId: string): Promise<Uint8Array> {
  const base64url = (await import('base64url')).default;
  const rpId = getRpId();
  const saltBytes = new TextEncoder().encode(PRF_SALT);

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials: [{
        id: Uint8Array.from(base64url.toBuffer(credentialId)),
        type: 'public-key' as const,
      }],
      userVerification: 'required',
      extensions: {
        prf: {
          eval: { first: saltBytes },
        },
      } as any,
    },
  }) as any;

  if (!credential) {
    throw new Error('Passkey authentication cancelled');
  }

  const prfResults = credential.getClientExtensionResults()?.prf?.results;
  if (!prfResults?.first) {
    throw new Error(
      'PRF extension not supported by this passkey/browser. ' +
      'Try Chrome 132+ or Safari 18+ with a platform authenticator.'
    );
  }

  return new Uint8Array(prfResults.first);
}

/**
 * Check if the current browser/authenticator supports PRF extension.
 * Returns true if PublicKeyCredential.getClientCapabilities exists and reports prf support,
 * or falls back to a heuristic based on browser detection.
 */
export async function supportsPrf(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;

  // Chrome 132+ supports getClientCapabilities
  if ('getClientCapabilities' in PublicKeyCredential) {
    try {
      const caps = await (PublicKeyCredential as any).getClientCapabilities();
      return caps?.prf === true || caps?.['hmac-secret'] === true;
    } catch {
      // Fall through to heuristic
    }
  }

  // Heuristic: platform authenticator + modern browser likely supports PRF
  const isChrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
  if (isChrome && parseInt(isChrome[1]) >= 132) return true;

  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const safariVersion = /Version\/(\d+)/.exec(navigator.userAgent);
  if (isSafari && safariVersion && parseInt(safariVersion[1]) >= 18) return true;

  return false;
}

/**
 * Full flow: prompt passkey → derive relay address.
 * Convenience function combining getPrfOutput + deriveRelayKeypair.
 *
 * @returns { address, keypair, prfOutput } — caller can cache prfOutput for signing later
 */
export async function deriveRelayWithPasskey(credentialId: string): Promise<{
  address: string;
  keypair: Keypair;
  prfOutput: Uint8Array;
}> {
  const prfOutput = await getPrfOutput(credentialId);
  const keypair = await deriveRelayKeypair(prfOutput);
  return {
    address: keypair.publicKey(),
    keypair,
    prfOutput,
  };
}
