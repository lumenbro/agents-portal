/**
 * Ghost Transaction Builder - Type Definitions
 *
 * Centralized types for the unified transaction system.
 */

import { Operation, xdr, Keypair } from '@stellar/stellar-sdk';

/**
 * Signer types supported by the transaction builder
 */
export type SignerType = 'passkey' | 'session' | 'recovery';

/**
 * Passkey information retrieved from storage or API
 */
export interface PasskeyInfo {
  credentialId: string;
  publicKeyBase64: string;
  walletAddress: string;
}

/**
 * Session signer info (iframe-based)
 */
export interface SessionSignerInfo {
  publicKeyXY: { x: string; y: string };
  iframeOrigin: string;
}

/**
 * Recovery signer info (Ed25519 from BIP-39)
 */
export interface RecoverySignerInfo {
  keypair: Keypair;
  publicKey: string;
}

/**
 * Ghost account ready for transactions
 */
export interface GhostReady {
  keypair: Keypair;
  address: string;
  userSalt: string;
  isSponsored: boolean;
}

/**
 * Challenge signed by ghost for paymaster verification
 */
export interface SignedChallenge {
  challenge: string;
  signature: string;
  expiresAt: number;
}

/**
 * Asset information for dynamic token operations
 */
export interface AssetInfo {
  code: string;
  issuer?: string; // undefined for native XLM
  contractAddress: string;
  decimals: number;
  name?: string;
  icon?: string;
}

/**
 * Operation builder function - called with auth entries after simulation
 */
export type OperationBuilder = (auth?: xdr.SorobanAuthorizationEntry[]) => Operation;

/**
 * Configuration for ghost transaction execution
 */
export interface GhostTransactionConfig {
  // Required
  walletAddress: string;

  // Operation - either pre-built or builder function
  operation: Operation | OperationBuilder;

  // Signer configuration
  signerType?: SignerType;        // Default: 'passkey'
  passkey?: PasskeyInfo;          // For passkey signer (auto-fetched if not provided)
  sessionSigner?: SessionSignerInfo; // For session signer (iframe)
  recoverySigner?: RecoverySignerInfo; // For recovery signer (Ed25519)

  // Ghost configuration
  ghostKeypair?: Keypair;         // Pre-derived ghost (e.g., for recovery flow)
  ghostAddress?: string;          // Pre-known ghost address
  skipGhostCreation?: boolean;    // Default: false - auto-create ghost if needed

  // Transaction options
  memo?: string;
  timeout?: number;

  // Flow control flags
  needsSimulation?: boolean;      // Default: true for Soroban ops
  needsAuth?: boolean;            // Default: true if simulation returns auth entries

  // Callbacks
  onStatusChange?: (status: string) => void;
}

/**
 * Result from ghost transaction execution
 */
export interface GhostTransactionResult {
  hash: string;
  ledger: number;
  fee?: string;
}

/**
 * Token transfer configuration
 */
export interface TokenTransferConfig {
  walletAddress: string;
  asset: AssetInfo | string; // AssetInfo or contract address
  to: string;
  amount: string; // Human-readable amount (e.g., "10.5")
  memo?: string;
  onStatusChange?: (status: string) => void;
}

/**
 * Smart send configuration - auto-resolves recipients
 */
export interface SmartSendConfig extends Omit<TokenTransferConfig, 'to'> {
  recipient: string; // Can be: G-address, C-address, email, phone, username
}

/**
 * Swap configuration (future)
 */
export interface SwapConfig {
  walletAddress: string;
  fromAsset: AssetInfo | string;
  toAsset: AssetInfo | string;
  fromAmount: string;
  minToAmount?: string; // Slippage protection
  memo?: string;
  onStatusChange?: (status: string) => void;
}
