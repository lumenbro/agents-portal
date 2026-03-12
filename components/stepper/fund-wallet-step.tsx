'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getExplorerNetwork } from '@/lib/network-config';

interface FundWalletStepProps {
  walletAddress: string;
  sessionToken: string;
  onComplete: () => void;
}

export function FundWalletStep({ walletAddress, sessionToken, onComplete }: FundWalletStepProps) {
  const [copied, setCopied] = useState(false);
  const explorerNet = getExplorerNetwork();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-5">
        <p className="text-sm text-gray-300 mb-3">
          Send USDC (Stellar) to your smart wallet:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm text-green-400 break-all select-all bg-gray-900 rounded px-3 py-2">
            {walletAddress}
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <a
          href={`https://stellar.expert/explorer/${explorerNet}/contract/${walletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:underline mt-2 inline-block"
        >
          View on Stellar Expert
        </a>
      </div>

      <div className="bg-gray-800/50 rounded-lg p-4 text-sm text-gray-400 space-y-2">
        <p>Your smart wallet accepts:</p>
        <ul className="list-disc list-inside space-y-1 text-gray-500">
          <li>USDC (Stellar) — used for x402 compute payments</li>
          <li>LumenJoule (LJOULE) — 12% discount vs USDC</li>
          <li>XLM — for gas (agent direct transfers only)</li>
        </ul>
        <p className="text-xs text-gray-600 mt-2">
          Coinbase on-ramp coming soon. For now, send from any Stellar wallet or exchange.
        </p>
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
          I've funded my wallet
        </Button>
      </div>
    </div>
  );
}
