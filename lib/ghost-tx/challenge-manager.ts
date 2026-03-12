/**
 * Challenge Manager
 *
 * Handles challenge fetching and signing for paymaster verification.
 * Challenges prove ghost keypair ownership without exposing the secret.
 */

import { Keypair } from '@stellar/stellar-sdk';
import type { SignedChallenge } from './types';

// Challenge cache to avoid refetching during multi-step flows
let cachedChallenge: SignedChallenge | null = null;
const CHALLENGE_BUFFER_MS = 30000; // 30 second buffer before expiry

/**
 * Gets a signed challenge for paymaster submission.
 *
 * Uses caching to avoid unnecessary API calls during multi-step flows.
 * Automatically refreshes if challenge is expired or about to expire.
 *
 * @param ghostKeypair - The ghost keypair to sign with
 * @param forceRefresh - Force fetch new challenge
 * @returns SignedChallenge ready for paymaster
 */
export async function getSignedChallenge(
  ghostKeypair: Keypair,
  forceRefresh = false
): Promise<SignedChallenge> {
  const now = Date.now();

  // Check if cached challenge is still valid
  if (!forceRefresh && cachedChallenge) {
    if (cachedChallenge.expiresAt - now > CHALLENGE_BUFFER_MS) {
      console.log('[ChallengeManager] Using cached challenge');
      return cachedChallenge;
    }
    console.log('[ChallengeManager] Cached challenge expired or expiring soon');
  }

  // Fetch new challenge
  console.log('[ChallengeManager] Fetching new challenge...');

  const response = await fetch('/api/paymaster/challenge');
  if (!response.ok) {
    throw new Error(`Failed to get challenge: ${response.status}`);
  }

  const data = await response.json();
  const challenge = data.challenge || data.data?.challenge;
  const expiresIn = data.expiresIn || 120; // Default 2 minutes

  if (!challenge) {
    throw new Error('No challenge in response');
  }

  // Sign challenge with ghost keypair
  const challengeBuffer = Buffer.from(challenge, 'hex');
  const signature = Buffer.from(ghostKeypair.sign(challengeBuffer)).toString('base64');

  cachedChallenge = {
    challenge,
    signature,
    expiresAt: now + (expiresIn * 1000),
  };

  console.log('[ChallengeManager] Challenge signed, expires in', expiresIn, 'seconds');

  return cachedChallenge;
}

/**
 * Clears the cached challenge (e.g., after successful submission)
 */
export function clearChallengeCache(): void {
  cachedChallenge = null;
  console.log('[ChallengeManager] Cache cleared');
}

/**
 * Checks if there's a valid cached challenge
 */
export function hasCachedChallenge(): boolean {
  if (!cachedChallenge) return false;
  return cachedChallenge.expiresAt - Date.now() > CHALLENGE_BUFFER_MS;
}
