'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getDeployedAgentTiers } from '@/lib/network-config';

type SignerType = 'Ed25519' | 'Secp256r1';

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
  const [signerType, setSignerType] = useState<SignerType>('Ed25519');
  const [sePublicKey, setSePublicKey] = useState('');       // Hex or base64 from keypo-signer
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const keyLabel = agentName.trim()
    ? `agent-${agentName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
    : '';

  /**
   * Parse public key input — accepts hex (130 chars) or base64 (88 chars)
   */
  const parsePublicKeyInput = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    try {
      // Try hex first (65 bytes = 130 hex chars)
      if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 130) {
        const buf = Buffer.from(trimmed, 'hex');
        if (buf.length === 65 && buf[0] === 0x04) {
          return buf.toString('base64');
        }
      }
      // Try base64
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === 65 && buf[0] === 0x04) {
        return trimmed;
      }
    } catch { /* fall through */ }
    return null;
  };

  const handleCreateAgent = async () => {
    if (!agentName.trim()) {
      setError('Please enter an agent name');
      return;
    }

    if (signerType === 'Secp256r1') {
      const parsed = parsePublicKeyInput(sePublicKey);
      if (!parsed) {
        setError('Invalid P-256 public key. Paste the 65-byte uncompressed key (hex or base64) from keypo-signer.');
        return;
      }
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

      // 1. Generate keypair client-side (Ed25519) or use provided key (Secp256r1)
      let clientSecretKey: string | undefined;
      let clientPublicKey: string | undefined;

      const selectedTier = tiers.find(t => t.tierId === policyTier);

      if (signerType === 'Ed25519') {
        setStatus('Generating agent keypair...');
        const { Keypair } = await import('@stellar/stellar-sdk');
        const agentKeypair = Keypair.random();
        clientSecretKey = agentKeypair.secret();
        clientPublicKey = agentKeypair.publicKey(); // G-address
      } else {
        setStatus('Registering SE agent key...');
      }

      const agentBody: Record<string, any> = {
        name: agentName,
        policyTier,
        policyAddress: selectedTier?.address,
        signerType,
      };

      if (signerType === 'Ed25519' && clientPublicKey) {
        agentBody.publicKey = clientPublicKey;
      }

      if (signerType === 'Secp256r1') {
        agentBody.publicKeyBase64 = parsePublicKeyInput(sePublicKey);
        agentBody.keyLabel = keyLabel;
      }

      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(agentBody),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.error || 'Failed to create agent');
      }

      const agentJson = await res.json();
      const agent = agentJson.data?.agent || agentJson.agent;
      // Secret key comes from client-side generation, NOT server
      const secretKey = clientSecretKey;

      // 2. Build add_signer transaction (ghost as TX source for paymaster fee-bump)
      setStatus('Building add_signer transaction...');
      const addSignerBody: Record<string, any> = {
        walletAddress,
        signerPublicKey: agent.signer_public_key,
        signerType,
        role: 'Standard',
        policyAddress: agent.policy_address || selectedTier?.address,
        sourceAddress: ghostAddress,
      };

      if (signerType === 'Secp256r1' && agent.key_id) {
        addSignerBody.keyId = agent.key_id;
      }

      const addSignerRes = await fetch('/api/signer/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(addSignerBody),
      });

      if (!addSignerRes.ok) {
        const err = await addSignerRes.json();
        throw new Error(err.error?.message || err.error || 'Failed to build add_signer transaction');
      }

      const signerJson = await addSignerRes.json();
      const signerResult = signerJson.data || signerJson;
      const { assembledTxXdr, rawTxXdr, authEntryXdr, latestLedger, networkPassphrase } = signerResult;

      // 3. Sign auth entry with passkey (secp256r1 biometric prompt — admin approves)
      setStatus('Approve with passkey (biometric prompt)...');
      const { xdr: xdrLib } = await import('@stellar/stellar-sdk');
      const authEntryObj = xdrLib.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
      const { signWithPasskey } = await import('@/lib/passkey/crossmint-webauthn');
      const signedAuthEntry = await signWithPasskey(
        authEntryObj,
        credentialId,
        networkPassphrase,
        parseInt(latestLedger),
      );
      const signedAuthEntryXdr = signedAuthEntry.toXDR('base64');

      // 4. Finalize TX (inject signed auth entry + optimize footprint)
      setStatus('Finalizing transaction...');
      const finalizeRes = await fetch('/api/signer/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawTxXdr,
          assembledTxXdr,
          signedAuthEntryXdr,
          networkPassphrase,
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
        secretKey,       // Only present for Ed25519
        signerType,
        keyLabel: signerType === 'Secp256r1' ? keyLabel : undefined,
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

      {/* Signer Type */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Key Custody
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setSignerType('Ed25519')}
            className={`p-3 rounded-lg border text-left transition-colors ${
              signerType === 'Ed25519'
                ? 'border-blue-500 bg-blue-900/30 text-blue-400'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
            }`}
            disabled={loading}
          >
            <div className="text-sm font-medium">Ed25519</div>
            <div className="text-xs mt-1 opacity-70">
              Keypair generated in your browser. Save the secret key.
            </div>
          </button>
          <button
            onClick={() => setSignerType('Secp256r1')}
            className={`p-3 rounded-lg border text-left transition-colors ${
              signerType === 'Secp256r1'
                ? 'border-green-500 bg-green-900/30 text-green-400'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
            }`}
            disabled={loading}
          >
            <div className="text-sm font-medium">Secp256r1 (Secure Enclave)</div>
            <div className="text-xs mt-1 opacity-70">
              Hardware-bound P-256. Key never leaves device.
            </div>
          </button>
        </div>
      </div>

      {/* SE key instructions + public key input */}
      {signerType === 'Secp256r1' && (
        <div className="space-y-3">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-300 mb-2">
              Run on your macOS machine:
            </p>
            <code className="text-xs text-green-400 bg-gray-900 rounded px-2 py-1 block break-all select-all">
              keypo-signer generate --label {keyLabel || 'agent-<name>'} --policy open
            </code>
            <p className="text-xs text-gray-500 mt-2">
              Requires <a href="https://github.com/keypo-us/keypo-cli/tree/main/keypo-signer" target="_blank" rel="noopener" className="text-blue-400 hover:underline">keypo-signer</a> installed.
              The <code className="text-gray-400">open</code> policy enables headless signing (no biometric per-sign).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Public Key (paste from keypo-signer output)
            </label>
            <Input
              value={sePublicKey}
              onChange={(e) => setSePublicKey(e.target.value)}
              placeholder="04a1b2c3... (hex) or BKGyw... (base64)"
              className="bg-gray-800 border-gray-700 text-white font-mono text-xs"
              disabled={loading}
            />
            {sePublicKey && !parsePublicKeyInput(sePublicKey) && (
              <p className="text-xs text-red-400 mt-1">
                Invalid key. Expected 65-byte uncompressed P-256 key (0x04 prefix).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Spend Policy */}
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
        disabled={loading || !agentName.trim() || (signerType === 'Secp256r1' && !parsePublicKeyInput(sePublicKey))}
        className="w-full bg-blue-600 hover:bg-blue-700"
      >
        {loading ? 'Creating agent...' : 'Create Agent'}
      </Button>
    </div>
  );
}
