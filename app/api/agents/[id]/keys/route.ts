/**
 * API Key Management
 *
 * GET  /api/agents/[id]/keys - List API keys (masked)
 * POST /api/agents/[id]/keys - Create new API key (reveal-once)
 * DELETE /api/agents/[id]/keys?keyId=xxx - Revoke API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';
import crypto from 'crypto';

export const runtime = 'nodejs';

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `lj_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = key.substring(0, 10);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, prefix, hash };
}

async function verifyAgentOwnership(agentId: string, walletAddress: string) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('agents')
    .select('id, wallets!inner(wallet_address)')
    .eq('id', agentId)
    .eq('wallets.wallet_address', walletAddress)
    .single();
  return data;
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

    const agent = await verifyAgentOwnership(id, payload.walletAddress);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();
    const { data: keys } = await supabase
      .from('api_keys')
      .select('id, key_prefix, label, created_at, last_used_at, revoked_at')
      .eq('agent_id', id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    return NextResponse.json({ keys: keys || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
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

    const agent = await verifyAgentOwnership(id, payload.walletAddress);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await request.json();
    const { label = 'default' } = body;

    const { key, prefix, hash } = generateApiKey();

    const supabase = getSupabaseAdmin();
    const { data: apiKey, error: insertError } = await supabase
      .from('api_keys')
      .insert({
        agent_id: id,
        key_hash: hash,
        key_prefix: prefix,
        label,
      })
      .select('id, key_prefix, label, created_at')
      .single();

    if (insertError) {
      return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
    }

    return NextResponse.json({
      apiKey,
      // Reveal key ONCE
      key,
      message: 'Save this API key now. It will not be shown again.',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const keyId = request.nextUrl.searchParams.get('keyId');

    if (!keyId) {
      return NextResponse.json({ error: 'Missing keyId parameter' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const agent = await verifyAgentOwnership(id, payload.walletAddress);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('agent_id', id);

    if (error) {
      return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
