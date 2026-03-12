/**
 * Footprint Augmentation for Recovery and Session Signer Transactions
 *
 * During simulation, auth entries may not have valid signatures, so __check_auth
 * doesn't execute fully. This means certain contract lookups aren't reached:
 * - Recovery signer: The Ed25519 signer key lookup is skipped
 * - Session signer: Policy contract calls are skipped
 *
 * We must manually add these to the footprint to prevent:
 * "trying to access contract data key outside of footprint" errors
 * "trying to access contract instance outside of the footprint" errors
 */

import {
  xdr,
  Address,
  SorobanDataBuilder,
  rpc,
} from '@stellar/stellar-sdk';
// IMPORTANT: Do NOT import from '@stellar/stellar-sdk/rpc' separately.
// Dual imports create different webpack module instances, causing instanceof failures.

/**
 * Builds ledger key for an Ed25519 signer stored in the smart wallet.
 *
 * The signer is stored in persistent contract data under key:
 * SignerKey::Ed25519(BytesN<32>) = Vec[Symbol("Ed25519"), Bytes(pubkey)]
 *
 * See: stellar-smart-account/contracts/smart-account-interfaces/src/auth/types.rs
 */
export function buildEd25519SignerLedgerKey(
  walletAddress: string,
  signerPublicKey: Buffer
): xdr.LedgerKey {
  // SignerKey::Ed25519(pubkey) serializes as Vec[Symbol("Ed25519"), Bytes(pubkey)]
  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Ed25519'),
    xdr.ScVal.scvBytes(signerPublicKey),
  ]);

  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(walletAddress).toScAddress(),
      key: signerKey,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

export interface FootprintAugmentationConfig {
  walletAddress: string;
  recoverySignerPublicKey?: Buffer; // Raw Ed25519 public key bytes (32 bytes)
  simulationResult: rpc.Api.SimulateTransactionSuccessResponse;
  instructionLimit?: number;
}

export interface AugmentedFootprint {
  sorobanData: xdr.SorobanTransactionData;
  additionalKeys: xdr.LedgerKey[];
}

/**
 * Augments the simulation footprint with the recovery signer.
 *
 * During simulation, the auth entry has no valid signature, so __check_auth
 * doesn't fully execute. The recovery signer lookup is skipped, meaning it's
 * not included in the simulation's footprint. We must add it manually.
 *
 * @param config - Configuration including wallet address and simulation result
 * @returns Augmented soroban data ready to apply to transaction
 */
export async function augmentFootprintForRecovery(
  config: FootprintAugmentationConfig
): Promise<AugmentedFootprint> {
  const {
    walletAddress,
    recoverySignerPublicKey,
    simulationResult,
    instructionLimit = 8_000_000,
  } = config;

  console.log('[FootprintAug] Augmenting footprint for recovery transaction...');

  const additionalReadOnlyKeys: xdr.LedgerKey[] = [];

  // Add recovery signer to footprint (required for __check_auth to verify the signer exists)
  if (recoverySignerPublicKey) {
    console.log('[FootprintAug] Adding recovery signer to footprint...');
    const signerKey = buildEd25519SignerLedgerKey(walletAddress, recoverySignerPublicKey);
    additionalReadOnlyKeys.push(signerKey);
  }

  // Apply footprint modifications
  const originalSorobanData = simulationResult.transactionData.build();
  const modifiedTransactionData = new SorobanDataBuilder(originalSorobanData)
    .appendFootprint(additionalReadOnlyKeys, []);

  // Build and increase instruction limit for __check_auth
  const modifiedSorobanData = modifiedTransactionData.build();
  const resources = modifiedSorobanData.resources();

  // @ts-ignore - XDR internal attributes
  resources._attributes.instructions = instructionLimit;

  console.log(`[FootprintAug] Footprint augmented with ${additionalReadOnlyKeys.length} additional keys, ${instructionLimit / 1_000_000}M instructions`);

  return {
    sorobanData: modifiedSorobanData,
    additionalKeys: additionalReadOnlyKeys,
  };
}

/**
 * Checks if simulation result is a success response
 */
export function isSimulationSuccess(
  sim: rpc.Api.SimulateTransactionResponse
): sim is rpc.Api.SimulateTransactionSuccessResponse {
  return !('error' in sim) && 'result' in sim;
}

/**
 * Builds ledger key for a contract instance.
 * Used to add policy contracts to the footprint.
 */
export function buildContractInstanceLedgerKey(contractAddress: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractAddress).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

/**
 * Looks up the WASM hash for a contract from its instance on-chain.
 * This is the reliable way to get the WASM hash since it reads directly from the ledger.
 *
 * @param contractAddress - The contract address (C...)
 * @param server - Soroban RPC server instance
 * @returns The WASM hash as a Buffer, or null if not found
 */
export async function lookupContractWasmHash(
  contractAddress: string,
  server: rpc.Server
): Promise<Buffer | null> {
  try {
    const instanceKey = buildContractInstanceLedgerKey(contractAddress);
    const ledgerEntries = await server.getLedgerEntries(instanceKey);

    if (ledgerEntries && ledgerEntries.entries.length > 0 && ledgerEntries.entries[0].val) {
      const entry = ledgerEntries.entries[0];
      const instanceData = entry.val.contractData();
      const wasmHash = instanceData.val().instance().executable().wasmHash();
      return Buffer.from(wasmHash as Uint8Array);
    }
    return null;
  } catch (err) {
    console.warn('[FootprintAug] Could not fetch WASM hash for', contractAddress, ':', err);
    return null;
  }
}

/**
 * Builds ledger key for contract WASM code.
 * Used when __check_auth needs to access the contract's code during execution.
 *
 * @param wasmHash - The contract's WASM hash (32 bytes as hex string or Buffer)
 */
export function buildContractCodeLedgerKey(wasmHash: string | Buffer): xdr.LedgerKey {
  let hashBuffer: Buffer;

  if (typeof wasmHash === 'string') {
    // Handle hex encoding (64 chars = 32 bytes)
    if (wasmHash.length === 64) {
      hashBuffer = Buffer.from(wasmHash, 'hex');
    } else {
      // Log warning for unexpected format
      console.warn('[FootprintAug] Unexpected WASM hash format, length:', wasmHash.length);
      hashBuffer = Buffer.from(wasmHash, 'hex');
    }
  } else {
    hashBuffer = wasmHash;
  }

  return xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({
      hash: hashBuffer,
    })
  );
}

/**
 * Builds ledger key for a secp256r1 signer stored in the smart wallet.
 *
 * The signer is stored in persistent contract data under key:
 * SignerKey::Secp256r1(BytesN<32>) = Vec[Symbol("Secp256r1"), Bytes(key_id)]
 */
export function buildSecp256r1SignerLedgerKey(
  walletAddress: string,
  keyId: Buffer
): xdr.LedgerKey {
  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Secp256r1'),
    xdr.ScVal.scvBytes(keyId),
  ]);

  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(walletAddress).toScAddress(),
      key: signerKey,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

export interface SessionSignerFootprintConfig {
  walletAddress: string;
  sessionSignerKeyId: string; // Base64 encoded x-coordinate (32 bytes)
  policyContractAddress?: string; // Time-bound policy contract
  walletWasmHash?: string; // Smart wallet WASM hash (hex) - optional, looked up if not provided
  policyWasmHash?: string; // Policy contract WASM hash (hex) - optional, looked up if not provided
  server?: rpc.Server; // Optional Soroban server for WASM hash lookups
  simulationResult: rpc.Api.SimulateTransactionSuccessResponse;
  instructionLimit?: number;
}

/**
 * Augments the simulation footprint for session signer transactions.
 *
 * Session signers have policy contracts (e.g., time-bound policy) that need
 * to be called during __check_auth. These contracts aren't in the simulation
 * footprint because simulation doesn't execute the full auth flow.
 *
 * Also adds contract WASM code to footprint because __check_auth may need
 * to access the wallet's and policy's code during execution.
 *
 * If walletWasmHash/policyWasmHash are not provided but server is provided,
 * will attempt to look up the WASM hashes from the chain.
 */
export async function augmentFootprintForSessionSigner(
  config: SessionSignerFootprintConfig
): Promise<AugmentedFootprint> {
  const {
    walletAddress,
    sessionSignerKeyId,
    policyContractAddress,
    server,
    simulationResult,
    instructionLimit = 8_000_000,
  } = config;

  // Look up WASM hashes if not provided
  let { walletWasmHash, policyWasmHash } = config;

  console.log('[FootprintAug] Augmenting footprint for session signer transaction...');

  const additionalReadOnlyKeys: xdr.LedgerKey[] = [];

  // Add session signer to footprint
  const keyIdBuffer = Buffer.from(sessionSignerKeyId, 'base64');
  console.log('[FootprintAug] Adding session signer (key_id) to footprint...');
  const signerKey = buildSecp256r1SignerLedgerKey(walletAddress, keyIdBuffer);
  additionalReadOnlyKeys.push(signerKey);

  // Add policy contract instance to footprint
  if (policyContractAddress) {
    console.log('[FootprintAug] Adding policy contract instance to footprint:', policyContractAddress);
    const policyInstanceKey = buildContractInstanceLedgerKey(policyContractAddress);
    additionalReadOnlyKeys.push(policyInstanceKey);
  }

  // Look up wallet WASM hash if not provided
  if (!walletWasmHash && server) {
    console.log('[FootprintAug] Looking up wallet WASM hash...');
    const hash = await lookupContractWasmHash(walletAddress, server);
    if (hash) {
      walletWasmHash = hash.toString('hex');
      console.log('[FootprintAug] Found wallet WASM hash:', walletWasmHash.substring(0, 16) + '...');
    }
  }

  // Look up policy WASM hash if not provided
  if (!policyWasmHash && policyContractAddress && server) {
    console.log('[FootprintAug] Looking up policy WASM hash...');
    const hash = await lookupContractWasmHash(policyContractAddress, server);
    if (hash) {
      policyWasmHash = hash.toString('hex');
      console.log('[FootprintAug] Found policy WASM hash:', policyWasmHash.substring(0, 16) + '...');
    }
  }

  // Add wallet WASM code to footprint (required for __check_auth execution)
  if (walletWasmHash) {
    console.log('[FootprintAug] Adding wallet WASM code to footprint:', walletWasmHash.substring(0, 16) + '...');
    const walletCodeKey = buildContractCodeLedgerKey(walletWasmHash);
    additionalReadOnlyKeys.push(walletCodeKey);
  }

  // Add policy WASM code to footprint (required for is_authorized execution)
  if (policyWasmHash) {
    console.log('[FootprintAug] Adding policy WASM code to footprint:', policyWasmHash.substring(0, 16) + '...');
    const policyCodeKey = buildContractCodeLedgerKey(policyWasmHash);
    additionalReadOnlyKeys.push(policyCodeKey);
  }

  // Apply footprint modifications
  const originalSorobanData = simulationResult.transactionData.build();
  const modifiedTransactionData = new SorobanDataBuilder(originalSorobanData)
    .appendFootprint(additionalReadOnlyKeys, []);

  // Build and increase instruction limit for __check_auth + policy calls
  const modifiedSorobanData = modifiedTransactionData.build();
  const resources = modifiedSorobanData.resources();

  // @ts-ignore - XDR internal attributes
  resources._attributes.instructions = instructionLimit;

  console.log(`[FootprintAug] Session signer footprint augmented with ${additionalReadOnlyKeys.length} additional keys`);

  return {
    sorobanData: modifiedSorobanData,
    additionalKeys: additionalReadOnlyKeys,
  };
}

export interface PasskeyFootprintConfig {
  walletAddress: string;
  passkeyKeyId: Buffer; // WebAuthn credential ID (32 bytes) -- this is the on-chain signer key_id
  walletWasmHash?: string; // Smart wallet WASM hash (hex) - optional, looked up if not provided
  server?: rpc.Server; // Optional Soroban server for WASM hash lookups
  simulationResult: rpc.Api.SimulateTransactionSuccessResponse;
  instructionLimit?: number;
}

/**
 * Augments the simulation footprint for passkey (Secp256r1) transactions.
 *
 * During simulation, auth entries have placeholder signatures, so __check_auth
 * doesn't fully execute. The passkey signer lookup is skipped, meaning its
 * persistent data key is NOT in the simulation's footprint. We must add it manually.
 *
 * Also adds wallet WASM code and deduplicates against existing footprint
 * to prevent txSorobanInvalid from duplicate keys.
 */
export async function augmentFootprintForPasskey(
  config: PasskeyFootprintConfig
): Promise<AugmentedFootprint> {
  const {
    walletAddress,
    passkeyKeyId,
    server,
    simulationResult,
    instructionLimit = 8_000_000,
  } = config;

  let { walletWasmHash } = config;

  console.log('[FootprintAug] Augmenting footprint for passkey transaction...');

  const candidateKeys: xdr.LedgerKey[] = [];

  // Get the signer key_id (WebAuthn credential ID, NOT x-coordinate of public key)
  // The smart wallet stores Secp256r1 signers keyed by credential ID.
  // IMPORTANT: passkeyPublicKeyBase64.slice(1,33) gives x-coordinate which is WRONG.
  let signerKeyId: Buffer;
  if (passkeyKeyId) {
    signerKeyId = passkeyKeyId;
    console.log('[FootprintAug] Using passkey key_id (credential ID):', signerKeyId.toString('base64').substring(0, 20) + '...');
  } else {
    throw new Error('passkeyKeyId (credential ID) is required for passkey footprint augmentation');
  }

  console.log('[FootprintAug] Adding passkey signer to footprint...');
  const signerKey = buildSecp256r1SignerLedgerKey(walletAddress, signerKeyId);
  candidateKeys.push(signerKey);

  // Look up wallet WASM hash if not provided
  if (!walletWasmHash && server) {
    console.log('[FootprintAug] Looking up wallet WASM hash...');
    const hash = await lookupContractWasmHash(walletAddress, server);
    if (hash) {
      walletWasmHash = hash.toString('hex');
      console.log('[FootprintAug] Found wallet WASM hash:', walletWasmHash.substring(0, 16) + '...');
    }
  }

  // Add wallet WASM code to footprint (required for __check_auth execution)
  if (walletWasmHash) {
    console.log('[FootprintAug] Adding wallet WASM code to footprint...');
    const walletCodeKey = buildContractCodeLedgerKey(walletWasmHash);
    candidateKeys.push(walletCodeKey);
  }

  // Deduplicate: check existing footprint keys before appending
  // appendFootprint() does NOT deduplicate -- duplicates cause txSorobanInvalid
  const originalSorobanData = simulationResult.transactionData.build();
  const existingRO = originalSorobanData.resources().footprint().readOnly();
  const existingRW = originalSorobanData.resources().footprint().readWrite();

  const existingKeySet = new Set([
    ...existingRO.map((k: xdr.LedgerKey) => k.toXDR('base64')),
    ...existingRW.map((k: xdr.LedgerKey) => k.toXDR('base64')),
  ]);

  const newKeys = candidateKeys.filter(
    k => !existingKeySet.has(k.toXDR('base64'))
  );

  console.log(`[FootprintAug] ${candidateKeys.length} candidate keys, ${newKeys.length} new (${candidateKeys.length - newKeys.length} already in footprint)`);

  let modifiedSorobanData: xdr.SorobanTransactionData;

  if (newKeys.length > 0) {
    modifiedSorobanData = new SorobanDataBuilder(originalSorobanData)
      .appendFootprint(newKeys, [])
      .build();
  } else {
    modifiedSorobanData = originalSorobanData;
  }

  // Bump instruction limit for __check_auth (secp256r1 sig verification ~2-3M extra)
  const resources = modifiedSorobanData.resources();
  // @ts-ignore - XDR internal attributes
  resources._attributes.instructions = instructionLimit;

  console.log(`[FootprintAug] Passkey footprint augmented with ${newKeys.length} new keys, ${instructionLimit / 1_000_000}M instructions`);

  return {
    sorobanData: modifiedSorobanData,
    additionalKeys: newKeys,
  };
}
