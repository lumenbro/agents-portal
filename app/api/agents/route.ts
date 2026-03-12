/**
 * Agent CRUD - List & Create
 *
 * GET  /api/agents - List agents for authenticated wallet
 * POST /api/agents - Create new agent (generate Ed25519 keypair)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';
import { getDefaultAgentPolicyAddress, isMainnet } from '@/lib/network-config';
import crypto from 'crypto';

export const runtime = 'nodejs';

/**
 * AES-256-GCM encrypt
 */
function encryptSecret(secret: string): string {
  const key = Buffer.from(process.env.AGENT_ENCRYPTION_KEY || process.env.API_SESSION_SECRET || '', 'utf8');
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export async function GET(request: NextRequest) {
  try {
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

    // Get wallet for this session
    const { data: wallet } = await supabase
      .from('wallets')
      .select('id')
      .eq('wallet_address', payload.walletAddress)
      .single();

    if (!wallet) {
      return NextResponse.json({ agents: [] });
    }

    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, signer_public_key, policy_tier_id, policy_address, status, created_at, revoked_at')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false });

    return NextResponse.json({ agents: agents || [] });
  } catch (error: any) {
    console.error('[Agents] List error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const { name, policyTier = '$50/day' } = body;

    if (!name || typeof name !== 'string' || name.length > 64) {
      return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Get or verify wallet
    const { data: wallet } = await supabase
      .from('wallets')
      .select('id')
      .eq('wallet_address', payload.walletAddress)
      .single();

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
    }

    // Generate Ed25519 keypair for agent
    const agentKeypair = Keypair.random();
    const publicKey = agentKeypair.publicKey();
    const secretKey = agentKeypair.secret();

    // Encrypt secret key
    const encryptedSecret = encryptSecret(secretKey);

    // Get policy address
    const policyAddress = getDefaultAgentPolicyAddress();

    // Store agent
    const { data: agent, error: insertError } = await supabase
      .from('agents')
      .insert({
        wallet_id: wallet.id,
        name,
        signer_public_key: publicKey,
        encrypted_secret_key: encryptedSecret,
        policy_tier_id: policyTier,
        policy_address: policyAddress,
        status: 'pending_signer', // Signer not yet added on-chain
      })
      .select('id, name, signer_public_key, policy_tier_id, policy_address, status, created_at')
      .single();

    if (insertError) {
      console.error('[Agents] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
    }

    return NextResponse.json({
      agent,
      // Return secret key ONCE (reveal-once pattern)
      secretKey,
      message: 'Save this secret key now. It will not be shown again.',
    });
  } catch (error: any) {
    console.error('[Agents] Create error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
