import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_API_ROUTES = [
  '/api/agents',
  '/api/coinbase/session-token',
  '/api/signer/add',
  '/api/signer/finalize',
];

const PUBLIC_API_ROUTES = [
  '/api/auth/token',
  '/api/wallet/deploy',
  '/api/paymaster/challenge',
  '/api/paymaster/create-ghost',
  '/api/paymaster/submit',
  '/api/ghost/derive-salt',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip non-API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow public API routes
  if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check auth header presence for protected routes
  // Full HMAC verification happens in the route handlers (Node.js runtime)
  if (PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Basic format check: token must have 5 colon-separated parts
    const token = authHeader.slice(7);
    const parts = token.split(':');
    if (parts.length !== 5) {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 401 });
    }

    // Check expiration (quick check, no HMAC)
    const expiresAt = parseInt(parts[3], 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
