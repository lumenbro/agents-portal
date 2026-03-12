/**
 * Paymaster Create Ghost Endpoint
 *
 * Creates a zero-balance, fully-sponsored Ghost G-address account.
 * Same passkey + same server salt → same Ghost G-address forever.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Horizon,
  Memo,
  xdr,
} from '@stellar/stellar-sdk';
import { getNetworkPassphrase, getHorizonUrl } from '@/lib/network-config';
import crypto from 'crypto';
import { deriveGhostKeypair } from '@/lib/ghost-address-derivation';

function deriveUserSalt(passkeyPubkeyBase64: string): string | null {
  const ghostChallengeKey = process.env.GHOST_MASTER_KEY || process.env.GHOST_CHALLENGE_KEY;
  if (!ghostChallengeKey) {
    console.warn('[PaymasterCreateGhost] GHOST_MASTER_KEY not set');
    return null;
  }

  const normalized = passkeyPubkeyBase64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(passkeyPubkeyBase64.length / 4) * 4, '=');

  const hmac = crypto.createHmac('sha256', ghostChallengeKey);
  hmac.update(normalized);
  return hmac.digest('base64');
}

import { getChallenge, deleteChallenge, getStoreSize, getAllChallengeIds } from '@/lib/paymaster-challenge-store';

const networkPassphrase = getNetworkPassphrase();
const horizonUrl = getHorizonUrl();
const server = new Horizon.Server(horizonUrl);

export async function POST(request: NextRequest) {
  console.log('[PaymasterCreateGhost] POST request received');

  let passkeyPubkeyBase64: string | undefined;
  try {
    const body = await request.json();
    const { challenge, signature } = body;
    passkeyPubkeyBase64 = body.passkeyPubkeyBase64;

    if (!passkeyPubkeyBase64 || !challenge || !signature) {
      return NextResponse.json(
        { error: 'Missing required fields: passkeyPubkeyBase64, challenge, signature' },
        { status: 400 }
      );
    }

    // 1. Derive ghost keypair
    const userSalt = deriveUserSalt(passkeyPubkeyBase64);
    const ghostKp = await deriveGhostKeypair(passkeyPubkeyBase64, userSalt ?? undefined);
    const ghostPub = ghostKp.publicKey();

    // 2. Verify signature proves ownership of ghost key
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const signatureBuffer = Buffer.from(signature, 'base64');

    if (!ghostKp.verify(challengeBuffer, signatureBuffer)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 3. Prevent replay
    const challengeData = getChallenge(challenge);
    const isDev = process.env.NODE_ENV === 'development';

    if (!challengeData) {
      if (isDev) {
        console.warn('[PaymasterCreateGhost] Challenge not found (dev mode - proceeding)');
      } else {
        return NextResponse.json(
          { error: 'Challenge not found or already used' },
          { status: 401 }
        );
      }
    } else {
      const now = Date.now();
      if (challengeData.expires < now) {
        deleteChallenge(challenge);
        return NextResponse.json({ error: 'Challenge expired' }, { status: 401 });
      }
      deleteChallenge(challenge);
    }

    // 4. Get paymaster keypair
    const paymasterSecret = (
      process.env.PAYMASTER_SECRET ||
      process.env.WALLET_DEPLOYER_SECRET_KEY
    )?.trim();

    if (!paymasterSecret) {
      return NextResponse.json(
        { error: 'Paymaster secret key not configured' },
        { status: 500 }
      );
    }

    const paymasterKp = Keypair.fromSecret(paymasterSecret);
    const paymasterPublicKey = paymasterKp.publicKey();
    const paymasterAccount = await server.loadAccount(paymasterPublicKey);

    // 5. Check if account already exists
    try {
      const existingAccount = await server.loadAccount(ghostPub);

      if (existingAccount.sponsor !== paymasterPublicKey) {
        return NextResponse.json(
          { error: 'Account exists but is not sponsored by the paymaster.' },
          { status: 403 }
        );
      }

      return NextResponse.json({
        success: true,
        ghostAddress: ghostPub,
        message: 'Ghost account already exists',
        existing: true,
      });
    } catch (accountError: any) {
      if (accountError.response?.status !== 404) throw accountError;
    }

    // 6. Create zero-balance sponsored account
    const tx = new TransactionBuilder(paymasterAccount, {
      fee: (Number(BASE_FEE) * 3).toString(),
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: ghostPub,
        })
      )
      .addOperation(
        Operation.createAccount({
          destination: ghostPub,
          startingBalance: '0.0000000',
        })
      )
      .addMemo(Memo.text('GhostG-Create:v1'))
      .setTimeout(30);

    const endSponsoringOp = Operation.endSponsoringFutureReserves({});
    const ghostAccountId = Keypair.fromPublicKey(ghostPub).xdrAccountId();
    const ghostMuxed = xdr.MuxedAccount.keyTypeEd25519(ghostAccountId.ed25519());
    (endSponsoringOp as any)._attributes.sourceAccount = ghostMuxed;
    tx.addOperation(endSponsoringOp);

    const txBuilt = tx.build();
    txBuilt.sign(paymasterKp);
    txBuilt.sign(ghostKp);

    // 7. Submit
    let result;
    try {
      result = await server.submitTransaction(txBuilt);
    } catch (error: any) {
      const errorData = error.response?.data;
      if (errorData?.extras?.result_codes?.operations?.includes('op_already_exists')) {
        return NextResponse.json({
          success: true,
          ghostAddress: ghostPub,
          message: 'Ghost account already exists',
          existing: true,
        });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      ghostAddress: ghostPub,
      txHash: result.hash,
      ledger: result.ledger,
      message: 'Ghost account created with zero balance and full sponsorship',
    });
  } catch (error: any) {
    console.error('[PaymasterCreateGhost] Error:', error);

    const errorData = error.response?.data;
    if (errorData?.extras?.result_codes?.operations?.some((c: string) => c === 'op_already_exists')) {
      const salt = deriveUserSalt(passkeyPubkeyBase64!);
      const ghostKp = await deriveGhostKeypair(passkeyPubkeyBase64!, salt ?? undefined);
      return NextResponse.json({
        success: true,
        ghostAddress: ghostKp.publicKey(),
        message: 'Ghost account already exists',
        existing: true,
      });
    }

    return NextResponse.json(
      { error: error.message || 'Failed to create ghost account' },
      { status: 500 }
    );
  }
}
