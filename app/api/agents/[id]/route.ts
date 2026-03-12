/**
 * Agent Detail / Update / Delete
 *
 * GET    /api/agents/[id] - Get agent details
 * PATCH  /api/agents/[id] - Update agent (name, status)
 * DELETE /api/agents/[id] - Soft-delete (revoke)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';

export const runtime = 'nodejs';

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
      .select(`
        id, name, signer_public_key, policy_tier_id, policy_address,
        status, signer_added_tx, created_at, revoked_at,
        wallets!inner(wallet_address)
      `)
      .eq('id', id)
      .eq('wallets.wallet_address', payload.walletAddress)
      .single();

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
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

    const body = await request.json();
    const { name, status, signer_added_tx } = body;

    const supabase = getSupabaseAdmin();

    // Verify ownership
    const { data: existing } = await supabase
      .from('agents')
      .select('id, wallets!inner(wallet_address)')
      .eq('id', id)
      .eq('wallets.wallet_address', payload.walletAddress)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const updates: any = {};
    if (name) updates.name = name;
    if (status) updates.status = status;
    if (signer_added_tx) updates.signer_added_tx = signer_added_tx;

    const { data: agent, error } = await supabase
      .from('agents')
      .update(updates)
      .eq('id', id)
      .select('id, name, signer_public_key, policy_tier_id, status, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
    }

    return NextResponse.json({ agent });
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

    // Verify ownership
    const { data: existing } = await supabase
      .from('agents')
      .select('id, wallets!inner(wallet_address)')
      .eq('id', id)
      .eq('wallets.wallet_address', payload.walletAddress)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Soft delete
    const { error } = await supabase
      .from('agents')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: 'Failed to revoke agent' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Agent revoked' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
