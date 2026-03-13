/**
 * GET /api/policy/budget?walletAddress=C...&policyAddress=C...
 *
 * Queries the spend policy contract for daily budget status via Soroban RPC simulation.
 * Returns: { dailyLimit, spentToday, remaining } in USDC (7-decimal stroops).
 *
 * No auth required — all data is public on-chain.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  xdr,
  Contract,
  Address,
  TransactionBuilder,
  Account,
} from '@stellar/stellar-sdk';
import { Server as SorobanRpcServer, Api as SorobanRpcApi } from '@stellar/stellar-sdk/rpc';
import { getServerRpcUrl, getNetworkPassphrase } from '@/lib/network-config';

export const runtime = 'nodejs';

// Well-known funded address for simulation (facilitator, never signs)
const SIM_SOURCE = 'GD4DCTKEB3Z2QZUNSAWQAT57TS6LO2ATNNOIMV2DLRFLFGWBVWJODUHT';

function scValToI128(val: xdr.ScVal): bigint {
  const i128 = val.i128();
  const hi = BigInt(i128.hi().toString());
  const lo = BigInt(i128.lo().toString());
  return (hi << 64n) | lo;
}

async function queryPolicyFn(
  server: SorobanRpcServer,
  policyAddress: string,
  fn: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
  sourceAccount: Account,
): Promise<bigint> {
  const contract = new Contract(policyAddress);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call(fn, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpcApi.isSimulationError(sim)) {
    throw new Error(`${fn}() simulation failed: ${(sim as any).error || 'unknown'}`);
  }

  const success = sim as SorobanRpcApi.SimulateTransactionSuccessResponse;
  const retVal = success.result?.retval;
  if (!retVal) return 0n;
  return scValToI128(retVal);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');
    const policyAddress = searchParams.get('policyAddress');

    if (!walletAddress || !policyAddress) {
      return NextResponse.json(
        { error: 'Missing walletAddress or policyAddress query params' },
        { status: 400 },
      );
    }

    const rpcUrl = getServerRpcUrl();
    const networkPassphrase = getNetworkPassphrase();
    const server = new SorobanRpcServer(rpcUrl);
    const sourceAccount = await server.getAccount(SIM_SOURCE);

    const walletScVal = Address.fromString(walletAddress).toScVal();

    // Run all three queries in parallel
    const [dailyLimit, spentToday, remaining] = await Promise.all([
      queryPolicyFn(server, policyAddress, 'daily_limit', [], networkPassphrase, sourceAccount),
      queryPolicyFn(server, policyAddress, 'spent_today', [walletScVal], networkPassphrase, sourceAccount),
      queryPolicyFn(server, policyAddress, 'remaining', [walletScVal], networkPassphrase, sourceAccount),
    ]);

    return NextResponse.json({
      dailyLimit: dailyLimit.toString(),
      spentToday: spentToday.toString(),
      remaining: remaining.toString(),
      dailyLimitUsdc: Number(dailyLimit) / 1e7,
      spentTodayUsdc: Number(spentToday) / 1e7,
      remainingUsdc: Number(remaining) / 1e7,
    });
  } catch (error: any) {
    console.error('[PolicyBudget] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to query policy budget' },
      { status: 500 },
    );
  }
}
