/**
 * Ghost Account Ready Check
 *
 * Ensures ghost account exists and is sponsored before transactions.
 * Uses secure HKDF derivation with server salt.
 */

import { Keypair, Horizon } from '@stellar/stellar-sdk';
import type { GhostReady } from './types';
import { getHorizonUrl } from '@/lib/network-config';

const horizonUrl = getHorizonUrl();

/**
 * Ensures ghost account is ready for transactions.
 *
 * Steps:
 * 1. Fetch user salt from server (secure derivation)
 * 2. Derive ghost keypair using HKDF
 * 3. Check if ghost exists on-chain
 * 4. If not, request sponsorship from paymaster
 * 5. Wait for confirmation
 *
 * @param passkeyPublicKeyBase64 - The passkey public key
 * @param options - Additional options
 * @returns GhostReady with keypair and status
 */
export async function ensureGhostReady(
  passkeyPublicKeyBase64: string,
  options?: {
    skipCreation?: boolean;
    onStatusChange?: (status: string) => void;
  }
): Promise<GhostReady> {
  const updateStatus = options?.onStatusChange || (() => {});

  console.log('[EnsureGhost] Starting with passkey:', passkeyPublicKeyBase64.substring(0, 20) + '...');
  updateStatus('Preparing transaction keypair...');

  // 1. Fetch user salt from server
  updateStatus('Fetching secure salt...');
  const saltResponse = await fetch('/api/ghost/derive-salt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passkeyPublicKey: passkeyPublicKeyBase64 }),
  });

  if (!saltResponse.ok) {
    throw new Error('Failed to fetch ghost salt from server');
  }

  const { userSalt } = await saltResponse.json();
  console.log('[EnsureGhost] Got user salt');

  // 2. Derive ghost keypair using HKDF with salt
  const { deriveGhostKeypair } = await import('../ghost-address-derivation');
  const keypair = await deriveGhostKeypair(passkeyPublicKeyBase64, userSalt);
  const address = keypair.publicKey();

  console.log('[EnsureGhost] Derived ghost address:', address.substring(0, 12) + '...');
  updateStatus('Checking transaction keypair status...');

  // 3. Check if ghost exists on-chain
  let isSponsored = false;

  try {
    const accountResponse = await fetch(`${horizonUrl}/accounts/${address}`);

    if (accountResponse.ok) {
      const account = await accountResponse.json();
      isSponsored = !!account.sponsor;
      console.log('[EnsureGhost] Ghost exists, sponsored:', isSponsored);

      return {
        keypair,
        address,
        userSalt,
        isSponsored,
      };
    }

    // Account doesn't exist (404)
    console.log('[EnsureGhost] Ghost account does not exist on-chain');
  } catch (error: any) {
    console.warn('[EnsureGhost] Error checking ghost account:', error.message);
  }

  // 4. Ghost doesn't exist - create if allowed
  if (options?.skipCreation) {
    throw new Error('Ghost account does not exist and creation is disabled');
  }

  updateStatus('Creating transaction keypair...');
  console.log('[EnsureGhost] Requesting ghost sponsorship from paymaster...');

  // Get challenge for verification
  const challengeResponse = await fetch('/api/paymaster/challenge');
  if (!challengeResponse.ok) {
    throw new Error('Failed to get challenge from paymaster');
  }
  const challengeJson = await challengeResponse.json();
  // Handle both wrapped { data: { challenge } } and unwrapped { challenge } formats
  const challenge = challengeJson.data?.challenge || challengeJson.challenge;
  if (!challenge) {
    throw new Error('No challenge returned from paymaster');
  }

  // Sign challenge with ghost keypair
  const challengeBuffer = Buffer.from(challenge, 'hex');
  const signature = Buffer.from(keypair.sign(challengeBuffer)).toString('base64');

  // Request ghost creation
  const createResponse = await fetch('/api/paymaster/create-ghost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      passkeyPubkeyBase64: passkeyPublicKeyBase64,
      challenge,
      signature,
    }),
  });

  if (!createResponse.ok) {
    const error = await createResponse.json();
    throw new Error(error.error || 'Failed to create ghost account');
  }

  const createResult = await createResponse.json();
  console.log('[EnsureGhost] Ghost creation response:', createResult);

  // 5. Wait for confirmation on Horizon
  if (!createResult.existing) {
    updateStatus('Waiting for blockchain confirmation...');

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const checkResponse = await fetch(`${horizonUrl}/accounts/${address}`);
        if (checkResponse.ok) {
          console.log('[EnsureGhost] Ghost confirmed after', (attempt + 1) * 2, 'seconds');
          isSponsored = true;
          break;
        }
      } catch (e) {}

      console.log('[EnsureGhost] Waiting for confirmation, attempt', attempt + 1);
    }
  } else {
    isSponsored = true;
  }

  updateStatus('Transaction keypair ready');

  return {
    keypair,
    address,
    userSalt,
    isSponsored,
  };
}

/**
 * Quick check if ghost exists (no creation)
 */
export async function checkGhostExists(ghostAddress: string): Promise<boolean> {
  try {
    const response = await fetch(`${horizonUrl}/accounts/${ghostAddress}`);
    return response.ok;
  } catch {
    return false;
  }
}
