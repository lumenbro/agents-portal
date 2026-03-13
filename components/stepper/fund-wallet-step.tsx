'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Horizon,
} from '@stellar/stellar-sdk';
import { getExplorerNetwork, getNetworkConfig } from '@/lib/network-config';

interface FundWalletStepProps {
  walletAddress: string;
  sessionToken: string;
  onComplete: () => void;
}

type SetupPhase =
  | 'idle'           // Initial — no PRF address yet
  | 'prompting'      // Waiting for passkey/Face ID
  | 'activating'     // Creating account on-chain
  | 'trustline'      // Adding USDC trustline
  | 'ready'          // Deposit address active + USDC trustline
  | 'error';

export function FundWalletStep({ walletAddress, sessionToken, onComplete }: FundWalletStepProps) {
  const [copied, setCopied] = useState(false);
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [relayAddress, setRelayAddress] = useState<string | null>(null);
  const [coinbaseLoading, setCoinbaseLoading] = useState(false);
  const [coinbaseUrl, setCoinbaseUrl] = useState<string | null>(null);
  const [coinbaseError, setCoinbaseError] = useState<string | null>(null);
  const [fundingDetected, setFundingDetected] = useState(false);
  const [detectedBalance, setDetectedBalance] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const explorerNet = getExplorerNetwork();

  // Restore cached relay address on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem('agents_relay_address');
      if (cached) {
        setRelayAddress(cached);
        setSetupPhase('ready');
      }
    } catch { /* ignore */ }
  }, []);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Poll relay address for incoming funds via Horizon
  const startPolling = useCallback((address: string) => {
    if (pollingRef.current) return;
    const config = getNetworkConfig();
    const horizonUrl = config.network === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${horizonUrl}/accounts/${address}`);
        if (!res.ok) return;
        const data = await res.json();
        const usdcBalance = data.balances?.find(
          (b: any) =>
            b.asset_type === 'credit_alphanum4' &&
            b.asset_code === 'USDC' &&
            parseFloat(b.balance) > 0
        );
        const xlmBalance = data.balances?.find(
          (b: any) => b.asset_type === 'native' && parseFloat(b.balance) > 2.5
        );
        if (usdcBalance) {
          setFundingDetected(true);
          setDetectedBalance(`${usdcBalance.balance} USDC`);
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
        } else if (xlmBalance) {
          setFundingDetected(true);
          setDetectedBalance(`${xlmBalance.balance} XLM`);
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } catch { /* ignore polling errors */ }
    }, 10_000);

    // Stop polling after 5 minutes
    setTimeout(() => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 5 * 60 * 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  /**
   * Full PRF relay setup flow:
   * 1. Passkey prompt with PRF extension → derive ed25519 keypair → G-address
   * 2. Activate account via paymaster (server creates with 2 XLM)
   * 3. Add USDC trustline (client builds TX, signs with PRF key, submits)
   */
  const handleSetupDeposit = async () => {
    setSetupPhase('prompting');
    setSetupError(null);

    try {
      // Get passkey credential ID from localStorage
      const passkeyData = localStorage.getItem('agents_passkey');
      if (!passkeyData) {
        throw new Error('No passkey found. Please go back and create a wallet first.');
      }
      const { credentialId } = JSON.parse(passkeyData);
      if (!credentialId) {
        throw new Error('Invalid passkey data. Missing credential ID.');
      }

      // Step 1: Passkey PRF prompt → derive relay keypair
      const { deriveRelayWithPasskey, supportsPrf } = await import('@/lib/passkey/prf-relay');

      const prfSupported = await supportsPrf();
      if (!prfSupported) {
        throw new Error(
          'Your browser does not support PRF (passkey-derived addresses). ' +
          'Try Chrome 132+ or Safari 18+ on a device with biometrics.'
        );
      }

      const { address, keypair } = await deriveRelayWithPasskey(credentialId);

      setRelayAddress(address);
      setSetupPhase('activating');

      // Step 2: Activate account via paymaster
      const activateRes = await fetch('/api/relay/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ address }),
      });

      if (!activateRes.ok) {
        const err = await activateRes.json().catch(() => ({ error: 'Activation failed' }));
        throw new Error(err.error || `HTTP ${activateRes.status}`);
      }

      // Step 3: Add USDC trustline (client-side, non-custodial)
      setSetupPhase('trustline');

      const config = getNetworkConfig();
      const horizonUrl = config.network === 'mainnet'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org';
      const horizonServer = new Horizon.Server(horizonUrl);

      // Check if trustline already exists
      let needsTrustline = true;
      try {
        const accountData = await horizonServer.loadAccount(address);
        const hasUsdc = accountData.balances.some(
          (b: any) => b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC'
        );
        if (hasUsdc) needsTrustline = false;
      } catch { /* account just created, load should work */ }

      if (needsTrustline) {
        // Resolve USDC issuer from network config SAC address
        // For Stellar classic trustlines, we need the issuer G-address
        // USDC on Stellar mainnet: Centre/Circle issuer
        const usdcIssuer = config.network === 'mainnet'
          ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
          : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

        const usdcAsset = new Asset('USDC', usdcIssuer);
        const relayAccount = await horizonServer.loadAccount(address);

        const trustlineTx = new TransactionBuilder(relayAccount, {
          fee: BASE_FEE,
          networkPassphrase: config.networkPassphrase,
        })
          .addOperation(Operation.changeTrust({ asset: usdcAsset }))
          .setTimeout(30)
          .build();

        trustlineTx.sign(keypair);
        await horizonServer.submitTransaction(trustlineTx);
      }

      // Done! Cache relay address
      localStorage.setItem('agents_relay_address', address);
      setSetupPhase('ready');

    } catch (err: any) {
      console.error('[FundWallet] Setup error:', err);
      setSetupError(err.message || 'Failed to set up deposit address');
      setSetupPhase('error');
    }
  };

  const handleBuyCrypto = async () => {
    if (!relayAddress) return;

    setCoinbaseLoading(true);
    setCoinbaseError(null);
    setCoinbaseUrl(null);

    try {
      const res = await fetch('/api/coinbase/session-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ address: relayAddress }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to get session' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.url) throw new Error('No onramp URL returned');

      // Start polling for incoming funds
      startPolling(relayAddress);

      // Try opening in new tab — handle iOS popup blocker
      const win = window.open(data.url, '_blank');
      if (!win) {
        setCoinbaseUrl(data.url);
      }
    } catch (err: any) {
      setCoinbaseError(err.message || 'Failed to open Coinbase');
    } finally {
      setCoinbaseLoading(false);
    }
  };

  const phaseMessage: Record<SetupPhase, string> = {
    idle: '',
    prompting: 'Authenticate with your passkey...',
    activating: 'Activating deposit address on-chain...',
    trustline: 'Adding USDC support...',
    ready: '',
    error: '',
  };

  return (
    <div className="space-y-6">
      {/* Deposit address setup or Coinbase onramp */}
      {setupPhase === 'idle' ? (
        <div className="bg-gray-800 rounded-lg p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-white mb-1">Set up your deposit address</p>
            <p className="text-xs text-gray-400">
              Derive a personal deposit address from your passkey. This address receives funds
              from Coinbase or external wallets, which can then be swept to your smart wallet vault.
            </p>
          </div>
          <Button
            onClick={handleSetupDeposit}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            Set up deposit address
          </Button>
          <p className="text-[10px] text-gray-600 text-center">
            Requires Face ID / biometric authentication
          </p>
        </div>
      ) : setupPhase === 'ready' && relayAddress ? (
        <div className="bg-gray-800 rounded-lg p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-white mb-1">Buy with card or bank transfer</p>
            <p className="text-xs text-gray-400">
              Purchase USDC or XLM directly with Coinbase. Funds arrive in your deposit address
              and can be swept to your smart wallet.
            </p>
          </div>

          {fundingDetected ? (
            <div className="bg-green-900/30 border border-green-700/50 rounded-lg p-4">
              <p className="text-sm font-medium text-green-400">Funds detected: {detectedBalance}</p>
              <p className="text-xs text-gray-400 mt-1">
                Your deposit address has been funded. Continue to set up your agent SDK.
              </p>
            </div>
          ) : (
            <>
              <Button
                onClick={handleBuyCrypto}
                disabled={coinbaseLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {coinbaseLoading ? 'Opening Coinbase...' : 'Buy with Coinbase'}
              </Button>
              <p className="text-[10px] text-gray-600 text-center">Powered by Coinbase</p>
            </>
          )}

          {coinbaseUrl && (
            <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3">
              <p className="text-xs text-yellow-400 mb-2">
                Popup blocked — tap below to open Coinbase:
              </p>
              <a
                href={coinbaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Open Coinbase
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          )}

          {coinbaseError && (
            <p className="text-xs text-red-400">{coinbaseError}</p>
          )}
        </div>
      ) : setupPhase === 'error' ? (
        <div className="bg-gray-800 rounded-lg p-5 space-y-4">
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4">
            <p className="text-sm text-red-400">{setupError}</p>
          </div>
          <Button
            onClick={handleSetupDeposit}
            variant="outline"
            className="w-full border-gray-700 text-gray-300 hover:text-white"
          >
            Try again
          </Button>
        </div>
      ) : (
        /* Loading states: prompting, activating, trustline */
        <div className="bg-gray-800 rounded-lg p-5">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-300">{phaseMessage[setupPhase]}</p>
          </div>
        </div>
      )}

      {/* Manual deposit — always visible */}
      <div className="bg-gray-800/50 rounded-lg p-5 space-y-3">
        <p className="text-sm font-medium text-gray-300">Or send manually</p>

        {relayAddress && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Deposit address (G-address):</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-green-400 break-all select-all bg-gray-900 rounded px-3 py-2">
                {relayAddress}
              </code>
              <button
                onClick={() => handleCopy(relayAddress)}
                className="shrink-0 px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <a
              href={`https://stellar.expert/explorer/${explorerNet}/account/${relayAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline mt-1 inline-block"
            >
              View on Stellar Expert
            </a>
          </div>
        )}

        <div>
          <p className="text-xs text-gray-500 mb-1">Smart wallet (C-address):</p>
          <code className="block text-xs text-gray-500 break-all select-all bg-gray-900 rounded px-3 py-2">
            {walletAddress}
          </code>
          <a
            href={`https://stellar.expert/explorer/${explorerNet}/contract/${walletAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline mt-1 inline-block"
          >
            View on Stellar Expert
          </a>
        </div>

        <div className="text-xs text-gray-500 space-y-1 pt-1">
          <p>Accepted assets:</p>
          <ul className="list-disc list-inside text-gray-600">
            <li>USDC (Stellar) — x402 compute payments</li>
            <li>LumenJoule (LJOULE) — 12% discount vs USDC</li>
            <li>XLM — gas for agent direct transfers</li>
          </ul>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={onComplete}
          variant="outline"
          className="flex-1 border-gray-700 text-gray-400 hover:text-white"
        >
          Skip for now
        </Button>
        <Button
          onClick={onComplete}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          {fundingDetected ? 'Continue' : "I've funded my wallet"}
        </Button>
      </div>
    </div>
  );
}
