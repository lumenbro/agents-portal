import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { createSessionToken } from '@/lib/api-session-token';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { deriveGhostKeypairServerSide } from '@/lib/ghost-address-derivation';

export async function POST(request: NextRequest) {
  try {
    const { ghostAddress, challenge, signature, passkeyPublicKeyBase64 } = await request.json();

    if (!ghostAddress || !challenge || !signature) {
      return createErrorResponse(ERROR_CODES.MISSING_PARAMS, 'Missing ghostAddress, challenge, or signature', 400);
    }

    // Verify ghost signature
    const ghostKp = Keypair.fromPublicKey(ghostAddress);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const signatureBuffer = Buffer.from(signature, 'base64');

    if (!ghostKp.verify(challengeBuffer, signatureBuffer)) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Invalid signature', 401);
    }

    // Derive wallet address from passkey if provided
    let walletAddress = ghostAddress; // fallback
    if (passkeyPublicKeyBase64) {
      try {
        const derivedGhost = await deriveGhostKeypairServerSide(passkeyPublicKeyBase64);
        if (derivedGhost.publicKey() === ghostAddress) {
          walletAddress = ghostAddress; // confirmed match
        }
      } catch {}
    }

    const token = createSessionToken(walletAddress, ghostAddress);
    return createSuccessResponse({ token, expiresIn: 86400 });
  } catch (error: any) {
    console.error('[AuthToken] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
