/**
 * Ghost Account Recovery Endpoint
 *
 * POST /api/ghost/recover
 *
 * Re-derives the ghost keypair from the authenticated user's passkey,
 * then merges the ghost account back into the paymaster to reclaim
 * the 0.5 XLM sponsorship reserve.
 *
 * Requires:
 * - Valid session token (Bearer auth)
 * - The wallet must have passkey_public_key stored in DB
 * - The ghost account must exist and be sponsored by the paymaster
 */

import { NextRequest } from 'next/server';
import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { verifySessionToken } from '@/lib/api-session-token';
import { deriveGhostKeypairServerSide } from '@/lib/ghost-address-derivation';
import { getNetworkPassphrase, getHorizonUrl } from '@/lib/network-config';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const PAYMASTER_PUBLIC = 'GAWZ3PFDQQGLD7ARUX2WWMGXU7P3R26WI7452CMBAGF5PFPVCSD3Z7LB';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify session
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Authentication required', 401);
    }
    const payload = verifySessionToken(authHeader.slice(7));
    if (!payload) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Invalid session', 401);
    }

    // 2. Get passkey_public_key from DB
    const supabase = getSupabaseAdmin();
    const { data: wallet } = await supabase
      .from('wallets')
      .select('passkey_public_key, ghost_address')
      .eq('wallet_address', payload.walletAddress)
      .single();

    if (!wallet?.passkey_public_key) {
      return createErrorResponse(
        ERROR_CODES.MISSING_PARAMS,
        'No passkey_public_key stored for this wallet. Re-authenticate to save it.',
        400,
      );
    }

    // 3. Derive ghost keypair
    const ghostKp = await deriveGhostKeypairServerSide(wallet.passkey_public_key);
    const ghostAddr = ghostKp.publicKey();

    // 4. Verify ghost account exists and is sponsored by paymaster
    const horizon = new Horizon.Server(getHorizonUrl());

    let ghostAccount;
    try {
      ghostAccount = await horizon.loadAccount(ghostAddr);
    } catch (e: any) {
      if (e.response?.status === 404) {
        // Ghost already merged or never existed — update DB
        await supabase
          .from('wallets')
          .update({ ghost_address: `MERGED:${ghostAddr}` })
          .eq('wallet_address', payload.walletAddress);

        return createSuccessResponse({
          merged: false,
          ghostAddress: ghostAddr,
          message: 'Ghost account not found — may already be merged.',
        });
      }
      throw e;
    }

    const sponsor = (ghostAccount as any).sponsor;
    if (sponsor !== PAYMASTER_PUBLIC) {
      return createErrorResponse(
        ERROR_CODES.INTERNAL_ERROR,
        `Ghost exists but sponsor is ${sponsor}, not paymaster.`,
        400,
      );
    }

    // 5. Merge ghost → paymaster
    const paymasterSecret = (
      process.env.PAYMASTER_SECRET || process.env.WALLET_DEPLOYER_SECRET_KEY
    )?.trim();

    if (!paymasterSecret) {
      return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, 'Paymaster not configured', 500);
    }

    const paymasterKp = Keypair.fromSecret(paymasterSecret);
    const paymasterAccount = await horizon.loadAccount(paymasterKp.publicKey());

    const tx = new TransactionBuilder(paymasterAccount, {
      fee: (Number(BASE_FEE) * 2).toString(),
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        Operation.accountMerge({
          destination: paymasterKp.publicKey(),
          source: ghostAddr,
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(paymasterKp);
    tx.sign(ghostKp);

    const result = await horizon.submitTransaction(tx);

    // 6. Update DB
    await supabase
      .from('wallets')
      .update({ ghost_address: `MERGED:${ghostAddr}` })
      .eq('wallet_address', payload.walletAddress);

    console.log(`[GhostRecover] Merged ${ghostAddr} → paymaster. TX: ${(result as any).hash}`);

    return createSuccessResponse({
      merged: true,
      ghostAddress: ghostAddr,
      txHash: (result as any).hash,
      message: 'Ghost account merged. ~0.5 XLM recovered to paymaster.',
    });
  } catch (error: any) {
    console.error('[GhostRecover] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
