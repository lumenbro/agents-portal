/**
 * Stateless Challenge Store for Paymaster (Serverless-compatible)
 *
 * Uses HMAC-signed challenges instead of in-memory storage.
 * This works in Vercel serverless because no shared state is needed.
 *
 * Challenge format: nonce:timestamp:signature
 * - nonce: random 32 bytes (hex)
 * - timestamp: Unix timestamp when created (ms)
 * - signature: HMAC-SHA256 of "nonce:timestamp" with secret
 */

import { createHmac, randomBytes } from 'crypto';

// Get secret from environment, fallback for development
const CHALLENGE_SECRET = process.env.PAYMASTER_CHALLENGE_SECRET ||
  process.env.PAYMASTER_SECRET ||
  'dev-secret-change-in-production';

/**
 * Generate a signed challenge
 * Returns a self-contained challenge string that can be verified without shared state
 */
export function generateSignedChallenge(expiresIn: number = 120): string {
  const nonce = randomBytes(32).toString('hex');
  const timestamp = Date.now();
  const expiresAt = timestamp + expiresIn * 1000;

  // Create signature of nonce:timestamp:expiresAt
  const payload = `${nonce}:${timestamp}:${expiresAt}`;
  const hmac = createHmac('sha256', CHALLENGE_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');

  // Return challenge as: nonce:timestamp:expiresAt:signature
  const challenge = `${nonce}:${timestamp}:${expiresAt}:${signature}`;

  console.log(`[ChallengeStore] Generated signed challenge: ${nonce.substring(0, 16)}... (expires in ${expiresIn}s)`);

  return challenge;
}

/**
 * Verify a signed challenge
 * Returns { valid: true, nonce } if valid, { valid: false, reason } if not
 */
export function verifySignedChallenge(challenge: string): {
  valid: boolean;
  nonce?: string;
  reason?: string;
  expiresIn?: number;
} {
  try {
    // Parse challenge: nonce:timestamp:expiresAt:signature
    const parts = challenge.split(':');
    if (parts.length !== 4) {
      return { valid: false, reason: 'Invalid challenge format' };
    }

    const [nonce, timestampStr, expiresAtStr, providedSignature] = parts;
    const timestamp = parseInt(timestampStr, 10);
    const expiresAt = parseInt(expiresAtStr, 10);

    if (isNaN(timestamp) || isNaN(expiresAt)) {
      return { valid: false, reason: 'Invalid timestamp in challenge' };
    }

    // Verify signature
    const payload = `${nonce}:${timestamp}:${expiresAt}`;
    const hmac = createHmac('sha256', CHALLENGE_SECRET);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    if (providedSignature !== expectedSignature) {
      console.log(`[ChallengeStore] Invalid signature for challenge: ${nonce.substring(0, 16)}...`);
      return { valid: false, reason: 'Invalid signature' };
    }

    // Check expiration
    const now = Date.now();
    if (now > expiresAt) {
      const expiredMs = now - expiresAt;
      console.log(`[ChallengeStore] Challenge expired ${expiredMs}ms ago: ${nonce.substring(0, 16)}...`);
      return { valid: false, reason: `Challenge expired ${Math.round(expiredMs / 1000)}s ago` };
    }

    const expiresIn = expiresAt - now;
    console.log(`[ChallengeStore] Valid challenge: ${nonce.substring(0, 16)}... (expires in ${expiresIn}ms)`);

    return { valid: true, nonce, expiresIn };
  } catch (error: any) {
    console.log(`[ChallengeStore] Error verifying challenge: ${error.message}`);
    return { valid: false, reason: `Verification error: ${error.message}` };
  }
}

// =============================================================================
// Legacy API for backward compatibility (deprecated - now using signed challenges)
// =============================================================================

export function setChallenge(challenge: string, expiresIn: number): void {
  // No-op for signed challenges - the challenge is self-contained
  console.log(`[ChallengeStore] (legacy) setChallenge called - using signed challenges now`);
}

export function getChallenge(challenge: string): { expires: number } | undefined {
  // For signed challenges, verify and return
  const result = verifySignedChallenge(challenge);
  if (result.valid && result.expiresIn) {
    return { expires: Date.now() + result.expiresIn };
  }
  return undefined;
}

export function deleteChallenge(challenge: string): void {
  // No-op for signed challenges - they're stateless
  console.log(`[ChallengeStore] (legacy) deleteChallenge called - signed challenges don't need deletion`);
}

export function getStoreSize(): number {
  // Not applicable for signed challenges
  return 0;
}

export function getAllChallengeIds(): string[] {
  // Not applicable for signed challenges
  return [];
}
