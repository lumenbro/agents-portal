/**
 * keypo-signer CLI Wrapper
 *
 * TypeScript wrapper around the keypo-signer binary for
 * Apple Secure Enclave / Windows TPM P-256 key management.
 *
 * Keys are hardware-bound: private keys never exist in software memory.
 * Same secp256r1 curve as passkeys -> same __check_auth path in smart wallet.
 *
 * The smart wallet contract verifies Secp256r1 signatures in WebAuthn format
 * (authenticator_data + client_data_json + signature). SE keys produce raw
 * ECDSA signatures, so signForSmartWallet() constructs synthetic WebAuthn
 * attestation data that wraps the SE signature. The contract verifies the
 * math — it doesn't check that authenticator_data came from a real browser.
 *
 * Usage:
 *   import { signForSmartWallet, generateKey } from '@/lib/keypo-signer';
 *   const key = await generateKey('agent-bot-1');
 *   const proof = await signForSmartWallet(authHash, key.label, key.publicKey);
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

const DEFAULT_BINARY = 'keypo-signer';

// RP ID for synthetic WebAuthn attestation
const SYNTHETIC_RP_ID = 'agents.lumenbro.com';
const SYNTHETIC_ORIGIN = 'https://agents.lumenbro.com';

export interface KeypoSignerConfig {
  binaryPath?: string; // Path to keypo-signer binary (default: in PATH)
}

export interface KeypoKeyInfo {
  label: string;
  publicKey: Buffer; // 65 bytes uncompressed (0x04 || X || Y)
}

export interface SmartWalletSignatureProof {
  keyId: string; // base64 encoded key_id (SHA256 of public key)
  authenticatorData: Uint8Array; // 37 bytes synthetic attestation
  clientDataJson: string; // Synthetic client_data_json with embedded challenge
  signature: Uint8Array; // 64 bytes compact R||S (low-S normalized)
}

/**
 * Check if keypo-signer is available on this system
 */
export async function isKeypoAvailable(config?: KeypoSignerConfig): Promise<boolean> {
  try {
    const binary = config?.binaryPath || DEFAULT_BINARY;
    await execFileAsync(binary, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a new P-256 key in Secure Enclave
 *
 * @param label - Key label (e.g., 'agent-compute-bot-1')
 * @param policy - Vault policy: 'open' (headless), 'passcode', 'biometric'
 * @returns Public key (65 bytes uncompressed)
 */
export async function generateKey(
  label: string,
  policy: 'open' | 'passcode' | 'biometric' = 'open',
  config?: KeypoSignerConfig,
): Promise<KeypoKeyInfo> {
  const binary = config?.binaryPath || DEFAULT_BINARY;

  const { stdout } = await execFileAsync(binary, [
    'generate',
    '--label', label,
    '--policy', policy,
  ]);

  // Parse public key from stdout (hex-encoded 65 bytes)
  const pubKeyHex = stdout.trim();
  const publicKey = Buffer.from(pubKeyHex, 'hex');

  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error(
      `Invalid public key from keypo-signer: expected 65 bytes starting with 0x04, got ${publicKey.length} bytes`,
    );
  }

  return { label, publicKey };
}

/**
 * Sign a 32-byte hash with a Secure Enclave key (raw ECDSA)
 *
 * keypo-signer uses pre-hashed signing (digest passed directly to SE,
 * no double-hashing). Returns compact R||S with low-S normalization
 * already applied (required by Soroban).
 *
 * For smart wallet auth, use signForSmartWallet() instead — it wraps
 * the raw signature in WebAuthn-compatible format.
 */
export async function sign(
  hash: Buffer,
  keyLabel: string,
  config?: KeypoSignerConfig,
): Promise<Buffer> {
  if (hash.length !== 32) {
    throw new Error(`Hash must be 32 bytes, got ${hash.length}`);
  }

  const binary = config?.binaryPath || DEFAULT_BINARY;

  const { stdout } = await execFileAsync(binary, [
    'sign',
    hash.toString('hex'),
    '--key', keyLabel,
  ]);

  const signature = Buffer.from(stdout.trim(), 'hex');

  if (signature.length !== 64) {
    throw new Error(
      `Invalid signature from keypo-signer: expected 64 bytes, got ${signature.length}`,
    );
  }

  return signature;
}

/**
 * Get public key for an existing key label
 */
export async function getPublicKey(
  keyLabel: string,
  config?: KeypoSignerConfig,
): Promise<Buffer> {
  const binary = config?.binaryPath || DEFAULT_BINARY;

  const { stdout } = await execFileAsync(binary, [
    'public-key',
    '--key', keyLabel,
  ]);

  const publicKey = Buffer.from(stdout.trim(), 'hex');

  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error(
      `Invalid public key: expected 65 bytes starting with 0x04, got ${publicKey.length} bytes`,
    );
  }

  return publicKey;
}

/**
 * List all key labels in the Secure Enclave vault
 */
export async function listKeys(config?: KeypoSignerConfig): Promise<string[]> {
  const binary = config?.binaryPath || DEFAULT_BINARY;
  const { stdout } = await execFileAsync(binary, ['list']);
  return stdout.trim().split('\n').filter(Boolean);
}

/**
 * Delete a key from the Secure Enclave
 */
export async function deleteKey(
  keyLabel: string,
  config?: KeypoSignerConfig,
): Promise<void> {
  const binary = config?.binaryPath || DEFAULT_BINARY;
  await execFileAsync(binary, ['delete', '--key', keyLabel]);
}

// ---------------------------------------------------------------------------
// Smart Wallet integration — WebAuthn-compatible SE signing
// ---------------------------------------------------------------------------

/**
 * Compute the key_id for a Secp256r1 key (deterministic from public key)
 *
 * Convention: key_id = SHA256(uncompressed_public_key)
 * This is used both at add_signer time and at signing time.
 */
export function computeKeyId(publicKey: Buffer): Buffer {
  return crypto.createHash('sha256').update(publicKey).digest();
}

/**
 * Build base64url string (no padding) from a buffer
 */
function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build synthetic WebAuthn authenticator_data (37 bytes minimum)
 *
 * Format: rpIdHash(32) + flags(1) + counter(4)
 *  - rpIdHash: SHA256 of RP ID
 *  - flags: 0x05 = UP (user present) + UV (user verified)
 *  - counter: 0x00000001 (non-zero to look realistic)
 */
function buildSyntheticAuthenticatorData(): Buffer {
  const rpIdHash = crypto.createHash('sha256').update(SYNTHETIC_RP_ID).digest();
  const flags = Buffer.from([0x05]); // UP + UV
  const counter = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([rpIdHash, flags, counter]);
}

/**
 * Build synthetic client_data_json with embedded challenge
 *
 * The smart wallet contract extracts the challenge from this JSON
 * and verifies it matches the expected soroban auth hash.
 */
function buildSyntheticClientDataJson(challenge: Buffer): string {
  const challengeB64Url = toBase64Url(challenge);
  return JSON.stringify({
    type: 'webauthn.get',
    challenge: challengeB64Url,
    origin: SYNTHETIC_ORIGIN,
    crossOrigin: false,
  });
}

/**
 * Sign a soroban auth hash for smart wallet __check_auth verification
 *
 * Constructs synthetic WebAuthn attestation data around the SE signature
 * so the smart wallet contract's Secp256r1 verification passes.
 *
 * The contract verifies:
 *   message = SHA256(authenticator_data || SHA256(client_data_json))
 *   verify_ecdsa_secp256r1(public_key, message, signature)
 *
 * We construct authenticator_data and client_data_json such that the
 * challenge embedded in client_data_json matches the soroban auth hash,
 * then sign the computed message with the SE key.
 *
 * @param authHash - 32-byte soroban authorization hash
 * @param keyLabel - Key label in Secure Enclave
 * @param publicKey - 65-byte uncompressed public key (for key_id computation)
 * @param config - Optional keypo-signer config
 * @returns SmartWalletSignatureProof ready for buildSecp256r1SignatureProofs()
 */
export async function signForSmartWallet(
  authHash: Buffer,
  keyLabel: string,
  publicKey: Buffer,
  config?: KeypoSignerConfig,
): Promise<SmartWalletSignatureProof> {
  if (authHash.length !== 32) {
    throw new Error(`Auth hash must be 32 bytes, got ${authHash.length}`);
  }

  // 1. Build synthetic WebAuthn attestation
  const authenticatorData = buildSyntheticAuthenticatorData();
  const clientDataJson = buildSyntheticClientDataJson(authHash);

  // 2. Compute WebAuthn verification hash (what the contract will recompute)
  //    message = SHA256(authenticator_data || SHA256(client_data_json))
  const clientDataHash = crypto
    .createHash('sha256')
    .update(clientDataJson)
    .digest();
  const message = crypto
    .createHash('sha256')
    .update(Buffer.concat([authenticatorData, clientDataHash]))
    .digest();

  // 3. Sign the WebAuthn message hash with SE key (pre-hashed, 32 bytes)
  const signature = await sign(message, keyLabel, config);

  // 4. Compute key_id from public key
  const keyId = computeKeyId(publicKey);

  return {
    keyId: keyId.toString('base64'),
    authenticatorData: new Uint8Array(authenticatorData),
    clientDataJson,
    signature: new Uint8Array(signature),
  };
}
