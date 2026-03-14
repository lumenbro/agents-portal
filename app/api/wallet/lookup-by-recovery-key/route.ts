import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { recoveryPublicKey } = await request.json();

    if (!recoveryPublicKey || typeof recoveryPublicKey !== 'string') {
      return createErrorResponse(ERROR_CODES.MISSING_PARAMS, 'Missing recoveryPublicKey', 400);
    }

    // recoveryPublicKey is base64-encoded 32-byte Ed25519 public key
    // Convert to G-address for validation
    try {
      const pubBytes = Buffer.from(recoveryPublicKey, 'base64');
      if (pubBytes.length !== 32) {
        return createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Invalid public key length', 400);
      }
    } catch {
      return createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Invalid base64 public key', 400);
    }

    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('wallet_address, ghost_address, passkey_public_key')
      .eq('recovery_public_key', recoveryPublicKey)
      .single();

    if (wallet) {
      return createSuccessResponse({
        found: true,
        walletAddress: wallet.wallet_address,
        ghostAddress: wallet.ghost_address,
      });
    }

    return createSuccessResponse({ found: false });
  } catch (error: any) {
    console.error('[LookupByRecoveryKey] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
