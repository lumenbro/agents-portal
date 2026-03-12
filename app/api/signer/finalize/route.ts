import { NextRequest, NextResponse } from 'next/server';
import { xdr, Transaction } from '@stellar/stellar-sdk';
import { Server as SorobanRpcServer, Api as SorobanRpcApi, assembleTransaction } from '@stellar/stellar-sdk/rpc';
import { getServerRpcUrl, getNetworkPassphrase } from '@/lib/network-config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { rawTxXdr, assembledTxXdr, signedAuthEntryXdr, networkPassphrase: clientNp } = await request.json();

    if (!signedAuthEntryXdr) {
      return NextResponse.json({ error: 'Missing signedAuthEntryXdr' }, { status: 400 });
    }

    const np = clientNp || getNetworkPassphrase();
    const signedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(signedAuthEntryXdr, 'base64');

    // Use the raw (un-assembled) TX if available for re-simulation
    const txXdr = rawTxXdr || assembledTxXdr;
    if (!txXdr) {
      return NextResponse.json({ error: 'Missing rawTxXdr or assembledTxXdr' }, { status: 400 });
    }

    // Parse the raw TX and inject the signed auth entry
    const rawTx = new Transaction(txXdr, np);
    const rawEnvelope = rawTx.toEnvelope();
    const rawOp = rawEnvelope.v1().tx().operations()[0];

    if (rawOp.body().switch().name !== 'invokeHostFunction') {
      return NextResponse.json({ error: 'Not an invokeHostFunction operation' }, { status: 400 });
    }

    rawOp.body().invokeHostFunctionOp().auth([signedAuthEntry]);

    // Re-simulate with the signed auth — this runs __check_auth
    // and discovers all footprint entries needed for on-chain execution
    const server = new SorobanRpcServer(getServerRpcUrl());
    const txWithAuth = new Transaction(rawEnvelope.toXDR('base64'), np);

    const simulated = await Promise.race([
      server.simulateTransaction(txWithAuth),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Re-simulation timeout')), 30000)),
    ]) as any;

    if (!SorobanRpcApi.isSimulationSuccess(simulated)) {
      console.error('[Finalize] Re-simulation failed:', simulated.error || simulated);
      return NextResponse.json({
        error: 'Re-simulation with signed auth failed',
        details: simulated.error || 'Unknown simulation error',
      }, { status: 400 });
    }

    // Assemble with correct footprint from re-simulation
    const assembled = assembleTransaction(txWithAuth, simulated).build();

    // The assembled TX has the simulation's auth entries (which may be mock-signed).
    // Replace them with our passkey-signed auth entry.
    const assembledEnvelope = xdr.TransactionEnvelope.fromXDR(assembled.toXDR(), 'base64');
    const assembledOp = assembledEnvelope.v1().tx().operations()[0];
    assembledOp.body().invokeHostFunctionOp().auth([signedAuthEntry]);

    return NextResponse.json({ success: true, innerXdr: assembledEnvelope.toXDR('base64') });
  } catch (error: any) {
    console.error('[Finalize] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to finalize' }, { status: 500 });
  }
}
