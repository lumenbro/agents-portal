import { NextRequest } from 'next/server';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/api-session-token';

export async function GET(request: NextRequest) {
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

    const supabase = getSupabaseAdmin();
    const { data: wallet } = await supabase
      .from('wallets')
      .select('recovery_public_key')
      .eq('wallet_address', session.walletAddress)
      .single();

    return createSuccessResponse({
      hasRecoveryKey: !!wallet?.recovery_public_key,
    });
  } catch (error: any) {
    console.error('[RecoveryStatus] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
