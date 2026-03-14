import { NextRequest } from 'next/server';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Missing token', 401);
    }

    const session = verifySessionToken(token);
    if (!session) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Invalid token', 401);
    }

    const { recoveryPublicKey } = await request.json();

    if (!recoveryPublicKey || typeof recoveryPublicKey !== 'string') {
      return createErrorResponse(ERROR_CODES.MISSING_PARAMS, 'Missing recoveryPublicKey', 400);
    }

    // Verify it's valid base64 and 32 bytes
    const pubBytes = Buffer.from(recoveryPublicKey, 'base64');
    if (pubBytes.length !== 32) {
      return createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Invalid public key length', 400);
    }

    const supabase = getSupabaseAdmin();

    // Check if wallet already has a recovery key
    const { data: existing } = await supabase
      .from('wallets')
      .select('recovery_public_key')
      .eq('wallet_address', session.walletAddress)
      .single();

    if (existing?.recovery_public_key) {
      return createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Recovery key already set', 400);
    }

    await supabase
      .from('wallets')
      .update({ recovery_public_key: recoveryPublicKey })
      .eq('wallet_address', session.walletAddress);

    return createSuccessResponse({ success: true });
  } catch (error: any) {
    console.error('[SetRecoveryKey] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
