/**
 * Transaction Submission with Retry
 *
 * Handles submission to paymaster with automatic retry on sequence mismatch.
 */

import { Transaction, Keypair, Horizon, TransactionBuilder, Account } from '@stellar/stellar-sdk';
import type { GhostTransactionResult, SignedChallenge } from './types';
import { getSignedChallenge, clearChallengeCache } from './challenge-manager';
import { getNetworkPassphrase, getHorizonUrl } from '@/lib/network-config';

const horizonUrl = getHorizonUrl();
const networkPassphrase = getNetworkPassphrase();

export interface SubmitOptions {
  transaction: Transaction;
  ghostKeypair: Keypair;
  ghostAddress: string;
  passkeyPublicKeyBase64: string;
  maxRetries?: number;
  onStatusChange?: (status: string) => void;
  // For rebuilding on sequence mismatch
  rebuildTransaction?: (newSequence: string) => Promise<Transaction>;
}

/**
 * Submits transaction to paymaster with automatic retry on sequence mismatch.
 *
 * @param options - Submission options including transaction and ghost keypair
 * @returns Transaction result with hash and ledger
 */
export async function submitWithRetry(options: SubmitOptions): Promise<GhostTransactionResult> {
  const {
    transaction,
    ghostKeypair,
    ghostAddress,
    passkeyPublicKeyBase64,
    maxRetries = 2,
    onStatusChange,
    rebuildTransaction,
  } = options;

  const updateStatus = onStatusChange || (() => {});
  let currentTx = transaction;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      updateStatus(attempt > 0 ? `Retrying submission (${attempt}/${maxRetries})...` : 'Submitting transaction...');

      // Get fresh challenge
      const signedChallenge = await getSignedChallenge(ghostKeypair, attempt > 0);

      // Sign transaction envelope with ghost
      currentTx.sign(ghostKeypair);

      console.log('[Submit] Submitting to paymaster, attempt', attempt + 1);

      const response = await fetch('/api/paymaster/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghostAddress,
          challenge: signedChallenge.challenge,
          signature: signedChallenge.signature,
          innerXdr: currentTx.toXDR(),
          passkeyPublicKeyBase64,
        }),
      });

      const result = await response.json();

      // Unwrap createSuccessResponse format: { success: true, data: { hash, ledger } }
      const data = result.data || result;

      if (response.ok) {
        clearChallengeCache();
        console.log('[Submit] Success:', data.hash);
        updateStatus('Transaction confirmed');

        return {
          hash: data.hash || data.txHash,
          ledger: data.ledger,
          fee: data.fee,
        };
      }

      // Handle sequence mismatch (409)
      if (response.status === 409 && rebuildTransaction && attempt < maxRetries) {
        console.log('[Submit] Sequence mismatch, rebuilding transaction...');
        updateStatus('Sequence mismatch, retrying...');

        // Get correct sequence from Horizon
        const correctSequence = await getCorrectSequence(ghostAddress);

        if (correctSequence) {
          currentTx = await rebuildTransaction(correctSequence);
          attempt++;
          continue;
        }
      }

      // Extract error message from createErrorResponse format: { error: { code, message } }
      const errorMsg = typeof result.error === 'object'
        ? (result.error.message || JSON.stringify(result.error))
        : (result.error || `Submission failed: ${response.status}`);
      throw new Error(errorMsg);
    } catch (error: any) {
      if (attempt >= maxRetries) {
        throw error;
      }

      console.warn('[Submit] Attempt', attempt + 1, 'failed:', error.message);
      attempt++;
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Gets the correct sequence number from Horizon
 */
async function getCorrectSequence(ghostAddress: string): Promise<string | null> {
  try {
    const server = new Horizon.Server(horizonUrl);
    const account = await server.loadAccount(ghostAddress);
    return account.sequenceNumber();
  } catch (error: any) {
    console.error('[Submit] Failed to get sequence:', error.message);
    return null;
  }
}

/**
 * Helper to rebuild a transaction with a new sequence number
 */
export async function rebuildWithNewSequence(
  ghostAddress: string,
  operations: any[],
  timeout = 180,
  memo?: string
): Promise<Transaction> {
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(ghostAddress);

  let builder = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  });

  for (const op of operations) {
    builder = builder.addOperation(op);
  }

  if (memo) {
    const { Memo } = await import('@stellar/stellar-sdk');
    builder = builder.addMemo(Memo.text(memo));
  }

  return builder.setTimeout(timeout).build();
}
