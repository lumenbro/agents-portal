/**
 * Ghost Transaction Builder - Main Entry Point
 *
 * Unified transaction system for all Stellar operations.
 * Handles ghost derivation, passkey auth, simulation, and submission.
 *
 * Usage:
 *   import { executeGhostTransaction, sendToken } from '@/lib/ghost-tx';
 *
 *   // Low-level: any operation
 *   await executeGhostTransaction({
 *     walletAddress: 'C...',
 *     operation: Operation.invokeContractFunction(...),
 *   });
 *
 *   // High-level: token transfer
 *   await sendToken({
 *     walletAddress: 'C...',
 *     asset: 'USDC' or contractAddress,
 *     to: 'G...',
 *     amount: '10.50',
 *   });
 */

// Re-export types
export * from './types';

// Re-export utilities
export { fetchPasskeyInfo, cachePasskeyInfo, clearPasskeyCache } from './fetch-passkey-info';
export { ensureGhostReady, checkGhostExists } from './ensure-ghost-ready';
export { getSignedChallenge, clearChallengeCache, hasCachedChallenge } from './challenge-manager';
export { submitWithRetry, rebuildWithNewSequence } from './submit-with-retry';
export {
  augmentFootprintForRecovery,
  augmentFootprintForPasskey,
  buildEd25519SignerLedgerKey,
  buildSecp256r1SignerLedgerKey,
  buildContractInstanceLedgerKey,
  buildContractCodeLedgerKey,
  lookupContractWasmHash,
  isSimulationSuccess,
} from './footprint-augmentation';

// Import for main function
import {
  TransactionBuilder,
  Operation,
  Horizon,
  xdr,
  Address,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
// IMPORTANT: Do NOT import from '@stellar/stellar-sdk/rpc' separately.
// Dual imports create different webpack module instances, causing instanceof
// failures on XDR types (e.g., auth entries from simulation are not recognized).
import type {
  GhostTransactionConfig,
  GhostTransactionResult,
  TokenTransferConfig,
  SmartSendConfig,
  OperationBuilder,
  SignerType,
  PasskeyInfo,
  RecoverySignerInfo,
} from './types';
import { fetchPasskeyInfo } from './fetch-passkey-info';
import { ensureGhostReady } from './ensure-ghost-ready';
import { submitWithRetry } from './submit-with-retry';
import { signWithPasskey as signWithCrossmintPasskey } from '../passkey/crossmint-webauthn';
import { Keypair } from '@stellar/stellar-sdk';
import { augmentFootprintForRecovery, augmentFootprintForPasskey, isSimulationSuccess } from './footprint-augmentation';
import { getNetworkConfig, getNetworkPassphrase, getRpcUrl, getHorizonUrl } from '../network-config';

const networkPassphrase = getNetworkPassphrase();
const sorobanRpcUrl = getRpcUrl();
const horizonUrl = getHorizonUrl();

/**
 * Main entry point for executing any ghost transaction.
 *
 * Supports multiple signer types:
 * - 'passkey' (default): Biometric auth via WebAuthn
 * - 'recovery': Ed25519 signing via BIP-39 recovery keypair
 *
 * Flow:
 * 1. Resolve signer info (passkey/recovery)
 * 2. Ensure ghost is ready (derive + sponsor)
 * 3. Build operation
 * 4. Simulate (for Soroban ops)
 * 5. Sign auth entries with appropriate signer
 * 6. Build and sign transaction
 * 7. Submit with retry
 */
export async function executeGhostTransaction(
  config: GhostTransactionConfig
): Promise<GhostTransactionResult> {
  const {
    walletAddress,
    operation,
    signerType = 'passkey',
    passkey: providedPasskey,
    recoverySigner,
    ghostKeypair: providedGhostKeypair,
    ghostAddress: providedGhostAddress,
    memo,
    timeout = 180,
    needsSimulation = true,
    needsAuth = true,
    skipGhostCreation = false,
    onStatusChange,
  } = config;

  const updateStatus = onStatusChange || (() => {});

  console.log('[GhostTx] Starting transaction for wallet:', walletAddress.substring(0, 12) + '...');
  console.log('[GhostTx] Requested signer type:', signerType);

  // Map session to passkey (session signer not supported in agents-portal)
  let effectiveSignerType: SignerType = signerType === 'session' ? 'passkey' : signerType;

  console.log('[GhostTx] Effective signer type:', effectiveSignerType);

  // 1. Resolve signer info based on type
  let passkey: PasskeyInfo | null = null;
  let ghostKeypair: Keypair | undefined = providedGhostKeypair;
  let ghostAddress: string | undefined = providedGhostAddress;

  if (effectiveSignerType === 'passkey') {
    updateStatus('Loading wallet credentials...');
    passkey = providedPasskey || await fetchPasskeyInfo(walletAddress);

    if (!passkey) {
      throw new Error('No passkey found for wallet. Please register a passkey first.');
    }
  } else if (effectiveSignerType === 'recovery') {
    if (!recoverySigner) {
      throw new Error('Recovery signer info required for recovery mode');
    }
  }

  // 2. Ensure ghost is ready (or use provided ghost)
  if (!ghostKeypair || !ghostAddress) {
    if (passkey) {
      const ghost = await ensureGhostReady(passkey.publicKeyBase64, {
        skipCreation: skipGhostCreation,
        onStatusChange: updateStatus,
      });
      ghostKeypair = ghost.keypair;
      ghostAddress = ghost.address;
    } else if (recoverySigner && providedGhostAddress) {
      ghostAddress = providedGhostAddress;
      if (!providedGhostKeypair) {
        throw new Error('Ghost keypair required for recovery mode');
      }
    } else {
      throw new Error('Cannot determine ghost account');
    }
  }

  // 3. Build initial operation
  updateStatus('Building transaction...');
  const isOperationBuilder = typeof operation === 'function';
  let currentOperation = isOperationBuilder ? (operation as OperationBuilder)() : operation;

  // 4. Simulate if needed (Soroban operations)
  let authEntries: xdr.SorobanAuthorizationEntry[] = [];
  let simulationResult: rpc.Api.SimulateTransactionSuccessResponse | null = null;
  let simTx: any = null;

  const sorobanServer = new rpc.Server(sorobanRpcUrl);
  const horizonServer = new Horizon.Server(horizonUrl);

  if (needsSimulation) {
    updateStatus('Simulating transaction...');

    const ghostAccount = await horizonServer.loadAccount(ghostAddress!);
    simTx = new TransactionBuilder(ghostAccount, {
      fee: '10000000',
      networkPassphrase,
    })
      .addOperation(currentOperation as any)
      .setTimeout(timeout)
      .build();

    const simResult = await sorobanServer.simulateTransaction(simTx);

    if ('error' in simResult) {
      throw new Error(`Simulation failed: ${(simResult as any).error}`);
    }

    if (!isSimulationSuccess(simResult)) {
      throw new Error('Simulation did not return success response');
    }

    simulationResult = simResult;

    if (simResult.result?.auth) {
      authEntries = (simResult.result.auth as any[]).map((a: any) => {
        if (typeof a === 'string') {
          return xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64');
        }
        if (a && typeof a === 'object') {
          if (typeof a.credentials === 'function' && typeof a.rootInvocation === 'function') {
            return a;
          }
          if (typeof a.toXDR === 'function') {
            return a;
          }
        }
        return xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64');
      });
      console.log('[GhostTx] Found', authEntries.length, 'auth entries');
    }
  }

  // 5. Sign auth entries with appropriate signer
  let signedAuthEntries: xdr.SorobanAuthorizationEntry[] = [];

  if (needsAuth && authEntries.length > 0) {
    for (const authEntry of authEntries) {
      const credentials = authEntry.credentials();

      if (credentials.switch().name === 'sorobanCredentialsAddress') {
        const addressCreds = credentials.address();
        const signerAddress = Address.fromScAddress(addressCreds.address()).toString();

        if (signerAddress === walletAddress) {
          let signedAuth: xdr.SorobanAuthorizationEntry;

          if (effectiveSignerType === 'passkey') {
            updateStatus('Biometric authentication required...');
            const latestLedger = await sorobanServer.getLatestLedger();
            signedAuth = await signWithCrossmintPasskey(
              authEntry,
              passkey!.credentialId,
              networkPassphrase,
              latestLedger.sequence
            );
          } else {
            updateStatus('Signing with recovery key...');
            signedAuth = await signAuthEntryWithRecoverySigner(
              authEntry,
              recoverySigner!,
              walletAddress
            );
          }

          signedAuthEntries.push(signedAuth);
        } else {
          signedAuthEntries.push(authEntry);
        }
      } else {
        signedAuthEntries.push(authEntry);
      }
    }
  }

  // 6. Build final transaction with proper footprint
  updateStatus('Finalizing transaction...');

  let transaction: any;

  if (simulationResult && simTx) {
    let assembled = rpc.assembleTransaction(simTx, simulationResult);

    // For recovery mode, augment footprint with recovery signer
    if (effectiveSignerType === 'recovery' && recoverySigner) {
      const augmented = await augmentFootprintForRecovery({
        walletAddress,
        recoverySignerPublicKey: recoverySigner.keypair.rawPublicKey(),
        simulationResult,
        instructionLimit: 8_000_000,
      });
      assembled = assembled.setSorobanData(augmented.sorobanData);
    }

    // For passkey mode, augment footprint with signer key + bump instructions
    if (effectiveSignerType === 'passkey' && passkey) {
      let passkeyKeyId: Buffer | undefined;

      // Method 1: Extract from signed auth entry
      if (signedAuthEntries.length > 0) {
        try {
          const sig = signedAuthEntries[0].credentials().address().signature();
          const outerVec = sig.vec();
          if (outerVec && outerVec.length > 0) {
            const innerMap = outerVec[0].map();
            if (innerMap && innerMap.length > 0) {
              const keyVec = innerMap[0].key().vec();
              if (keyVec && keyVec.length >= 2 && keyVec[0].sym().toString() === 'Secp256r1') {
                passkeyKeyId = Buffer.from(keyVec[1].bytes());
              }
            }
          }
        } catch (e: any) {}
      }

      // Method 2: Use credential ID from passkey info
      if (!passkeyKeyId && passkey.credentialId) {
        const credIdBase64 = passkey.credentialId.replace(/-/g, '+').replace(/_/g, '/');
        passkeyKeyId = Buffer.from(credIdBase64, 'base64');
      }

      if (!passkeyKeyId) {
        throw new Error('Could not determine passkey key_id (credential ID) for footprint augmentation');
      }

      const networkConfig = getNetworkConfig();
      const augmented = await augmentFootprintForPasskey({
        walletAddress,
        passkeyKeyId,
        walletWasmHash: networkConfig.smartAccountWasmHash,
        server: sorobanServer,
        simulationResult,
        instructionLimit: 8_000_000,
      });

      assembled = assembled.setSorobanData(augmented.sorobanData);
    }

    transaction = assembled.build();

    if (signedAuthEntries.length > 0) {
      (transaction.operations[0] as any).auth = signedAuthEntries;
    }
  } else {
    const ghostAccount = await horizonServer.loadAccount(ghostAddress!);
    let txBuilder = new TransactionBuilder(ghostAccount, {
      fee: '100',
      networkPassphrase,
    }).addOperation(currentOperation as any);

    if (memo) {
      const { Memo } = await import('@stellar/stellar-sdk');
      txBuilder = txBuilder.addMemo(Memo.text(memo.substring(0, 28)));
    }

    transaction = txBuilder.setTimeout(timeout).build();
  }

  // 7. Submit with retry
  return submitWithRetry({
    transaction,
    ghostKeypair: ghostKeypair!,
    ghostAddress: ghostAddress!,
    passkeyPublicKeyBase64: passkey?.publicKeyBase64 || '',
    onStatusChange: updateStatus,
    rebuildTransaction: async () => {
      const newAccount = await horizonServer.loadAccount(ghostAddress!);
      let newBuilder = new TransactionBuilder(newAccount, {
        fee: '10000000',
        networkPassphrase,
      }).addOperation(currentOperation as any);

      if (memo) {
        const { Memo } = await import('@stellar/stellar-sdk');
        newBuilder = newBuilder.addMemo(Memo.text(memo.substring(0, 28)));
      }

      let newTx = newBuilder.setTimeout(timeout).build();

      if (simulationResult) {
        let assembled = rpc.assembleTransaction(newTx, simulationResult);

        if (effectiveSignerType === 'recovery' && recoverySigner) {
          const augmented = await augmentFootprintForRecovery({
            walletAddress,
            recoverySignerPublicKey: recoverySigner.keypair.rawPublicKey(),
            simulationResult,
            instructionLimit: 8_000_000,
          });
          assembled = assembled.setSorobanData(augmented.sorobanData);
        }

        if (effectiveSignerType === 'passkey' && passkey && simulationResult) {
          let retryKeyId: Buffer | undefined;

          if (signedAuthEntries.length > 0) {
            try {
              const sig = signedAuthEntries[0].credentials().address().signature();
              const outerVec = sig.vec();
              if (outerVec && outerVec.length > 0) {
                const innerMap = outerVec[0].map();
                if (innerMap && innerMap.length > 0) {
                  const keyVec = innerMap[0].key().vec();
                  if (keyVec && keyVec.length >= 2 && keyVec[0].sym().toString() === 'Secp256r1') {
                    retryKeyId = Buffer.from(keyVec[1].bytes());
                  }
                }
              }
            } catch (e) {}
          }

          if (!retryKeyId && passkey.credentialId) {
            const credIdBase64 = passkey.credentialId.replace(/-/g, '+').replace(/_/g, '/');
            retryKeyId = Buffer.from(credIdBase64, 'base64');
          }

          if (!retryKeyId) {
            throw new Error('Could not determine passkey key_id (credential ID) for retry footprint augmentation');
          }

          const networkConfig = getNetworkConfig();
          const augmented = await augmentFootprintForPasskey({
            walletAddress,
            passkeyKeyId: retryKeyId,
            walletWasmHash: networkConfig.smartAccountWasmHash,
            server: sorobanServer,
            simulationResult,
            instructionLimit: 8_000_000,
          });
          assembled = assembled.setSorobanData(augmented.sorobanData);
        }

        newTx = assembled.build();

        if (signedAuthEntries.length > 0) {
          (newTx.operations[0] as any).auth = signedAuthEntries;
        }
      }

      return newTx;
    },
  });
}

/**
 * Signs a Soroban auth entry with recovery signer (Ed25519)
 */
async function signAuthEntryWithRecoverySigner(
  authEntry: xdr.SorobanAuthorizationEntry,
  recoverySigner: RecoverySignerInfo,
  walletAddress: string
): Promise<xdr.SorobanAuthorizationEntry> {
  const credentials = authEntry.credentials().address();
  const nonce = credentials.nonce();
  const signatureExpirationLedger = credentials.signatureExpirationLedger();

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: Buffer.from(networkPassphrase),
      nonce,
      signatureExpirationLedger,
      invocation: authEntry.rootInvocation(),
    })
  );

  const payloadHash = Buffer.from(
    await crypto.subtle.digest('SHA-256', new Uint8Array(preimage.toXDR()))
  );

  const signature = recoverySigner.keypair.sign(payloadHash);
  const publicKeyRawBytes = recoverySigner.keypair.rawPublicKey();

  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Ed25519'),
    xdr.ScVal.scvBytes(Buffer.from(publicKeyRawBytes)),
  ]);

  const signerProof = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Ed25519'),
    xdr.ScVal.scvBytes(signature),
  ]);

  const signatureProofsMap = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: signerKey,
      val: signerProof,
    }),
  ]);

  const signedCredentials = xdr.ScVal.scvVec([signatureProofsMap]);

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: credentials.address(),
        nonce,
        signatureExpirationLedger,
        signature: signedCredentials,
      })
    ),
    rootInvocation: authEntry.rootInvocation(),
  });
}

// ============================================================================
// HIGH-LEVEL API: Token Transfers
// ============================================================================

/**
 * Formats amount to i128 ScVal with proper decimals
 */
function formatAmount(amount: string, decimals: number): xdr.ScVal {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').substring(0, decimals);
  const rawAmount = BigInt(whole + paddedFraction);

  return nativeToScVal(rawAmount, { type: 'i128' });
}

/**
 * Sends tokens using dynamic asset resolution.
 */
export async function sendToken(config: TokenTransferConfig): Promise<GhostTransactionResult> {
  const { walletAddress, asset, to, amount, memo, onStatusChange } = config;

  const updateStatus = onStatusChange || (() => {});

  const assetInfo = typeof asset === 'object'
    ? asset
    : { code: 'TOKEN', contractAddress: asset as string, decimals: 7 };

  const operationBuilder: OperationBuilder = (auth) => {
    return Operation.invokeContractFunction({
      contract: assetInfo.contractAddress,
      function: 'transfer',
      args: [
        new Address(walletAddress).toScVal(),
        new Address(to).toScVal(),
        formatAmount(amount, assetInfo.decimals),
      ],
      auth: auth || [],
    }) as any;
  };

  return executeGhostTransaction({
    walletAddress,
    operation: operationBuilder,
    memo: memo || `Send ${assetInfo.code}`,
    onStatusChange: updateStatus,
  });
}

// ============================================================================
// SIGNER MANAGEMENT
// ============================================================================

/**
 * Adds a signer to the smart wallet.
 */
export async function addSigner(config: {
  walletAddress: string;
  signer: xdr.ScVal;
  onStatusChange?: (status: string) => void;
}): Promise<GhostTransactionResult> {
  const { walletAddress, signer, onStatusChange } = config;

  const operationBuilder: OperationBuilder = (auth) => {
    return Operation.invokeContractFunction({
      contract: walletAddress,
      function: 'add_signer',
      args: [signer],
      auth: auth || [],
    }) as any;
  };

  return executeGhostTransaction({
    walletAddress,
    operation: operationBuilder,
    memo: 'Add signer',
    onStatusChange,
  });
}

/**
 * Removes a signer from the smart wallet.
 */
export async function removeSigner(config: {
  walletAddress: string;
  signerKey: xdr.ScVal;
  onStatusChange?: (status: string) => void;
}): Promise<GhostTransactionResult> {
  const { walletAddress, signerKey, onStatusChange } = config;

  const operationBuilder: OperationBuilder = (auth) => {
    return Operation.invokeContractFunction({
      contract: walletAddress,
      function: 'remove_signer',
      args: [signerKey],
      auth: auth || [],
    }) as any;
  };

  return executeGhostTransaction({
    walletAddress,
    operation: operationBuilder,
    memo: 'Remove signer',
    onStatusChange,
  });
}

/**
 * Revokes a signer (same as remove, different name for clarity)
 */
export const revokeSigner = removeSigner;

// ============================================================================
// GENERIC CONTRACT CALLS
// ============================================================================

/**
 * Calls any contract function with full auth support.
 */
export async function callContract(config: {
  walletAddress: string;
  contractAddress: string;
  functionName: string;
  args: xdr.ScVal[];
  memo?: string;
  onStatusChange?: (status: string) => void;
}): Promise<GhostTransactionResult> {
  const { walletAddress, contractAddress, functionName, args, memo, onStatusChange } = config;

  const operationBuilder: OperationBuilder = (auth) => {
    return Operation.invokeContractFunction({
      contract: contractAddress,
      function: functionName,
      args,
      auth: auth || [],
    }) as any;
  };

  return executeGhostTransaction({
    walletAddress,
    operation: operationBuilder,
    memo: memo || `Call ${functionName}`,
    onStatusChange,
  });
}

/**
 * Calls a function on the wallet contract itself.
 * Convenience wrapper for wallet self-operations.
 */
export async function callWalletFunction(config: {
  walletAddress: string;
  functionName: string;
  args: xdr.ScVal[];
  memo?: string;
  onStatusChange?: (status: string) => void;
}): Promise<GhostTransactionResult> {
  return callContract({
    ...config,
    contractAddress: config.walletAddress,
  });
}
