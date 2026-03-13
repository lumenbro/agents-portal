/**
 * Passkey Availability Checker
 *
 * Checks if WebAuthn/passkeys are available in the current browser environment.
 * Ported from: v0-agent-trading-platform/lib/passkey-availability.ts
 */

export interface PasskeyAvailability {
  available: boolean;
  reason?: 'webauthn-not-supported' | 'no-platform-authenticator' | 'platform-check-failed';
  hasConditionalUI: boolean;
}

export async function checkPasskeyAvailability(): Promise<PasskeyAvailability> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return { available: false, reason: 'webauthn-not-supported', hasConditionalUI: false };
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return { available: false, reason: 'no-platform-authenticator', hasConditionalUI: false };
    }
  } catch {
    return { available: false, reason: 'platform-check-failed', hasConditionalUI: false };
  }

  let hasConditionalUI = false;
  try {
    if (PublicKeyCredential.isConditionalMediationAvailable) {
      hasConditionalUI = await PublicKeyCredential.isConditionalMediationAvailable();
    }
  } catch { /* not critical */ }

  return { available: true, hasConditionalUI };
}

export function getPasskeyUnavailableReason(availability: PasskeyAvailability): string {
  if (availability.available) return '';
  switch (availability.reason) {
    case 'webauthn-not-supported':
      return 'Your browser doesn\'t support passkey authentication.';
    case 'no-platform-authenticator':
      return 'No biometric authenticator (Face ID/Touch ID) is available.';
    case 'platform-check-failed':
      return 'Unable to verify passkey support.';
    default:
      return 'Passkey authentication is not available.';
  }
}
