import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { createSessionToken } from '@/lib/api-session-token';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { deriveGhostKeypairServerSide } from '@/lib/ghost-address-derivation';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { ghostAddress, walletAddress: clientWalletAddress, challenge, signature, passkeyPublicKeyBase64, credentialId, isRecovery } = await request.json();

    if (!ghostAddress || !challenge || !signature) {
      return createErrorResponse(ERROR_CODES.MISSING_PARAMS, 'Missing ghostAddress, challenge, or signature', 400);
    }

    // Verify signature (ghost key or recovery key — both are Ed25519 G-addresses)
    const signerKp = Keypair.fromPublicKey(ghostAddress);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const signatureBuffer = Buffer.from(signature, 'base64');

    if (!signerKp.verify(challengeBuffer, signatureBuffer)) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Invalid signature', 401);
    }

    // Use the smart wallet C-address if provided, otherwise fall back to ghost
    const walletAddress = clientWalletAddress || ghostAddress;

    // Persist ghost_address + passkey data to wallet record
    // Skip DB update for recovery logins — don't overwrite ghost/passkey data
    if (!isRecovery) {
      try {
        const supabase = getSupabaseAdmin();
        const updateData: Record<string, any> = {
          ghost_address: ghostAddress,
          passkey_public_key: passkeyPublicKeyBase64 || null,
        };
        if (credentialId) {
          updateData.passkey_credential_id = credentialId;
        }
        await supabase
          .from('wallets')
          .update(updateData)
          .eq('wallet_address', walletAddress);
      } catch (dbError) {
        console.warn('[AuthToken] DB update failed (non-critical):', dbError);
      }
    }

    const token = createSessionToken(walletAddress, ghostAddress);
    return createSuccessResponse({ token, expiresIn: 86400 });
  } catch (error: any) {
    console.error('[AuthToken] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
