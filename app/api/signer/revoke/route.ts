/**
 * POST /api/signer/revoke
 *
 * Builds a `revoke_signer(signer_key)` transaction for the smart wallet contract.
 * Returns the raw TX XDR + auth entry XDR for client-side passkey signing.
 *
 * The client then:
 * 1. Signs auth entry with passkey (signWithPasskey)
 * 2. Calls /api/signer/finalize (re-simulate with signed auth)
 * 3. Signs inner TX with ghost keypair
 * 4. Submits via /api/paymaster/submit (fee-bump + on-chain)
 *
 * Request: { walletAddress, signerPublicKey, signerType, keyId?, sourceAddress }
 * Response: { rawTxXdr, assembledTxXdr, authEntryXdr, latestLedger, networkPassphrase }
 */

import { NextRequest, NextResponse } from 'next/server';
import { xdr, Operation, TransactionBuilder, StrKey } from '@stellar/stellar-sdk';
import { Server as SorobanRpcServer, Api as SorobanRpcApi, assembleTransaction } from '@stellar/stellar-sdk/rpc';
import { Buffer } from 'buffer';
import { getServerRpcUrl, getNetworkPassphrase } from '@/lib/network-config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      walletAddress,
      signerPublicKey,
      signerType = 'Ed25519',
      keyId,            // base64 key_id for Secp256r1
      sourceAddress,
    } = body;

    if (!walletAddress || !signerPublicKey || !sourceAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: walletAddress, signerPublicKey, sourceAddress' },
        { status: 400 }
      );
    }

    const rpcUrl = getServerRpcUrl();
    const networkPassphrase = getNetworkPassphrase();
    const server = new SorobanRpcServer(rpcUrl);

    // Build SignerKey arg (not full Signer — revoke only needs the key identifier)
    let signerKeyArg: xdr.ScVal;

    if (signerType === 'Secp256r1') {
      // SignerKey::Secp256r1 = Vec[Symbol("Secp256r1"), BytesN<32>]
      // key_id = SHA256(uncompressed_public_key) or provided keyId
      const keyIdBytes = keyId
        ? Buffer.from(keyId, 'base64')
        : require('crypto').createHash('sha256').update(Buffer.from(signerPublicKey, 'base64')).digest();

      signerKeyArg = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Secp256r1'),
        xdr.ScVal.scvBytes(keyIdBytes),
      ]);
    } else {
      // SignerKey::Ed25519 = Vec[Symbol("Ed25519"), BytesN<32>]
      const publicKeyBytes = Buffer.from(StrKey.decodeEd25519PublicKey(signerPublicKey));

      signerKeyArg = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Ed25519'),
        xdr.ScVal.scvBytes(publicKeyBytes),
      ]);
    }

    if (!StrKey.isValidEd25519PublicKey(sourceAddress)) {
      return NextResponse.json({ error: 'Invalid sourceAddress' }, { status: 400 });
    }

    const sourceAccount = await server.getAccount(sourceAddress);
    const innerTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
      .addOperation(
        Operation.invokeContractFunction({
          contract: walletAddress,
          function: 'revoke_signer',
          args: [signerKeyArg],
        })
      )
      .setTimeout(300)
      .build();

    const simulated = await Promise.race([
      server.simulateTransaction(innerTx),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Simulation timeout')), 30000)),
    ]) as any;

    if (!SorobanRpcApi.isSimulationSuccess(simulated)) {
      return NextResponse.json(
        { error: 'Simulation failed', details: simulated.error || simulated },
        { status: 400 }
      );
    }

    const authEntry = simulated.result?.auth?.[0];
    if (!authEntry) {
      return NextResponse.json({ error: 'No auth entry in simulation' }, { status: 400 });
    }

    const latestLedger = (await server.getLatestLedger()).sequence;
    const assembledTx = assembleTransaction(innerTx, simulated).build();

    // Boost instruction limit (same as add_signer)
    let assembledTxXdr: string;
    try {
      const tempXdr = assembledTx.toXDR();
      const envelope = xdr.TransactionEnvelope.fromXDR(tempXdr, 'base64');
      const resources = (envelope.v1().tx().ext() as any)._value._attributes.resources;
      resources._attributes.instructions = Math.max(resources._attributes.instructions, 7000000);
      assembledTxXdr = envelope.toXDR('base64');
    } catch {
      assembledTxXdr = assembledTx.toXDR();
    }

    return NextResponse.json({
      success: true,
      assembledTxXdr,
      rawTxXdr: innerTx.toXDR(),
      authEntryXdr: authEntry.toXDR('base64'),
      latestLedger: latestLedger.toString(),
      networkPassphrase,
    });
  } catch (error: any) {
    console.error('[SignerRevoke] Error:', error);
    return NextResponse.json(
      { error: 'Failed to build revoke transaction', message: error.message },
      { status: 500 }
    );
  }
}
