/**
 * Passkey Information Fetcher
 *
 * Retrieves passkey info from localStorage first (fast),
 * falls back to database lookup if needed.
 */

import type { PasskeyInfo } from './types';

/**
 * Fetches passkey information for a wallet address.
 *
 * Priority:
 * 1. localStorage (fast, works offline)
 * 2. Database via API (authoritative)
 *
 * @param walletAddress - The C-address of the wallet
 * @returns PasskeyInfo or null if not found
 */
export async function fetchPasskeyInfo(walletAddress: string): Promise<PasskeyInfo | null> {
  console.log('[FetchPasskey] Getting passkey info for:', walletAddress.substring(0, 12) + '...');

  // 1. Try localStorage first (fast path)
  const localKey = `passkey_${walletAddress}`;
  const localData = localStorage.getItem(localKey);

  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      if (parsed.keyId && parsed.publicKey) {
        console.log('[FetchPasskey] Found in localStorage');
        return {
          credentialId: parsed.keyId,
          publicKeyBase64: parsed.publicKey,
          walletAddress,
        };
      }
    } catch (e) {
      console.warn('[FetchPasskey] Failed to parse localStorage data:', e);
    }
  }

  // 2. Fallback to database lookup
  console.log('[FetchPasskey] Not in localStorage, fetching from database...');

  try {
    const response = await fetch(`/api/wallet/passkey?walletAddress=${encodeURIComponent(walletAddress)}`);

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[FetchPasskey] No passkey found in database');
        return null;
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.credentialId || !data.publicKey) {
      console.log('[FetchPasskey] Database returned incomplete data');
      return null;
    }

    // Normalize base64url to base64
    const publicKeyBase64 = normalizeBase64(data.publicKey);

    const passkey: PasskeyInfo = {
      credentialId: data.credentialId,
      publicKeyBase64,
      walletAddress,
    };

    // Cache in localStorage for future fast access
    localStorage.setItem(localKey, JSON.stringify({
      keyId: passkey.credentialId,
      publicKey: passkey.publicKeyBase64,
    }));

    console.log('[FetchPasskey] Fetched from database and cached');
    return passkey;
  } catch (error: any) {
    console.error('[FetchPasskey] Database lookup failed:', error.message);
    return null;
  }
}

/**
 * Converts base64url to standard base64
 */
function normalizeBase64(input: string): string {
  return input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=');
}

/**
 * Stores passkey info in localStorage for fast future access
 */
export function cachePasskeyInfo(passkey: PasskeyInfo): void {
  const localKey = `passkey_${passkey.walletAddress}`;
  localStorage.setItem(localKey, JSON.stringify({
    keyId: passkey.credentialId,
    publicKey: passkey.publicKeyBase64,
  }));
  console.log('[FetchPasskey] Cached passkey info for:', passkey.walletAddress.substring(0, 12) + '...');
}

/**
 * Clears cached passkey info (e.g., on logout)
 */
export function clearPasskeyCache(walletAddress: string): void {
  const localKey = `passkey_${walletAddress}`;
  localStorage.removeItem(localKey);
  console.log('[FetchPasskey] Cleared cache for:', walletAddress.substring(0, 12) + '...');
}
