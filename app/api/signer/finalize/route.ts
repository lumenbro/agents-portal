import { NextRequest, NextResponse } from 'next/server';
import { xdr, Address } from '@stellar/stellar-sdk';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { assembledTxXdr, signedAuthEntryXdr, networkPassphrase, passkeyCredentialId, walletAddress } = await request.json();

    if (!assembledTxXdr || !signedAuthEntryXdr || !networkPassphrase) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const signedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedAuthEntryXdr, 'base64');
    const envelope = xdr.TransactionEnvelope.fromXDR(assembledTxXdr, 'base64');

    const tx = envelope.v1().tx();
    const op = tx.operations()[0];
    if (op.body().switch().name !== 'invokeHostFunction') {
      return NextResponse.json({ error: 'Not an invokeHostFunction operation' }, { status: 400 });
    }

    op.body().invokeHostFunctionOp().auth([signedAuthEntry]);

    if (passkeyCredentialId && walletAddress) {
      let keyIdBytes: Buffer;
      try {
        const base64url = require('base64url').default;
        keyIdBytes = base64url.toBuffer(passkeyCredentialId);
      } catch {
        keyIdBytes = Buffer.from(passkeyCredentialId, 'base64');
      }

      const signerLedgerKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(walletAddress).toScAddress(),
          key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Secp256r1'), xdr.ScVal.scvBytes(keyIdBytes)]),
          durability: xdr.ContractDataDurability.persistent(),
        })
      );

      const sorobanData = (tx.ext() as any)._value;
      const resources = sorobanData._attributes.resources;
      resources.footprint().readOnly().push(signerLedgerKey);
      resources._attributes.instructions = Math.max(resources._attributes.instructions, 8000000);
    }

    return NextResponse.json({ success: true, innerXdr: envelope.toXDR('base64') });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to finalize' }, { status: 500 });
  }
}
