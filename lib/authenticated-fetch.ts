/**
 * Authenticated Fetch (Browser)
 *
 * Drop-in replacement for fetch() that auto-attaches session tokens
 * to protected API routes. Token is acquired once (24h TTL) using
 * ghost ed25519 signature, then cached in sessionStorage.
 *
 * Non-protected routes pass through with zero overhead.
 *
 * Usage:
 *   import { authFetch } from '@/lib/authenticated-fetch';
 *   const res = await authFetch('/api/agents', { method: 'GET' });
 *
 * Ported from: v0-agent-trading-platform/lib/authenticated-fetch.ts
 */

// ============================================================================
// Token Cache (sessionStorage + memory)
// ============================================================================

let memToken: string | null = null;
let memExpires: number = 0;

const STORAGE_KEY = 'agents_session_token';
const STORAGE_EXPIRES_KEY = 'agents_session_token_expires';

function getCachedToken(): string | null {
  // Memory cache first (avoids sessionStorage parse)
  if (memToken && Date.now() < memExpires - 5 * 60_000) {
    return memToken;
  }

  // sessionStorage fallback
  try {
    const t = sessionStorage.getItem(STORAGE_KEY);
    const e = sessionStorage.getItem(STORAGE_EXPIRES_KEY);
    if (t && e) {
      const expires = parseInt(e, 10);
      if (Date.now() < expires - 5 * 60_000) {
        memToken = t;
        memExpires = expires;
        return t;
      }
    }
  } catch {
    // SSR or storage unavailable
  }

  // Fall back to agents_session in localStorage (existing pattern)
  try {
    const saved = localStorage.getItem('agents_session');
    if (saved) {
      const session = JSON.parse(saved);
      if (session.sessionToken) {
        // We don't know exact expiry from localStorage, use it as-is
        memToken = session.sessionToken;
        memExpires = Date.now() + 60_000; // Recheck in 1 min
        return session.sessionToken;
      }
    }
  } catch { /* ignore */ }

  return null;
}

function setCachedToken(token: string, expiresAt: number): void {
  memToken = token;
  memExpires = expiresAt;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
    sessionStorage.setItem(STORAGE_EXPIRES_KEY, expiresAt.toString());
  } catch {
    // SSR or storage unavailable — memory cache still works
  }
}

/**
 * Clear session token (call on disconnect/logout)
 */
export function clearBrowserSessionToken(): void {
  memToken = null;
  memExpires = 0;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_EXPIRES_KEY);
  } catch { /* ignore */ }
}

// ============================================================================
// Token Acquisition
// ============================================================================

/** Prevent concurrent refresh races */
let refreshPromise: Promise<string | null> | null = null;

async function acquireToken(): Promise<string | null> {
  // Return cached if valid
  const cached = getCachedToken();
  if (cached) return cached;

  // Dedupe concurrent requests
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { refreshSessionToken } = await import('./session-refresh');
      const result = await refreshSessionToken();
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
      setCachedToken(result.sessionToken, expiresAt);
      return result.sessionToken;
    } catch (e) {
      console.warn('[AuthFetch] Token acquisition failed:', e);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ============================================================================
// Protected Route Detection
// ============================================================================

const PROTECTED_PREFIXES = [
  '/api/agents',
  '/api/signer/',
  '/api/policy/',
  '/api/paymaster/submit',
  '/api/paymaster/create-ghost',
  '/api/coinbase/session-token',
];

function isProtectedRoute(url: string): boolean {
  const pathname = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
  return PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// ============================================================================
// Authenticated Fetch
// ============================================================================

/**
 * Drop-in fetch() replacement that auto-attaches Authorization header
 * for protected routes. Non-protected routes pass through untouched.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (!isProtectedRoute(url)) {
    return fetch(input, init);
  }

  const token = await acquireToken();

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
