import { NextRequest } from 'next/server';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return createErrorResponse(ERROR_CODES.MISSING_PARAMS, 'Missing email', 400);
    }

    const normalized = email.trim().toLowerCase();
    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('wallet_address, passkey_credential_id')
      .eq('email', normalized)
      .single();

    if (wallet) {
      return createSuccessResponse({
        found: true,
        walletAddress: wallet.wallet_address,
        credentialId: wallet.passkey_credential_id,
      });
    }

    return createSuccessResponse({ found: false });
  } catch (error: any) {
    console.error('[LookupByEmail] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
