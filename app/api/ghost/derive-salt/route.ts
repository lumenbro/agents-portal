import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { passkeyPublicKey } = body;
    if (!passkeyPublicKey) {
      return NextResponse.json({ error: 'Missing required field: passkeyPublicKey' }, { status: 400 });
    }
    const ghostChallengeKey = process.env.GHOST_MASTER_KEY || process.env.GHOST_CHALLENGE_KEY;
    if (!ghostChallengeKey) {
      return NextResponse.json({ error: 'Server not configured for ghost derivation' }, { status: 500 });
    }
    const normalizedPubkey = passkeyPublicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(passkeyPublicKey.length / 4) * 4, '=');
    const hmac = crypto.createHmac('sha256', ghostChallengeKey);
    hmac.update(normalizedPubkey);
    const userSalt = hmac.digest('base64');
    return NextResponse.json({ userSalt, version: 'v2' });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to derive salt' }, { status: 500 });
  }
}
