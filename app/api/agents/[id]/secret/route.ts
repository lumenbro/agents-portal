/**
 * Agent Secret Key Reveal (One-Time)
 *
 * GET /api/agents/[id]/secret - Reveal encrypted agent secret key
 *
 * Only works once per agent. After reveal, the secret is marked as revealed
 * and subsequent attempts return 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';
import crypto from 'crypto';

export const runtime = 'nodejs';

/**
 * AES-256-GCM decrypt
 */
function decryptSecret(encryptedBase64: string): string {
  const key = Buffer.from(process.env.AGENT_ENCRYPTION_KEY || process.env.API_SESSION_SECRET || '', 'utf8');
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyHash, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    const { data: agent } = await supabase
      .from('agents')
      .select('id, encrypted_secret_key, secret_revealed, wallets!inner(wallet_address)')
      .eq('id', id)
      .eq('wallets.wallet_address', payload.walletAddress)
      .single();

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (agent.secret_revealed) {
      return NextResponse.json(
        { error: 'Secret key has already been revealed. It cannot be shown again.' },
        { status: 403 }
      );
    }

    // Decrypt and return
    const secretKey = decryptSecret(agent.encrypted_secret_key);

    // Mark as revealed
    await supabase
      .from('agents')
      .update({ secret_revealed: true })
      .eq('id', id);

    return NextResponse.json({
      secretKey,
      message: 'This is the only time the secret key will be shown. Save it securely.',
    });
  } catch (error: any) {
    console.error('[AgentSecret] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
