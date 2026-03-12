/**
 * Shared WebAuthn RP ID utility
 *
 * Ensures consistent rpId handling across all passkey operations:
 * - Registration (wallet creation)
 * - Signing (crossmint-webauthn.ts)
 * - Recovery (add-passkey flow)
 *
 * The rpId determines which domain(s) a passkey is bound to.
 * The agents portal uses its own subdomain as rpID for isolation.
 */

/**
 * Get the RP ID for WebAuthn operations.
 * This should be used for BOTH registration AND signing to ensure consistency.
 *
 * Priority:
 * 1. NEXT_PUBLIC_WEBAUTHN_RP_ID environment variable (if set)
 * 2. Hostname-based logic
 *
 * @returns The RP ID to use for WebAuthn operations
 */
export function getWebAuthnRpId(): string {
  if (typeof window === 'undefined') {
    return 'localhost';
  }

  const hostname = window.location.hostname;

  // For localhost, always use "localhost"
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }

  // Check environment variable first (allows override)
  if (process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID) {
    return process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID;
  }

  // Agents portal uses its own subdomain as rpID for isolation
  if (hostname === 'agents.lumenbro.com') {
    return 'agents.lumenbro.com';
  }

  // Other lumenbro subdomains use their exact hostname
  if (hostname.endsWith('.lumenbro.com')) {
    return hostname;
  }

  // For Vercel preview deployments, fall back to agents.lumenbro.com
  // Passkeys registered on agents.lumenbro.com will NOT work on Vercel preview URLs
  if (hostname.endsWith('.vercel.app')) {
    console.warn('[WebAuthn RP ID] Vercel preview - passkeys may not work');
    return 'agents.lumenbro.com';
  }

  // For other domains, extract parent domain (last 2 parts)
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }

  return hostname;
}
