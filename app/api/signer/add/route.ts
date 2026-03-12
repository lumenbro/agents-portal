import { NextRequest, NextResponse } from 'next/server';
import { xdr, Operation, TransactionBuilder, StrKey, Address } from '@stellar/stellar-sdk';
import { Server as SorobanRpcServer, Api as SorobanRpcApi, assembleTransaction } from '@stellar/stellar-sdk/rpc';
import { Buffer } from 'buffer';
import { getServerRpcUrl, getNetworkPassphrase, isMainnet, getDefaultAgentPolicyAddress } from '@/lib/network-config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, signerPublicKey, role, policyAddress, sourceAddress, skipPolicy = false } = body;

    const rpcUrl = getServerRpcUrl();
    const networkPassphrase = getNetworkPassphrase();
    const server = new SorobanRpcServer(rpcUrl);

    const publicKeyBytes = StrKey.decodeEd25519PublicKey(signerPublicKey);
    const publicKeyBuffer = Buffer.from(publicKeyBytes);

    const ed25519SignerStruct = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('public_key'), val: xdr.ScVal.scvBytes(publicKeyBuffer) }),
    ]);

    const buildExternalValidatorPolicy = (address: string): xdr.ScVal => {
      const policyAddr = Address.fromString(address);
      const policyStruct = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('policy_address'), val: policyAddr.toScVal() }),
      ]);
      return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('ExternalValidatorPolicy'), policyStruct]);
    };

    const policyScVals: xdr.ScVal[] = [];
    if (!skipPolicy) {
      const effectivePolicy = policyAddress || getDefaultAgentPolicyAddress();
      if (effectivePolicy) policyScVals.push(buildExternalValidatorPolicy(effectivePolicy));
    }

    let signerRole: xdr.ScVal;
    if (role === 'Admin') {
      signerRole = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Admin')]);
    } else {
      signerRole = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Standard'), xdr.ScVal.scvVec(policyScVals)]);
    }

    const signerArg = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Ed25519'), ed25519SignerStruct, signerRole]);

    if (!sourceAddress || !StrKey.isValidEd25519PublicKey(sourceAddress)) {
      return NextResponse.json({ error: 'Missing or invalid sourceAddress' }, { status: 400 });
    }

    const sourceAccount = await server.getAccount(sourceAddress);
    const innerTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
      .addOperation(Operation.invokeContractFunction({ contract: walletAddress, function: 'add_signer', args: [signerArg] }))
      .setTimeout(300)
      .build();

    const simulated = await Promise.race([
      server.simulateTransaction(innerTx),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Simulation timeout')), 30000)),
    ]) as any;

    if (!SorobanRpcApi.isSimulationSuccess(simulated)) {
      return NextResponse.json({ error: 'Simulation failed', details: simulated.error || simulated }, { status: 400 });
    }

    const authEntry = simulated.result?.auth?.[0];
    if (!authEntry) return NextResponse.json({ error: 'No auth entry in simulation' }, { status: 400 });

    const latestLedger = (await server.getLatestLedger()).sequence;
    const assembledTx = assembleTransaction(innerTx, simulated).build();

    // Boost instruction limit
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
    return NextResponse.json({ error: 'Failed to build transaction', message: error.message }, { status: 500 });
  }
}
