/**
 * Wallet Lookup by Passkey Credential ID
 *
 * POST /api/wallet/lookup-by-credential
 *
 * Used by the passkey discovery login flow: when a returning user
 * authenticates with a discoverable credential, the browser returns
 * the credential ID. This endpoint maps it back to a wallet address.
 */

import { NextRequest } from 'next/server';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { credentialId } = await request.json();

    if (!credentialId || typeof credentialId !== 'string') {
      return createErrorResponse(ERROR_CODES.MISSING_PARAMS, 'credentialId is required', 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: wallet, error } = await supabase
      .from('wallets')
      .select('wallet_address, ghost_address, passkey_public_key')
      .eq('passkey_credential_id', credentialId)
      .single();

    if (error || !wallet) {
      return createSuccessResponse({ found: false });
    }

    return createSuccessResponse({
      found: true,
      walletAddress: wallet.wallet_address,
      ghostAddress: wallet.ghost_address,
      passkeyPublicKey: wallet.passkey_public_key,
    });
  } catch (error: any) {
    console.error('[WalletLookup] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
