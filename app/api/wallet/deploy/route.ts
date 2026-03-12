import { NextRequest } from 'next/server';
import { WalletDeploymentService } from '@/lib/wallet-deployment-service';
import { getDeployerKeypair } from '@/lib/get-deployer-keypair';
import { xdr, Address } from '@stellar/stellar-sdk';
import { createErrorResponse, createSuccessResponse, ERROR_CODES } from '@/lib/api-error';
import { validateRequest, walletDeploySchema } from '@/lib/api-validation';
import { getServerRpcUrl, getNetworkPassphrase, isMainnet } from '@/lib/network-config';
import { getSupabaseAdmin } from '@/lib/supabase';

function base64UrlToBase64(base64url: string): string {
  return base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
}

function extractRawP256PublicKey(publicKeyBytes: Buffer): Buffer {
  if (publicKeyBytes.length === 65) return publicKeyBytes;
  if (publicKeyBytes.length === 91) return Buffer.from(publicKeyBytes.subarray(26));
  return publicKeyBytes;
}

let deploymentService: WalletDeploymentService | null = null;

async function getDeploymentService(): Promise<WalletDeploymentService> {
  if (!deploymentService) {
    const deployerKeypair = await getDeployerKeypair();
    deploymentService = new WalletDeploymentService({
      sorobanRpcUrl: getServerRpcUrl(),
      networkPassphrase: getNetworkPassphrase(),
      factoryAddress: process.env.SMART_ACCOUNT_FACTORY_ADDRESS!,
      deployerKeypair,
      wasmHash: process.env.SMART_ACCOUNT_WASM_HASH || '8cced6471a6f5db317d9d1e94cc8ddc43e2d6324b118c70c1555c7d990ae5499',
    });
  }
  return deploymentService;
}

export async function POST(request: NextRequest) {
  try {
    const validation = await validateRequest(request, walletDeploySchema);
    if (validation.error) return validation.error;

    const { userId, signers, recoverySigner, salt } = validation.data;

    const service = await getDeploymentService();

    // Convert signers to deployment format
    const deploySigners = signers.map((s: any) => {
      const publicKeyBase64 = base64UrlToBase64(s.publicKey);
      const publicKeyBytes = Buffer.from(publicKeyBase64, 'base64');

      if (s.type === 'Secp256r1') {
        const rawKey = extractRawP256PublicKey(publicKeyBytes);
        return {
          type: 'Secp256r1' as const,
          keyId: s.keyId ? new Uint8Array(Buffer.from(base64UrlToBase64(s.keyId), 'base64')) : new Uint8Array(),
          publicKey: new Uint8Array(rawKey),
          role: s.role as 'Admin' | 'Standard',
        };
      }
      return {
        type: 'Ed25519' as const,
        publicKey: new Uint8Array(publicKeyBytes),
        role: s.role as 'Admin' | 'Standard',
      };
    });

    const result = await service.deployWallet({
      userId,
      email: '',
      signers: deploySigners,
      salt: salt ? new Uint8Array(Buffer.from(salt, 'base64')) : undefined,
    });

    if (!result.success) {
      return createErrorResponse(ERROR_CODES.WALLET_DEPLOYMENT_FAILED, result.error || 'Deployment failed', 500);
    }

    // Store in Supabase
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('wallets').upsert({
        wallet_address: result.walletAddress,
        network: isMainnet() ? 'mainnet' : 'testnet',
        created_at: new Date().toISOString(),
      }, { onConflict: 'wallet_address' });
    } catch (dbError) {
      console.warn('[WalletDeploy] DB storage failed (non-critical):', dbError);
    }

    return createSuccessResponse({
      walletAddress: result.walletAddress,
      contractId: result.contractId,
      transactionHash: result.transactionHash,
    });
  } catch (error: any) {
    console.error('[WalletDeploy] Error:', error);
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, error.message, 500);
  }
}
