/**
 * POST /api/coinbase/session-token
 *
 * Generates a Coinbase Onramp session token for the given wallet address.
 * Authenticated via middleware session token.
 *
 * Request: { address: string } (relay G-address)
 * Response: { token: string, url: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, importPKCS8 } from 'jose';
import { createPrivateKey } from 'crypto';

const CDP_API_KEY_NAME = process.env.COINBASE_API_KEY_NAME || '';
const CDP_API_SECRET = process.env.COINBASE_API_SECRET || '';
const CDP_PROJECT_ID = process.env.NEXT_PUBLIC_COINBASE_PROJECT_ID || '';

const REQUEST_HOST = 'api.developer.coinbase.com';
const REQUEST_PATH = '/onramp/v1/token';

const ED25519_PKCS8_HEADER = Buffer.from(
  '302e020100300506032b657004220420', 'hex'
);

async function buildCdpJwt(): Promise<string> {
  if (!CDP_API_KEY_NAME || !CDP_API_SECRET) {
    throw new Error('Coinbase API credentials not configured');
  }

  let rawKey = CDP_API_SECRET.replace(/\\n/g, '\n').trim();
  let privateKey;
  let alg: string;

  if (rawKey.includes('-----BEGIN')) {
    const keyObj = createPrivateKey(rawKey);
    const pkcs8Pem = keyObj.export({ type: 'pkcs8', format: 'pem' }) as string;
    privateKey = await importPKCS8(pkcs8Pem, 'ES256');
    alg = 'ES256';
  } else {
    const rawBytes = Buffer.from(rawKey, 'base64');

    if (rawBytes.length === 64 || rawBytes.length === 32) {
      const seed = rawBytes.subarray(0, 32);
      const pkcs8Der = Buffer.concat([ED25519_PKCS8_HEADER, seed]);
      const keyObj = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
      const pkcs8Pem = keyObj.export({ type: 'pkcs8', format: 'pem' }) as string;
      privateKey = await importPKCS8(pkcs8Pem, 'EdDSA');
      alg = 'EdDSA';
    } else {
      let keyObj;
      try {
        keyObj = createPrivateKey({ key: rawBytes, format: 'der', type: 'pkcs8' });
      } catch {
        keyObj = createPrivateKey({ key: rawBytes, format: 'der', type: 'sec1' });
      }
      const pkcs8Pem = keyObj.export({ type: 'pkcs8', format: 'pem' }) as string;
      privateKey = await importPKCS8(pkcs8Pem, 'ES256');
      alg = 'ES256';
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();

  const jwt = await new SignJWT({
    sub: CDP_API_KEY_NAME,
    iss: 'cdp',
    aud: ['cdp_service'],
    uris: [`POST ${REQUEST_HOST}${REQUEST_PATH}`],
  })
    .setProtectedHeader({ alg, kid: CDP_API_KEY_NAME, nonce, typ: 'JWT' })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(privateKey);

  return jwt;
}

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();

    // Authenticate via session token (middleware validates Bearer token)
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    }

    if (!address.match(/^G[A-Z2-7]{55}$/)) {
      return NextResponse.json({ error: 'Invalid Stellar G-address' }, { status: 400 });
    }

    if (!CDP_PROJECT_ID) {
      return NextResponse.json({ error: 'Coinbase not configured' }, { status: 500 });
    }

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '';

    const jwt = await buildCdpJwt();

    const res = await fetch(`https://${REQUEST_HOST}${REQUEST_PATH}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        addresses: [
          { address, blockchains: ['stellar'] },
        ],
        assets: ['XLM', 'USDC'],
        ...(clientIp && { clientIp }),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[CoinbaseSession] Token request failed:', res.status, errText);
      return NextResponse.json(
        { error: `Coinbase API error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const sessionToken = data.token;

    if (!sessionToken) {
      return NextResponse.json({ error: 'No session token returned' }, { status: 502 });
    }

    const params = new URLSearchParams({
      sessionToken,
      defaultAsset: 'USDC',
      defaultNetwork: 'stellar',
      presetFiatAmount: '5',
      fiatCurrency: 'USD',
      redirectUrl: 'https://agents.lumenbro.com/dashboard',
    });
    const url = `https://pay.coinbase.com/buy/select-asset?${params.toString()}`;

    return NextResponse.json({ token: sessionToken, url });

  } catch (error: any) {
    console.error('[CoinbaseSession] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate session token' },
      { status: 500 }
    );
  }
}
