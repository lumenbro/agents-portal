import { createHmac } from 'crypto';

function getSessionSecret(): string {
  const secret =
    process.env.API_SESSION_SECRET ||
    process.env.PAYMASTER_CHALLENGE_SECRET ||
    process.env.PAYMASTER_SECRET;
  if (!secret) {
    return 'dev-secret-DO-NOT-USE-IN-PRODUCTION';
  }
  return secret;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionTokenPayload {
  walletAddress: string;
  ghostAddress: string;
  issuedAt: number;
  expiresAt: number;
}

export function createSessionToken(
  walletAddress: string,
  ghostAddress: string,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const payload = `${walletAddress}:${ghostAddress}:${issuedAt}:${expiresAt}`;
  const hmac = createHmac('sha256', getSessionSecret());
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return `${payload}:${signature}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const parts = token.split(':');
    if (parts.length !== 5) return null;
    const [walletAddress, ghostAddress, issuedAtStr, expiresAtStr, providedSignature] = parts;
    const issuedAt = parseInt(issuedAtStr, 10);
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(issuedAt) || isNaN(expiresAt)) return null;
    const payload = `${walletAddress}:${ghostAddress}:${issuedAt}:${expiresAt}`;
    const hmac = createHmac('sha256', getSessionSecret());
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    if (providedSignature.length !== expectedSignature.length) return null;
    let mismatch = 0;
    for (let i = 0; i < providedSignature.length; i++) {
      mismatch |= providedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    if (mismatch !== 0) return null;
    if (Date.now() > expiresAt) return null;
    return { walletAddress, ghostAddress, issuedAt, expiresAt };
  } catch {
    return null;
  }
}
