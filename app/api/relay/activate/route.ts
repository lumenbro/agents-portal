/**
 * POST /api/relay/activate
 *
 * Activates a PRF-derived relay G-address on-chain.
 * Paymaster funds the account with enough XLM for base reserve + USDC trustline.
 *
 * The relay address is derived client-side from the user's passkey via WebAuthn PRF.
 * Server only needs the public G-address — never sees the private key (non-custodial).
 *
 * Request: { address: string } (PRF relay G-address)
 * Auth: Bearer session token
 * Response: { success, address, txHash?, existing? }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Horizon,
} from '@stellar/stellar-sdk';
import { getNetworkPassphrase, getHorizonUrl } from '@/lib/network-config';

const networkPassphrase = getNetworkPassphrase();
const horizonUrl = getHorizonUrl();

// 2 XLM covers: 1.0 base reserve + 0.5 per trustline (USDC) + 0.5 buffer for fees
const STARTING_BALANCE = '2';

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { address } = await request.json();

    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    }

    if (!address.match(/^G[A-Z2-7]{55}$/)) {
      return NextResponse.json({ error: 'Invalid Stellar G-address' }, { status: 400 });
    }

    // Get paymaster keypair
    const paymasterSecret = (
      process.env.PAYMASTER_SECRET ||
      process.env.WALLET_DEPLOYER_SECRET_KEY
    )?.trim();

    if (!paymasterSecret) {
      return NextResponse.json(
        { error: 'Paymaster not configured' },
        { status: 500 }
      );
    }

    const paymasterKp = Keypair.fromSecret(paymasterSecret);
    const server = new Horizon.Server(horizonUrl);

    // Check if account already exists
    try {
      await server.loadAccount(address);
      return NextResponse.json({
        success: true,
        address,
        existing: true,
        message: 'Relay account already active',
      });
    } catch (err: any) {
      if (err.response?.status !== 404) throw err;
      // Account doesn't exist — proceed with creation
    }

    // Build create_account TX — paymaster signs alone (no PRF key needed)
    const paymasterAccount = await server.loadAccount(paymasterKp.publicKey());

    const tx = new TransactionBuilder(paymasterAccount, {
      fee: (Number(BASE_FEE) * 2).toString(),
      networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: address,
          startingBalance: STARTING_BALANCE,
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(paymasterKp);

    const result = await server.submitTransaction(tx);

    return NextResponse.json({
      success: true,
      address,
      txHash: result.hash,
      message: `Relay account activated with ${STARTING_BALANCE} XLM`,
    });
  } catch (error: any) {
    console.error('[RelayActivate] Error:', error);

    // Handle race condition — account created between our check and TX
    const errorData = error.response?.data;
    if (errorData?.extras?.result_codes?.operations?.includes('op_already_exists')) {
      const { address } = await request.json().catch(() => ({ address: '' }));
      return NextResponse.json({
        success: true,
        address,
        existing: true,
        message: 'Relay account already active',
      });
    }

    return NextResponse.json(
      { error: error.message || 'Failed to activate relay account' },
      { status: 500 }
    );
  }
}
