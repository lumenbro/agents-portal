/**
 * Wallet Deployment Service
 *
 * Based on Stellar Smart Account Contract Factory test patterns
 * Server-side wallet deployment via API
 *
 * CRITICAL: This is for Next.js API routes (Vercel-compatible)
 */

import {
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  Contract,
  Address,
  StrKey,
  hash,
} from '@stellar/stellar-sdk'
import {
  Server as SorobanRpcServer,
  Api as SorobanRpcApi,
  assembleTransaction
} from '@stellar/stellar-sdk/rpc'
import { xdr } from '@stellar/stellar-sdk'

// Removed unused interfaces - deployment is handled directly

interface SignerConfig {
  type: 'Secp256r1' | 'Ed25519'
  keyId?: Uint8Array      // For Secp256r1 (passkey)
  publicKey: Uint8Array   // Public key bytes
  role: 'Admin' | 'Standard'
  policies?: xdr.ScVal[]  // Optional policies (as ScVal objects)
}

interface WalletDeploymentParams {
  // User info
  userId: string
  email: string

  // Signers to initialize with
  signers: SignerConfig[]

  // Optional: Recovery signer
  recoverySigner?: {
    type: 'Ed25519'
    publicKey: Uint8Array
  }

  // Optional: Plugins (pre-deployed plugin addresses)
  // NOTE: Identity is now handled via Soulbound NFT (separate contract), not plugins
  plugins?: Address[]

  // Optional: Salt (for deterministic address)
  salt?: Uint8Array
}

interface WalletDeploymentResult {
  success: boolean
  walletAddress?: string
  contractId?: string
  transactionHash?: string
  error?: string
  // NOTE: Identity is now handled via Soulbound NFT (separate contract)
  // NFT minting happens client-side after wallet deployment
}

/**
 * Wallet Deployment Service
 *
 * Handles server-side deployment of Stellar Smart Accounts
 * Based on Contract Factory pattern from test.rs
 */
export class WalletDeploymentService {
  private server: SorobanRpcServer
  private networkPassphrase: string
  private factoryAddress: Address
  private deployerKeypair: Keypair
  private factoryContract: Contract
  private sorobanRpcUrl: string
  private wasmHash: string

  constructor(config: {
    sorobanRpcUrl?: string  // Soroban RPC URL (preferred)
    horizonUrl?: string     // Legacy Horizon URL (fallback)
    networkPassphrase: string
    factoryAddress: string
    deployerSecretKey?: string  // Optional: if not provided, use deployerKeypair
    deployerKeypair?: Keypair   // Optional: can pass keypair directly (from AWS Secrets Manager)
    wasmHash: string        // Smart account WASM hash (already installed on network)
    // NOTE: Identity is now handled via Soulbound NFT (separate contract)
    // identityPluginWasmHash removed - no longer needed
  }) {
    // Use Soroban RPC Server (matches tested script)
    this.sorobanRpcUrl = config.sorobanRpcUrl ||
      (config.horizonUrl?.includes('horizon')
        ? config.horizonUrl.replace('horizon', 'soroban').replace('horizon-testnet', 'soroban-testnet')
        : 'https://soroban-testnet.stellar.org')

    this.server = new SorobanRpcServer(this.sorobanRpcUrl)
    this.networkPassphrase = config.networkPassphrase

    // Debug: Log factory address before parsing
    console.log('[WalletDeploymentService] Factory address from config:', config.factoryAddress)
    console.log('[WalletDeploymentService] Factory address length:', config.factoryAddress?.length)
    try {
      this.factoryAddress = Address.fromString(config.factoryAddress)
      console.log('[WalletDeploymentService] Factory address parsed successfully')
    } catch (e: any) {
      console.error('[WalletDeploymentService] Failed to parse factory address:', e.message)
      throw e
    }

    // Support both keypair and secret key (for AWS Secrets Manager integration)
    if (config.deployerKeypair) {
      this.deployerKeypair = config.deployerKeypair
    } else if (config.deployerSecretKey) {
      this.deployerKeypair = Keypair.fromSecret(config.deployerSecretKey)
    } else {
      throw new Error('Either deployerKeypair or deployerSecretKey must be provided')
    }

    this.factoryContract = new Contract(config.factoryAddress)
    this.wasmHash = config.wasmHash
  }

  /**
   * Compute contract address locally without RPC call.
   * Uses the same formula as Soroban's deploy_with_address.
   *
   * The contract ID is computed using XDR HashIdPreimage serialization.
   */
  private computeContractAddressLocally(salt: Buffer): string {
    // Build the preimage using XDR types for correctness
    // HashIdPreimage::ContractId has:
    // - networkId (sha256 of network passphrase)
    // - ContractIdPreimage::FromAddress { address, salt }
    const networkId = hash(Buffer.from(this.networkPassphrase))

    // Factory address as ScAddress (contract type)
    const factoryScAddress = xdr.ScAddress.scAddressTypeContract(
      StrKey.decodeContract(this.factoryAddress.toString()) as any
    )

    // Build ContractIdPreimage::FromAddress
    const contractIdPreimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: factoryScAddress,
        salt: salt as any, // Must be exactly 32 bytes
      })
    )

    // Build HashIdPreimage::ContractId
    const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: networkId as any,
        contractIdPreimage: contractIdPreimage,
      })
    )

    // Hash the XDR-encoded preimage to get contract ID
    const preimageXdr = hashIdPreimage.toXDR()
    const contractId = hash(preimageXdr)

    return StrKey.encodeContract(contractId)
  }

  /**
   * Get predicted deployed address (before deployment)
   * Uses Soroban RPC read-only call
   */
  async getDeployedAddress(salt: Uint8Array): Promise<Address> {
    try {
      console.log('[WalletDeployment] Getting predicted address for salt:', Buffer.from(salt).toString('hex').substring(0, 16) + '...')

      // Build read-only call to factory.get_deployed_address
      const account = await this.server.getAccount(this.deployerKeypair.publicKey())

      const saltBytes = Buffer.from(salt)

      const operation = Operation.invokeContractFunction({
        contract: this.factoryAddress.toString(),
        function: 'get_deployed_address',
        args: [
          xdr.ScVal.scvBytes(saltBytes)
        ]
      })

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: this.networkPassphrase
      })
        .addOperation(operation)
        .setTimeout(300)
        .build()

      console.log('[WalletDeployment] Simulating get_deployed_address call...')
      const simulated = await this.server.simulateTransaction(tx)

      console.log('[WalletDeployment] Simulation result:', JSON.stringify(simulated, null, 2))

      if (SorobanRpcApi.isSimulationSuccess(simulated)) {
        console.log('[WalletDeployment] Simulation successful')

        if (simulated.result) {
          console.log('[WalletDeployment] Has result field')

          // Try to parse the result as an address
          try {
            // The result is in simulated.result.retval as an ScVal
            const returnValue = simulated.result.retval
            console.log('[WalletDeployment] Return value:', JSON.stringify(returnValue, null, 2))

            // Parse ScVal to Address
            // The return value should be an ScVal containing an Address
            if (returnValue) {
              // Check if it's an address type
              if (returnValue.address) {
                // It's already an address ScVal
                const address = Address.fromScAddress(returnValue.address())
                console.log('[WalletDeployment] Predicted address:', address.toString())
                return address
              } else if (returnValue.bytes) {
                // It might be returned as bytes (contract ID)
                // Convert bytes to Address
                const contractIdBytes = Buffer.from(returnValue.bytes())
                if (contractIdBytes.length === 32) {
                  // This is a contract ID, create Address from it
                  const address = Address.fromString(
                    StrKey.encodeContract(contractIdBytes)
                  )
                  console.log('[WalletDeployment] Predicted address from bytes:', address.toString())
                  return address
                }
              } else {
                // Try to parse as ScVal and extract address
                const scVal = returnValue as any
                if (scVal.address) {
                  const address = Address.fromScAddress(scVal.address())
                  console.log('[WalletDeployment] Predicted address from ScVal:', address.toString())
                  return address
                }
              }
            }
          } catch (parseError: any) {
            console.error('[WalletDeployment] Error parsing return value:', parseError.message)
            console.error('[WalletDeployment] Parse error stack:', parseError.stack)
            throw new Error(`Failed to parse address from simulation result: ${parseError.message}`)
          }
        }

        console.error('[WalletDeployment] No return value from simulation')
        console.error('[WalletDeployment] Simulated result:', JSON.stringify(simulated, null, 2))
        throw new Error('No return value from get_deployed_address')
      } else {
        console.error('[WalletDeployment] Simulation failed')
        console.error('[WalletDeployment] Error:', (simulated as any).error)

        // Check if this is a MissingValue error (contract not deployed yet)
        const errorString = JSON.stringify(simulated) || '';
        const errorObj = simulated as any;
        const errorMessage = errorObj.error?.toString() || errorString;

        if (errorMessage.includes('MissingValue') ||
            errorMessage.includes('non-existing value') ||
            errorMessage.includes('contract instance')) {
          // This is expected for undeployed contracts - throw a specific error that can be caught
          const missingValueError = new Error('Contract not deployed yet (MissingValue)');
          (missingValueError as any).isMissingValue = true;
          throw missingValueError;
        }

        throw new Error('Simulation failed for get_deployed_address')
      }
    } catch (error: any) {
      console.error('[WalletDeployment] Error getting predicted address:', error.message)
      console.error('[WalletDeployment] Stack:', error.stack)
      throw error
    }
  }

  /**
   * Deploy a new smart account wallet
   *
   * Based on tested deployment script (scripts/deploy-smart-account.ts)
   * Uses deploy_idempotent with WASM hash (not upload_and_deploy with WASM bytes)
   */
  async deployWallet(params: WalletDeploymentParams): Promise<WalletDeploymentResult> {
    try {
      console.log(`[WalletDeployment] Starting deployment for user ${params.userId}`)

      const deployerAddress = this.deployerKeypair.publicKey()

      // Step 1: Generate salt (random or from passkey)
      const salt = params.salt || this.generateSaltFromPasskey(params.signers)
      const saltBytes = Buffer.from(salt)

      console.log(`[WalletDeployment] Using salt: ${saltBytes.toString('hex').substring(0, 16)}...`)

      // NOTE: Identity is now handled via Soulbound NFT (separate contract)
      // - No plugin deployment needed during wallet creation
      // - NFT minting happens client-side after wallet deployment
      // - This eliminates per-transaction plugin footprint overhead (~1-2M instructions)

      // Step 2: Build constructor args (signers + recovery signer + optional plugins)
      const allSigners = [...params.signers]

      // Add recovery signer as Admin Ed25519 if provided
      if (params.recoverySigner) {
        allSigners.push({
          type: 'Ed25519',
          publicKey: params.recoverySigner.publicKey,
          role: 'Admin',
        })
      }

      const constructorArgsScVal = this.buildConstructorArgs(
        allSigners,
        params.plugins && params.plugins.length > 0 ? params.plugins : undefined
      )

      // Step 4: Build deployment args (matches tested script)
      const wasmHashBytes = Buffer.from(this.wasmHash, 'hex')

      const deploymentArgsScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('constructor_args'),
          val: constructorArgsScVal
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('salt'),
          val: xdr.ScVal.scvBytes(saltBytes)
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('wasm_hash'),
          val: xdr.ScVal.scvBytes(wasmHashBytes)
        })
      ])

      // Step 5: Build caller address ScVal
      const callerScVal = Address.fromString(deployerAddress).toScVal()

      // Step 6: Build transaction (matches tested script)
      const account = await this.server.getAccount(deployerAddress)

      const operation = Operation.invokeContractFunction({
        contract: this.factoryAddress.toString(),
        function: 'deploy_idempotent',
        args: [
          callerScVal,
          deploymentArgsScVal
        ]
      })

      let tx = new TransactionBuilder(account, {
        fee: '10000000',
        networkPassphrase: this.networkPassphrase
      })
        .addOperation(operation)
        .setTimeout(300)
        .build()

      // Step 7: Simulate transaction
      console.log(`[WalletDeployment] Simulating deployment...`)
      const simulated = await this.server.simulateTransaction(tx)

      if (!SorobanRpcApi.isSimulationSuccess(simulated)) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulated)}`)
      }

      // Step 8: Assemble and sign transaction
      tx = assembleTransaction(tx, simulated).build()
      tx.sign(this.deployerKeypair)

      // Step 9: Submit transaction
      console.log(`[WalletDeployment] Submitting transaction...`)
      const response = await this.server.sendTransaction(tx)
      console.log(`[WalletDeployment] Transaction hash: ${response.hash}`)

      // Step 10: Wait for confirmation
      console.log(`[WalletDeployment] Waiting for confirmation...`)
      let attempts = 0
      let status: any = await this.server.getTransaction(response.hash)

      while ((status.status === 'NOT_FOUND' || status.status === 'PENDING') && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        status = await this.server.getTransaction(response.hash)
        attempts++
      }

      if (status.status !== 'SUCCESS' || !status.returnValue) {
        throw new Error(`Transaction failed: ${status.status}`)
      }

      // Step 11: Parse contract address from result (matches tested script)
      const contractId = StrKey.encodeContract(
        Buffer.from(status.returnValue.address().contractId())
      )

      console.log(`[WalletDeployment] Successfully deployed wallet: ${contractId}`)
      console.log(`[WalletDeployment] NOTE: Soulbound Identity NFT should be minted client-side after this`)

      return {
        success: true,
        walletAddress: contractId,
        contractId: contractId,
        transactionHash: response.hash,
      }

    } catch (error) {
      console.error('[WalletDeployment] Error deploying wallet:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // NOTE: deployIdentityPlugin method removed
  // Identity is now handled via Soulbound NFT contract (CANRYECWAOA4CRWL3JUUHPQFD62WRISB7Y5GA2GPQL2NFEWZ3MXK5UMI)
  // See lib/soulbound-identity/mint-service.ts for NFT minting after wallet deployment

  /**
   * Build constructor args for smart account
   *
   * Matches tested script pattern:
   * constructor_args: Vec<Val> = [Vec<Signer>, Vec<Address>]
   */
  private buildConstructorArgs(signers: SignerConfig[], plugins?: Address[]): xdr.ScVal {
    // Build signers vector
    const signersVec: xdr.ScVal[] = signers.map(signer => {
      return this.buildSignerScVal(signer)
    })

    // Build plugins vector (Vec<Address>)
    const pluginsVec: xdr.ScVal[] = (plugins || []).map(plugin => {
      return plugin.toScVal()
    })

    // Build constructor_args: Vec<Val> = [Vec<Signer>, Vec<Address>]
    return xdr.ScVal.scvVec([
      xdr.ScVal.scvVec(signersVec),
      xdr.ScVal.scvVec(pluginsVec)
    ])
  }

  /**
   * Build ScVal for a signer configuration
   *
   * Matches tested script pattern for Secp256r1 signer
   */
  private buildSignerScVal(signer: SignerConfig): xdr.ScVal {
    if (signer.type === 'Secp256r1') {
      // Build Secp256r1Signer struct as a map (matches tested script)
      const keyIdBytes = Buffer.from(signer.keyId || new Uint8Array())
      const publicKeyBytes = Buffer.from(signer.publicKey)

      const secp256r1SignerScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('key_id'),
          val: xdr.ScVal.scvBytes(keyIdBytes)
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('public_key'),
          val: xdr.ScVal.scvBytes(publicKeyBytes)
        })
      ])

      // Build SignerRole enum
      // Admin = just [Admin]
      // Standard = [Standard, Vec<SignerPolicy>] (policies can be empty)
      let roleScVal: xdr.ScVal
      if (signer.role === 'Admin') {
        roleScVal = xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('Admin')
        ])
      } else {
        // Standard role requires policies vec (can be empty)
        const policiesVec = xdr.ScVal.scvVec(
          (signer.policies || []).map(p => p) // Empty for now
        )
        roleScVal = xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('Standard'),
          policiesVec
        ])
      }

      // Build Signer::Secp256r1 enum (vec with variant name, then tuple data)
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Secp256r1'),
        secp256r1SignerScVal,
        roleScVal
      ])
    } else if (signer.type === 'Ed25519') {
      // Build Ed25519Signer struct: { public_key: BytesN<32> }
      // This MUST be a map with public_key field, not raw bytes!
      const publicKeyBytes = Buffer.from(signer.publicKey)

      const ed25519SignerScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('public_key'),
          val: xdr.ScVal.scvBytes(publicKeyBytes)
        })
      ])

      // Build SignerRole enum
      // Admin = just [Admin]
      // Standard = [Standard, Vec<SignerPolicy>] (policies can be empty)
      let roleScVal: xdr.ScVal
      if (signer.role === 'Admin') {
        roleScVal = xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('Admin')
        ])
      } else {
        // Standard role requires policies vec (can be empty)
        // Policies are already ScVal objects from SignerConfig
        const policiesVec = xdr.ScVal.scvVec(
          (signer.policies || []).map(p => p as xdr.ScVal) // Policies are already ScVal
        )
        roleScVal = xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('Standard'),
          policiesVec
        ])
      }

      // Build Signer::Ed25519 enum
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Ed25519'),
        ed25519SignerScVal,
        roleScVal
      ])
    } else {
      throw new Error(`Unsupported signer type: ${signer.type}`)
    }
  }

  /**
   * Generate salt from passkey public key (deterministic C-address mapping)
   *
   * Benefits:
   * - Same passkey = same wallet address (always)
   * - Deterministic wallet address
   * - Can identify which passkey created which wallet
   * - Passkey public key -> C-address mapping
   *
   * Note: Recovery scenarios won't match (uses Ed25519 recovery key, not passkey)
   * But that's fine - recovery updates existing wallet, doesn't create new one
   */
  private generateSaltFromPasskey(signers: SignerConfig[]): Uint8Array {
    // Find Admin passkey signer (Secp256r1)
    const passkeySigner = signers.find(
      s => s.type === 'Secp256r1' && s.role === 'Admin'
    )

    if (passkeySigner && passkeySigner.publicKey) {
      // Salt = SHA256(passkeyPublicKey)
      // This ensures same passkey always produces same C-address
      // NOTE: publicKey should already be raw 65-byte format (extracted from SPKI in deploy route)
      const crypto = require('crypto')
      console.log('[WalletDeployment] Generating salt from passkey public key, length:', passkeySigner.publicKey.length)
      const hash = crypto.createHash('sha256').update(passkeySigner.publicKey).digest()
      return new Uint8Array(hash)
    }

    // Fallback: Generate random salt (matches tested script)
    // This is used if no passkey signer found or if random salt is preferred
    return new Uint8Array(
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
    )
  }

  // Removed placeholder methods - deployment is handled directly in deployWallet()
  // which matches the tested script pattern
}
