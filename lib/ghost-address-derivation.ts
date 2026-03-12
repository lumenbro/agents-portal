/**
 * Ghost G-Address Derivation (v2 - Secure)
 *
 * SECURITY MODEL:
 * - v1 (DEPRECATED): Uses only public inputs - anyone can derive ghost keypair
 * - v2 (CURRENT): Requires server-derived salt from GHOST_CHALLENGE_KEY
 *
 * Same passkey + same salt -> same Ghost G-address forever.
 * Without the salt, attacker cannot derive the ghost keypair.
 */

import { Keypair } from '@stellar/stellar-sdk';

const GHOST_IKM = new TextEncoder().encode('stellar-ghost-v1-2025');
const GHOST_INFO = new TextEncoder().encode('ghost-address');

/**
 * Converts base64url to standard base64
 */
function base64UrlToBase64(base64url: string): string {
  return base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
}

/**
 * Fetches the per-user salt from the server.
 * This salt is derived from GHOST_CHALLENGE_KEY and is unique per passkey.
 *
 * @param passkeyPubkeyBase64 - Passkey public key
 * @returns Base64-encoded user salt
 */
export async function fetchGhostSalt(passkeyPubkeyBase64: string): Promise<string> {
  const response = await fetch('/api/ghost/derive-salt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passkeyPublicKey: passkeyPubkeyBase64 }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch ghost salt');
  }

  const data = await response.json();
  return data.userSalt;
}

/**
 * Derives a deterministic Ghost G-address keypair from a passkey public key.
 *
 * SECURITY: The userSalt parameter is REQUIRED for secure derivation.
 * Without it, anyone with the passkey pubkey can derive the ghost keypair.
 *
 * @param passkeyPubkeyBase64 - Base64 or Base64url-encoded passkey public key (65 bytes for P-256)
 * @param userSalt - Server-derived salt from /api/ghost/derive-salt (REQUIRED for v2)
 * @returns Ed25519 keypair for the Ghost G-address
 */
export async function deriveGhostKeypair(
  passkeyPubkeyBase64: string,
  userSalt?: string
): Promise<Keypair> {
  const isSecure = !!userSalt;
  console.log('[GhostDerivation] Input:', {
    length: passkeyPubkeyBase64?.length,
    first20: passkeyPubkeyBase64?.substring(0, 20),
    hasUrlChars: passkeyPubkeyBase64?.includes('-') || passkeyPubkeyBase64?.includes('_'),
    secureMode: isSecure,
  });

  if (!isSecure) {
    console.warn('[GhostDerivation] INSECURE MODE: No userSalt provided. Anyone can derive this keypair.');
    console.warn('[GhostDerivation] This should only be used for backwards compatibility.');
  }

  // Handle both base64 and base64url formats
  const normalizedBase64 = base64UrlToBase64(passkeyPubkeyBase64);
  console.log('[GhostDerivation] Normalized:', {
    length: normalizedBase64?.length,
    first20: normalizedBase64?.substring(0, 20),
  });

  let passkeyPubkeyRaw: Buffer;
  try {
    passkeyPubkeyRaw = Buffer.from(normalizedBase64, 'base64');
    console.log('[GhostDerivation] Decoded buffer length:', passkeyPubkeyRaw.length);
  } catch (e: any) {
    console.error('[GhostDerivation] Buffer.from failed:', e.message);
    throw e;
  }

  // Build the salt: passkey pubkey + user salt (if provided)
  let saltBuffer: Buffer;
  if (userSalt) {
    const userSaltBuffer = Buffer.from(userSalt, 'base64');
    saltBuffer = Buffer.concat([passkeyPubkeyRaw, userSaltBuffer]);
    console.log('[GhostDerivation] Salt includes userSalt, total length:', saltBuffer.length);
  } else {
    saltBuffer = passkeyPubkeyRaw;
    console.log('[GhostDerivation] Salt is passkey only (INSECURE), length:', saltBuffer.length);
  }

  const key = await crypto.subtle.importKey('raw', GHOST_IKM, 'HKDF', false, ['deriveBits']);

  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(saltBuffer), info: GHOST_INFO },
    key,
    256
  );

  console.log('[GhostDerivation] HKDF deriveBits success, length:', new Uint8Array(bits).length);

  try {
    const keypair = Keypair.fromRawEd25519Seed(Buffer.from(bits));
    console.log('[GhostDerivation] Keypair created:', keypair.publicKey().substring(0, 10) + '...');
    return keypair;
  } catch (e: any) {
    console.error('[GhostDerivation] Keypair.fromRawEd25519Seed failed:', e.message);
    throw e;
  }
}

/**
 * Derives ghost keypair with automatic salt fetching (convenience method).
 * Use this for new registrations and standard flows.
 *
 * @param passkeyPubkeyBase64 - Passkey public key
 * @returns Ed25519 keypair for the Ghost G-address
 */
export async function deriveGhostKeypairSecure(passkeyPubkeyBase64: string): Promise<Keypair> {
  const userSalt = await fetchGhostSalt(passkeyPubkeyBase64);
  return deriveGhostKeypair(passkeyPubkeyBase64, userSalt);
}

/**
 * Server-side salt derivation (no HTTP call needed).
 * Use this when running in API routes where relative URLs don't work.
 *
 * Formula: user_salt = HMAC-SHA256(GHOST_MASTER_KEY, passkey_pubkey)
 *
 * @param passkeyPubkeyBase64 - Passkey public key
 * @returns Base64-encoded user salt
 */
export function deriveGhostSaltServerSide(passkeyPubkeyBase64: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto');

  const ghostMasterKey = process.env.GHOST_MASTER_KEY || process.env.GHOST_CHALLENGE_KEY;
  if (!ghostMasterKey) {
    throw new Error('GHOST_MASTER_KEY/GHOST_CHALLENGE_KEY not configured');
  }

  // Normalize base64url to base64 for consistent input
  const normalizedPubkey = passkeyPubkeyBase64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(passkeyPubkeyBase64.length / 4) * 4, '=');

  // Derive per-user salt using HMAC-SHA256
  const hmac = crypto.createHmac('sha256', ghostMasterKey);
  hmac.update(normalizedPubkey);
  return hmac.digest('base64');
}

/**
 * Server-side ghost keypair derivation (no HTTP call needed).
 * Use this in API routes instead of deriveGhostKeypairSecure.
 *
 * @param passkeyPubkeyBase64 - Passkey public key
 * @returns Ed25519 keypair for the Ghost G-address
 */
export async function deriveGhostKeypairServerSide(passkeyPubkeyBase64: string): Promise<Keypair> {
  const userSalt = deriveGhostSaltServerSide(passkeyPubkeyBase64);
  return deriveGhostKeypair(passkeyPubkeyBase64, userSalt);
}

/**
 * Gets the Ghost G-address public key from a passkey public key.
 *
 * @param passkeyPubkeyBase64 - Base64-encoded passkey public key
 * @param userSalt - Server-derived salt (optional, for secure mode)
 * @returns Ghost G-address public key (G...)
 */
export async function getGhostAddress(
  passkeyPubkeyBase64: string,
  userSalt?: string
): Promise<string> {
  const ghostKp = await deriveGhostKeypair(passkeyPubkeyBase64, userSalt);
  return ghostKp.publicKey();
}

/**
 * Gets the Ghost G-address with automatic salt fetching (convenience method).
 *
 * @param passkeyPubkeyBase64 - Base64-encoded passkey public key
 * @returns Ghost G-address public key (G...)
 */
export async function getGhostAddressSecure(passkeyPubkeyBase64: string): Promise<string> {
  const ghostKp = await deriveGhostKeypairSecure(passkeyPubkeyBase64);
  return ghostKp.publicKey();
}
