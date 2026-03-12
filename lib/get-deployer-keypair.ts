import { Keypair } from '@stellar/stellar-sdk';

export async function getDeployerKeypair(): Promise<Keypair> {
  if (typeof window !== 'undefined') {
    throw new Error('Cannot access secrets client-side');
  }

  if (process.env.WALLET_DEPLOYER_SECRET_KEY) {
    const secretKey = process.env.WALLET_DEPLOYER_SECRET_KEY.trim();
    return Keypair.fromSecret(secretKey);
  }

  throw new Error('Deployer secret key not found. Set WALLET_DEPLOYER_SECRET_KEY env var.');
}
