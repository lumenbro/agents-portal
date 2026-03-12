'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getDeployedAgentTiers } from '@/lib/network-config';

interface AddAgentStepProps {
  walletAddress: string;
  ghostAddress: string;
  sessionToken: string;
  onComplete: (data: any) => void;
}

export function AddAgentStep({ walletAddress, ghostAddress, sessionToken, onComplete }: AddAgentStepProps) {
  const tiers = getDeployedAgentTiers();
  const [agentName, setAgentName] = useState('');
  const [policyTier, setPolicyTier] = useState(tiers[0]?.tierId || 'low');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      setError('Please enter an agent name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 0. Re-derive ghost keypair from stored passkey info
      setStatus('Preparing credentials...');
      const stored = localStorage.getItem('agents_passkey');
      if (!stored) throw new Error('Passkey info not found. Please restart the setup.');
      const { credentialId, publicKey: passkeyPublicKey } = JSON.parse(stored);

      const { deriveGhostKeypairSecure } = await import('@/lib/ghost-address-derivation');
      const ghostKeypair = await deriveGhostKeypairSecure(passkeyPublicKey);

      // 1. Create agent in DB
      setStatus('Generating agent keypair...');
      const selectedTier = tiers.find(t => t.tierId === policyTier);
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          name: agentName,
          policyTier,
          policyAddress: selectedTier?.address,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.error || 'Failed to create agent');
      }

      const agentJson = await res.json();
      const agent = agentJson.data?.agent || agentJson.agent;
      const secretKey = agentJson.data?.secretKey || agentJson.secretKey;

      // 2. Build add_signer transaction (ghost as TX source for paymaster fee-bump)
      setStatus('Building add_signer transaction...');
      const addSignerRes = await fetch('/api/signer/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          walletAddress,
          signerPublicKey: agent.signer_public_key,
          role: 'Standard',
          policyAddress: agent.policy_address || selectedTier?.address,
          sourceAddress: ghostAddress,
        }),
      });

      if (!addSignerRes.ok) {
        const err = await addSignerRes.json();
        throw new Error(err.error?.message || err.error || 'Failed to build add_signer transaction');
      }

      const signerJson = await addSignerRes.json();
      const signerResult = signerJson.data || signerJson;
      const { assembledTxXdr, authEntryXdr, latestLedger, networkPassphrase } = signerResult;

      // 3. Sign auth entry with passkey (secp256r1 biometric prompt)
      setStatus('Approve with passkey (biometric prompt)...');
      const { signWithPasskey } = await import('@/lib/passkey/crossmint-webauthn');
      const signedAuthEntryXdr = await signWithPasskey(
        authEntryXdr,
        credentialId,
        networkPassphrase,
        parseInt(latestLedger),
      );

      // 4. Finalize TX (inject signed auth entry + optimize footprint)
      setStatus('Finalizing transaction...');
      const finalizeRes = await fetch('/api/signer/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assembledTxXdr,
          signedAuthEntryXdr,
          networkPassphrase,
          passkeyCredentialId: credentialId,
          walletAddress,
        }),
      });

      if (!finalizeRes.ok) {
        const err = await finalizeRes.json();
        throw new Error(err.error?.message || err.error || 'Failed to finalize transaction');
      }

      const finalizeJson = await finalizeRes.json();
      const innerXdr = finalizeJson.data?.innerXdr || finalizeJson.innerXdr;

      // 5. Sign inner TX with ghost keypair (source account signature)
      setStatus('Signing transaction...');
      const { Transaction } = await import('@stellar/stellar-sdk');
      const innerTx = new Transaction(innerXdr, networkPassphrase);
      innerTx.sign(ghostKeypair);
      const signedInnerXdr = innerTx.toXDR();

      // 6. Get paymaster challenge + sign with ghost
      setStatus('Submitting to network...');
      const challengeRes = await fetch('/api/paymaster/challenge');
      const challengeJson = await challengeRes.json();
      const challenge = challengeJson.data?.challenge || challengeJson.challenge;

      const challengeBytes = Buffer.from(challenge, 'hex');
      const ghostSig = ghostKeypair.sign(challengeBytes).toString('base64');

      // 7. Submit via paymaster (fee-bump + on-chain submission)
      const submitRes = await fetch('/api/paymaster/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghostAddress,
          challenge,
          signature: ghostSig,
          innerXdr: signedInnerXdr,
        }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.json();
        throw new Error(err.error?.message || err.error || 'Failed to submit transaction');
      }

      const submitJson = await submitRes.json();
      const submitResult = submitJson.data || submitJson;

      onComplete({
        agent,
        secretKey,
        agentName,
        policyTier,
        txHash: submitResult.hash,
        ledger: submitResult.ledger,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Agent Name
        </label>
        <Input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="e.g., compute-bot-1"
          className="bg-gray-800 border-gray-700 text-white"
          disabled={loading}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Spend Policy
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tiers.map((tier) => (
            <button
              key={tier.tierId}
              onClick={() => setPolicyTier(tier.tierId)}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                policyTier === tier.tierId
                  ? 'border-blue-500 bg-blue-900/30 text-blue-400'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
              }`}
              disabled={loading}
            >
              <div>{tier.label}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          On-chain daily spending limit enforced by ExternalValidatorPolicy.
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {status && (
        <div className="bg-blue-900/30 border border-blue-800 rounded-lg p-3 text-sm text-blue-400">
          {status}
        </div>
      )}

      <Button
        onClick={handleCreateAgent}
        disabled={loading || !agentName.trim()}
        className="w-full bg-blue-600 hover:bg-blue-700"
      >
        {loading ? 'Creating agent...' : 'Create Agent'}
      </Button>
    </div>
  );
}
