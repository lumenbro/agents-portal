/**
 * Session Token Refresh
 *
 * Re-authenticates using stored passkey data + ghost keypair derivation.
 * No WebAuthn prompt needed — just the stored passkey public key.
 */

import { deriveGhostKeypairSecure } from '@/lib/ghost-address-derivation';

export interface RefreshResult {
  sessionToken: string;
  walletAddress: string;
  ghostAddress: string;
}

/**
 * Refreshes an expired session token using stored passkey data.
 *
 * Flow:
 * 1. Read agents_passkey from localStorage
 * 2. Derive ghost keypair from passkey public key + server salt
 * 3. Sign fresh challenge with ghost keypair
 * 4. POST /api/auth/token → new session token
 * 5. Update agents_session in localStorage
 */
export async function refreshSessionToken(): Promise<RefreshResult> {
  const stored = localStorage.getItem('agents_passkey');
  if (!stored) {
    throw new Error('NO_PASSKEY_DATA');
  }

  const { publicKey, walletAddress, ghostAddress, credentialId } = JSON.parse(stored);
  if (!publicKey || !walletAddress) {
    throw new Error('INCOMPLETE_PASSKEY_DATA');
  }

  // Derive ghost keypair (fetches salt from server via HKDF)
  const ghostKeypair = await deriveGhostKeypairSecure(publicKey);

  // Get fresh challenge
  const challengeRes = await fetch('/api/paymaster/challenge');
  if (!challengeRes.ok) {
    throw new Error('CHALLENGE_FAILED');
  }
  const challengeJson = await challengeRes.json();
  const challenge = challengeJson.data?.challenge || challengeJson.challenge;

  // Sign challenge with ghost keypair
  const challengeBytes = Buffer.from(challenge, 'hex');
  const signature = ghostKeypair.sign(challengeBytes).toString('base64');

  // Get new session token
  const tokenRes = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ghostAddress: ghostKeypair.publicKey(),
      walletAddress,
      challenge,
      signature,
      passkeyPublicKeyBase64: publicKey,
      credentialId: credentialId || undefined,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error('TOKEN_REFRESH_FAILED');
  }

  const tokenData = await tokenRes.json();
  const sessionToken = tokenData.data?.token || tokenData.token;

  if (!sessionToken) {
    throw new Error('NO_TOKEN_IN_RESPONSE');
  }

  // Update localStorage
  const existingSession = JSON.parse(localStorage.getItem('agents_session') || '{}');
  localStorage.setItem('agents_session', JSON.stringify({
    ...existingSession,
    walletAddress,
    ghostAddress,
    sessionToken,
  }));

  return { sessionToken, walletAddress, ghostAddress };
}
