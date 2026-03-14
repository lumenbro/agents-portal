'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CreateWalletStepProps {
  onComplete: (data: {
    walletAddress: string;
    ghostAddress: string;
    sessionToken: string;
    recoverySecret?: string;
  }) => void;
}

export function CreateWalletStep({ onComplete }: CreateWalletStepProps) {
  const [email, setEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [webviewWarning, setWebviewWarning] = useState<string | null>(null);
  const [setupRecovery, setSetupRecovery] = useState(false);

  // Check for webview / passkey availability on mount
  useEffect(() => {
    (async () => {
      const { detectWebViewEnvironment, shouldShowPasskeyWarning, getWebViewPlatformName } = await import('@/lib/webview-detection');
      const env = detectWebViewEnvironment();
      if (shouldShowPasskeyWarning(env)) {
        setWebviewWarning(
          `Passkeys may not work in ${getWebViewPlatformName(env)}. Open this page in Safari or Chrome instead.`
        );
        return;
      }
      const { checkPasskeyAvailability, getPasskeyUnavailableReason } = await import('@/lib/passkey-availability');
      const availability = await checkPasskeyAvailability();
      if (!availability.available) {
        setWebviewWarning(getPasskeyUnavailableReason(availability));
      }
    })();
  }, []);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const handleRegister = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }
    if (!userName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check if email already has a wallet
      setStatus('Checking account...');
      const lookupRes = await fetch('/api/wallet/lookup-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        if (lookupData.data?.found) {
          setError(
            'A wallet already exists for this email. Click "Sign in with existing passkey" above to access it.'
          );
          setLoading(false);
          setStatus('');
          return;
        }
      }

      setStatus('Registering passkey...');
      const { registerPasskey } = await import('@/lib/passkey/crossmint-webauthn');
      const { credentialId, publicKey } = await registerPasskey(userName, 'LumenBro Agents', {
        email: trimmedEmail,
      });

      let recoverySecret: string | undefined;
      let recoverySigner: { type: 'Ed25519'; publicKey: string } | undefined;

      if (setupRecovery) {
        setStatus('Generating recovery key...');
        const { Keypair } = await import('@stellar/stellar-sdk');
        const recoveryKeypair = Keypair.random();
        recoverySecret = recoveryKeypair.secret();
        const recoveryPublicKeyBase64 = Buffer.from(recoveryKeypair.rawPublicKey()).toString('base64');
        recoverySigner = { type: 'Ed25519', publicKey: recoveryPublicKeyBase64 };
      }

      setStatus('Deploying smart wallet...');
      const deployBody: Record<string, any> = {
        userId: crypto.randomUUID(),
        email: trimmedEmail,
        signers: [{
          type: 'Secp256r1',
          keyId: credentialId,
          publicKey,
          role: 'Admin',
        }],
      };
      if (recoverySigner) {
        deployBody.recoverySigner = recoverySigner;
      }

      const deployRes = await fetch('/api/wallet/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deployBody),
      });

      if (!deployRes.ok) {
        const err = await deployRes.json();
        throw new Error(err.error || 'Wallet deployment failed');
      }

      const deployData = await deployRes.json();
      const walletAddress = deployData.data?.walletAddress || deployData.data?.contractId || deployData.walletAddress;

      setStatus('Deriving ghost account...');
      // Derive ghost keypair from passkey + server salt
      const { deriveGhostKeypairSecure } = await import('@/lib/ghost-address-derivation');
      const ghostKeypair = await deriveGhostKeypairSecure(publicKey);
      const ghostAddress = ghostKeypair.publicKey();

      setStatus('Creating ghost account on-chain...');
      // Get challenge and sign with ghost keypair to prove ownership
      const challengeRes1 = await fetch('/api/paymaster/challenge');
      const challengeJson1 = await challengeRes1.json();
      const challenge1 = challengeJson1.data?.challenge || challengeJson1.challenge;

      const challengeBytes1 = Buffer.from(challenge1, 'hex');
      const ghostSig1 = ghostKeypair.sign(challengeBytes1).toString('base64');

      // Create zero-balance sponsored ghost account
      const createGhostRes = await fetch('/api/paymaster/create-ghost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passkeyPubkeyBase64: publicKey,
          challenge: challenge1,
          signature: ghostSig1,
        }),
      });

      if (!createGhostRes.ok) {
        const err = await createGhostRes.json();
        // Ghost may already exist — not fatal
        if (!err.error?.includes('already exists')) {
          console.warn('Ghost creation warning:', err.error);
        }
      }

      setStatus('Generating session...');
      // Get fresh challenge for auth (create-ghost consumes the first one)
      const challengeRes2 = await fetch('/api/paymaster/challenge');
      const challengeJson2 = await challengeRes2.json();
      const challenge2 = challengeJson2.data?.challenge || challengeJson2.challenge;

      const challengeBytes2 = Buffer.from(challenge2, 'hex');
      const ghostSig2 = ghostKeypair.sign(challengeBytes2).toString('base64');

      // Get session token with ghost-signed challenge proof
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghostAddress,
          walletAddress,
          challenge: challenge2,
          signature: ghostSig2,
          passkeyPublicKeyBase64: publicKey,
          credentialId,
        }),
      });
      const tokenData = await tokenRes.json();

      // Store passkey info for later steps (add-agent needs it)
      try {
        localStorage.setItem('agents_passkey', JSON.stringify({
          credentialId,
          publicKey,
          walletAddress,
          ghostAddress,
          email: trimmedEmail,
        }));
      } catch {}

      onComplete({
        walletAddress,
        ghostAddress,
        sessionToken: tokenData.data?.token || tokenData.token || '',
        recoverySecret,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Email
        </label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="bg-gray-800 border-gray-700 text-white"
          disabled={loading}
        />
        <p className="text-xs text-gray-500 mt-1">
          Used to identify your wallet across devices. One wallet per email.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Display Name
        </label>
        <Input
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="e.g., My Agent Wallet"
          className="bg-gray-800 border-gray-700 text-white"
          disabled={loading}
        />
        <p className="text-xs text-gray-500 mt-1">
          Shown in your device&apos;s passkey manager.
        </p>
      </div>

      <div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={setupRecovery}
            onChange={(e) => setSetupRecovery(e.target.checked)}
            disabled={loading}
            className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
              Set up recovery key
            </span>
            <p className="text-xs text-gray-500 mt-0.5">
              Generate a backup secret key (S...) in case you lose your passkey.
              You can also set this up later from the dashboard.
            </p>
          </div>
        </label>
      </div>

      {webviewWarning && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-sm text-yellow-400">
          {webviewWarning}
        </div>
      )}

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
        onClick={handleRegister}
        disabled={loading || !userName.trim() || !email.trim()}
        className="w-full bg-blue-600 hover:bg-blue-700"
      >
        {loading ? 'Setting up...' : 'Register with Passkey'}
      </Button>

      <p className="text-xs text-gray-500 text-center">
        Uses your device&apos;s biometric authentication (Face ID, Touch ID, Windows Hello).
        No passwords or seed phrases needed.
      </p>
    </div>
  );
}
