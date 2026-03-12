'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface FundWalletStepProps {
  ghostAddress: string;
  walletAddress: string;
  sessionToken: string;
  onComplete: () => void;
}

export function FundWalletStep({ ghostAddress, walletAddress, sessionToken, onComplete }: FundWalletStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCoinbaseOnramp = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/coinbase/session-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ address: ghostAddress }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start Coinbase Onramp');
      }

      const data = await res.json();
      window.open(data.url, '_blank');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-2">Option 1: Buy with Coinbase</h3>
          <Button
            onClick={handleCoinbaseOnramp}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {loading ? 'Opening Coinbase...' : 'Buy USDC with Coinbase'}
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-700" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-gray-900 px-2 text-gray-500">OR</span>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-2">Option 2: Direct Deposit</h3>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-2">Send XLM or USDC to your relay address:</p>
            <code className="text-sm text-green-400 break-all select-all">{ghostAddress}</code>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

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
          I&apos;ve funded my wallet
        </Button>
      </div>
    </div>
  );
}
