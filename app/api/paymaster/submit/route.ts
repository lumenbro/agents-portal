import { NextRequest } from 'next/server';
import { Keypair, Transaction, TransactionBuilder, BASE_FEE, Horizon, xdr } from '@stellar/stellar-sdk';
import { verifySignedChallenge } from '@/lib/paymaster-challenge-store';
import { Server as SorobanServer, Api as RpcApi } from '@stellar/stellar-sdk/rpc';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { validateRequest } from '@/lib/api-validation';
import { z } from 'zod';
import { getNetworkPassphrase, getHorizonUrl, getServerRpcUrl, isMainnet } from '@/lib/network-config';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const networkPassphrase = getNetworkPassphrase();
const horizonUrl = getHorizonUrl();
const server = new Horizon.Server(horizonUrl);
const sorobanServer = new SorobanServer(getServerRpcUrl());

const paymasterSubmitSchema = z.object({
  ghostAddress: z.string().regex(/^G[A-Z0-9]{55}$/),
  challenge: z.string().min(1),
  signature: z.string().min(1),
  innerXdr: z.string().min(1),
  passkeyPublicKeyBase64: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const validation = await validateRequest(request, paymasterSubmitSchema);
    if (validation.error) return validation.error;

    const { ghostAddress, challenge, signature, innerXdr, passkeyPublicKeyBase64 } = validation.data;

    // 1. Verify signature
    const ghostKp = Keypair.fromPublicKey(ghostAddress);
    if (!ghostKp.verify(Buffer.from(challenge, 'hex'), Buffer.from(signature, 'base64'))) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, 'Invalid signature', 401);
    }

    // 2. Verify challenge
    const challengeResult = verifySignedChallenge(challenge);
    if (!challengeResult.valid && process.env.NODE_ENV === 'production') {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, `Challenge failed: ${challengeResult.reason}`, 401);
    }

    // 3. Rate limit
    const now = Date.now();
    const rateKey = `rate:${ghostAddress}`;
    const rateData = rateLimitStore.get(rateKey);
    if (rateData && rateData.resetAt > now && rateData.count >= 20) {
      return createErrorResponse(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Rate limited', 429);
    }
    rateLimitStore.set(rateKey, { count: (rateData?.count || 0) + 1, resetAt: rateData?.resetAt || now + 60000 });

    // 4. Get paymaster
    const paymasterSecret = process.env.PAYMASTER_SECRET || process.env.WALLET_DEPLOYER_SECRET_KEY;
    if (!paymasterSecret) return createErrorResponse(ERROR_CODES.CONFIGURATION_ERROR, 'Paymaster not configured', 500);
    const paymasterKp = Keypair.fromSecret(paymasterSecret);

    // 5. Verify ghost is sponsored
    let ghostAccount;
    try {
      ghostAccount = await server.loadAccount(ghostAddress);
      if (ghostAccount.sponsor !== paymasterKp.publicKey()) {
        return createErrorResponse(ERROR_CODES.FORBIDDEN, 'Ghost not sponsored by paymaster', 403);
      }
    } catch (e: any) {
      if (e.response?.status === 404) {
        return createErrorResponse(ERROR_CODES.NOT_FOUND, 'Ghost account does not exist', 404);
      }
      throw e;
    }

    // 6. Parse inner transaction
    const innerTx = new Transaction(innerXdr, networkPassphrase);

    // 7. Fee-bump wrap (fee must be >= inner TX fee for Soroban resource fees)
    const innerFee = parseInt(innerTx.fee, 10);
    const bumpFee = Math.max(innerFee + parseInt(BASE_FEE, 10), innerFee * 2).toString();
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      paymasterKp, bumpFee, innerTx, networkPassphrase
    );
    feeBumpTx.sign(paymasterKp);

    // 8. Submit via RPC first, Horizon fallback
    let txHash: string;
    let ledger: number = 0;

    try {
      const rpcResult = await sorobanServer.sendTransaction(feeBumpTx);
      txHash = rpcResult.hash;

      // Poll for result
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await sorobanServer.getTransaction(txHash);
        if (status.status === 'SUCCESS') {
          ledger = status.ledger;
          break;
        }
        if (status.status === 'FAILED') throw new Error('Transaction failed on-chain');
      }
    } catch (rpcError: any) {
      // Fallback to Horizon
      try {
        const horizonResult = await server.submitTransaction(feeBumpTx) as any;
        txHash = horizonResult.hash;
        ledger = horizonResult.ledger;
      } catch (horizonError: any) {
        const resultCodes = horizonError.response?.data?.extras?.result_codes;
        return createErrorResponse(ERROR_CODES.TRANSACTION_FAILED, `Submission failed: ${JSON.stringify(resultCodes || horizonError.message)}`, 400);
      }
    }

    return createSuccessResponse({ hash: txHash!, ledger });
  } catch (error: any) {
    console.error('[PaymasterSubmit] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
