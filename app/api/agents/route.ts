/**
 * Agent CRUD - List & Create
 *
 * GET  /api/agents - List agents for authenticated wallet
 * POST /api/agents - Create new agent
 *
 * Supports two signer types:
 *   Ed25519   — Server generates keypair, encrypts secret (reveal-once)
 *   Secp256r1 — Operator provides public key from Secure Enclave / TPM
 *               (private key never leaves hardware, no secret to store)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';
import { getDefaultAgentPolicyAddress, isMainnet } from '@/lib/network-config';
import { computeKeyId } from '@/lib/keypo-signer';
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
      .select('id, name, signer_public_key, signer_type, key_id, key_label, policy_tier_id, policy_address, status, created_at, revoked_at')
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
    const {
      name,
      policyTier = '$50/day',
      signerType = 'Ed25519',     // 'Ed25519' | 'Secp256r1'
      publicKeyBase64,            // Required for Secp256r1 (65 bytes, base64)
      keyLabel,                   // Optional: keypo-signer label (for Go Live snippets)
    } = body;

    if (!name || typeof name !== 'string' || name.length > 64) {
      return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
    }

    if (signerType !== 'Ed25519' && signerType !== 'Secp256r1') {
      return NextResponse.json({ error: 'signerType must be Ed25519 or Secp256r1' }, { status: 400 });
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

    // Get policy address
    const policyAddress = getDefaultAgentPolicyAddress();

    if (signerType === 'Secp256r1') {
      // ── Secure Enclave / TPM path ──
      // Operator provides public key generated on their machine via keypo-signer.
      // Private key never leaves hardware — no secret to store or reveal.
      if (!publicKeyBase64) {
        return NextResponse.json(
          { error: 'publicKeyBase64 required for Secp256r1 signer' },
          { status: 400 },
        );
      }

      const publicKeyBytes = Buffer.from(publicKeyBase64, 'base64');
      if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
        return NextResponse.json(
          { error: 'Invalid P-256 public key (expected 65 uncompressed bytes with 0x04 prefix)' },
          { status: 400 },
        );
      }

      // Compute deterministic key_id = SHA256(publicKey) — used by __check_auth
      const keyId = computeKeyId(publicKeyBytes).toString('base64');

      const { data: agent, error: insertError } = await supabase
        .from('agents')
        .insert({
          wallet_id: wallet.id,
          name,
          signer_public_key: publicKeyBase64,    // base64 of 65-byte P-256 key
          signer_type: 'Secp256r1',
          key_id: keyId,                          // SHA256(publicKey), base64
          key_label: keyLabel || null,            // keypo-signer label (optional)
          // No encrypted_secret_key — key is hardware-bound
          policy_tier_id: policyTier,
          policy_address: policyAddress,
          status: 'pending_signer',
        })
        .select('id, name, signer_public_key, signer_type, key_id, key_label, policy_tier_id, policy_address, status, created_at')
        .single();

      if (insertError) {
        console.error('[Agents] SE insert error:', insertError);
        return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
      }

      return NextResponse.json({
        agent,
        signerType: 'Secp256r1',
        message: 'Agent created with Secure Enclave key. Private key is hardware-bound.',
      });
    }

    // ── Ed25519 path (default) ──
    // Client generates keypair and sends only the public key.
    // Secret key never touches the server (self-custodial).
    const publicKey = body.publicKey;

    if (!publicKey || typeof publicKey !== 'string') {
      // Fallback: server-side generation for backward compatibility
      const agentKeypair = Keypair.random();
      const fallbackPublicKey = agentKeypair.publicKey();
      const fallbackSecret = agentKeypair.secret();
      const encryptedSecret = encryptSecret(fallbackSecret);

      const { data: agent, error: insertError } = await supabase
        .from('agents')
        .insert({
          wallet_id: wallet.id,
          name,
          signer_public_key: fallbackPublicKey,
          signer_type: 'Ed25519',
          encrypted_secret_key: encryptedSecret,
          policy_tier_id: policyTier,
          policy_address: policyAddress,
          status: 'pending_signer',
        })
        .select('id, name, signer_public_key, signer_type, policy_tier_id, policy_address, status, created_at')
        .single();

      if (insertError) {
        console.error('[Agents] Insert error:', insertError);
        return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
      }

      return NextResponse.json({
        agent,
        secretKey: fallbackSecret,
        signerType: 'Ed25519',
        message: 'Save this secret key now. It will not be shown again.',
      });
    }

    // Client-side generated key — store only the public key
    const { data: agent, error: insertError } = await supabase
      .from('agents')
      .insert({
        wallet_id: wallet.id,
        name,
        signer_public_key: publicKey,
        signer_type: 'Ed25519',
        // No encrypted_secret_key — self-custodial, client holds the secret
        policy_tier_id: policyTier,
        policy_address: policyAddress,
        status: 'pending_signer',
      })
      .select('id, name, signer_public_key, signer_type, policy_tier_id, policy_address, status, created_at')
      .single();

    if (insertError) {
      console.error('[Agents] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
    }

    return NextResponse.json({
      agent,
      signerType: 'Ed25519',
      message: 'Agent registered. Secret key is held client-side only.',
    });
  } catch (error: any) {
    console.error('[Agents] Create error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
