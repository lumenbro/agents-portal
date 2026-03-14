'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CreateWalletStep } from '@/components/stepper/create-wallet-step';
import { FundWalletStep } from '@/components/stepper/fund-wallet-step';
import { AddAgentStep } from '@/components/stepper/add-agent-step';
import { GoLiveStep } from '@/components/stepper/go-live-step';
import { Input } from '@/components/ui/input';

const STEPS = [
  { id: 1, title: 'Create Wallet', description: 'Register with Face ID. No seed phrases.' },
  { id: 2, title: 'Add Agent', description: 'Generate agent keys with spend policies.' },
  { id: 3, title: 'Fund Wallet', description: 'Send USDC to your smart wallet.' },
  { id: 4, title: 'Go Live', description: 'Copy your SDK config and start building.' },
];

export default function HomePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ghostAddress, setGhostAddress] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [agentData, setAgentData] = useState<any>(null);
  const [recoverySecret, setRecoverySecret] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('agents_session');
      if (saved) {
        const session = JSON.parse(saved);
        if (session.walletAddress && session.sessionToken) {
          setWalletAddress(session.walletAddress);
          setGhostAddress(session.ghostAddress);
          setSessionToken(session.sessionToken);
          // If they already completed setup, redirect to dashboard
          if (session.completedSetup) {
            window.location.href = '/dashboard';
            return;
          }
          // Wallet exists but setup not finished — skip to step 2 (Add Agent)
          setCurrentStep(2);
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Persist session when wallet is created
  useEffect(() => {
    if (walletAddress && sessionToken) {
      localStorage.setItem('agents_session', JSON.stringify({
        walletAddress,
        ghostAddress,
        sessionToken,
        completedSetup: currentStep > 3,
      }));
    }
  }, [walletAddress, ghostAddress, sessionToken, currentStep]);

  // Passkey discovery login for returning users
  const handleSignIn = async () => {
    setSigningIn(true);
    setSignInError(null);

    try {
      const { getWebAuthnRpId } = await import('@/lib/passkey/webauthn-rpid');
      const rpId = getWebAuthnRpId();

      // Discoverable credential flow — browser shows all passkeys for this rpId
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId,
          timeout: 60000,
          userVerification: 'preferred',
          allowCredentials: [], // Empty = show all discoverable credentials
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        setSignInError('No passkey selected.');
        return;
      }

      // Encode credential ID as base64url (matches registration format)
      const base64url = (await import('base64url')).default;
      const credentialId = base64url.encode(Buffer.from(credential.rawId));

      // Look up wallet by credential ID
      const lookupRes = await fetch('/api/wallet/lookup-by-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      });

      if (!lookupRes.ok) {
        throw new Error('Failed to look up wallet');
      }

      const lookupData = await lookupRes.json();
      if (!lookupData.data?.found || !lookupData.data?.walletAddress) {
        setSignInError('No wallet found for this passkey. You may need to create a new one.');
        return;
      }

      const { walletAddress: foundWallet, ghostAddress: foundGhost, passkeyPublicKey } = lookupData.data;

      // Store passkey info for ghost derivation + future operations
      localStorage.setItem('agents_passkey', JSON.stringify({
        credentialId,
        publicKey: passkeyPublicKey,
        walletAddress: foundWallet,
        ghostAddress: foundGhost,
      }));

      // If we have ghost address + passkey public key, derive ghost keypair and get session token
      if (passkeyPublicKey) {
        const { deriveGhostKeypairSecure } = await import('@/lib/ghost-address-derivation');
        const ghostKeypair = await deriveGhostKeypairSecure(passkeyPublicKey);
        const derivedGhost = ghostKeypair.publicKey();

        // Get challenge and sign with ghost keypair
        const challengeRes = await fetch('/api/paymaster/challenge');
        const challengeJson = await challengeRes.json();
        const challenge = challengeJson.data?.challenge || challengeJson.challenge;

        const challengeBytes = Buffer.from(challenge, 'hex');
        const sig = ghostKeypair.sign(challengeBytes).toString('base64');

        // Get session token
        const tokenRes = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ghostAddress: derivedGhost,
            walletAddress: foundWallet,
            challenge,
            signature: sig,
            passkeyPublicKeyBase64: passkeyPublicKey,
            credentialId,
          }),
        });

        const tokenData = await tokenRes.json();
        const token = tokenData.data?.token || tokenData.token;

        if (token) {
          localStorage.setItem('agents_session', JSON.stringify({
            walletAddress: foundWallet,
            ghostAddress: derivedGhost,
            sessionToken: token,
            completedSetup: true,
          }));

          window.location.href = '/dashboard';
          return;
        }
      }

      // Fallback: we found the wallet but can't get a session token
      // (missing ghost address or passkey public key in DB)
      setSignInError('Wallet found but session could not be restored. Please contact support.');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setSignInError('Passkey authentication was cancelled.');
      } else {
        console.error('[SignIn] Error:', err);
        setSignInError(err.message || 'Sign in failed.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  // Recovery login with S-address
  const handleRecoveryLogin = async () => {
    const trimmed = recoveryInput.trim();
    if (!trimmed.startsWith('S') || trimmed.length !== 56) {
      setRecoveryError('Please enter a valid Stellar secret key (starts with S, 56 characters).');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError(null);

    try {
      const { Keypair } = await import('@stellar/stellar-sdk');
      let recoveryKeypair: InstanceType<typeof Keypair>;
      try {
        recoveryKeypair = Keypair.fromSecret(trimmed);
      } catch {
        setRecoveryError('Invalid secret key format.');
        return;
      }

      const recoveryGAddress = recoveryKeypair.publicKey();
      const recoveryPubBase64 = Buffer.from(recoveryKeypair.rawPublicKey()).toString('base64');

      // Look up wallet by recovery public key
      const lookupRes = await fetch('/api/wallet/lookup-by-recovery-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryPublicKey: recoveryPubBase64 }),
      });

      if (!lookupRes.ok) {
        throw new Error('Failed to look up wallet');
      }

      const lookupData = await lookupRes.json();
      if (!lookupData.data?.found || !lookupData.data?.walletAddress) {
        setRecoveryError('No wallet found for this recovery key.');
        return;
      }

      const foundWallet = lookupData.data.walletAddress;

      // Get challenge and sign with recovery keypair
      const challengeRes = await fetch('/api/paymaster/challenge');
      const challengeJson = await challengeRes.json();
      const challenge = challengeJson.data?.challenge || challengeJson.challenge;

      const challengeBytes = Buffer.from(challenge, 'hex');
      const sig = recoveryKeypair.sign(challengeBytes).toString('base64');

      // Get session token using recovery key as signer
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ghostAddress: recoveryGAddress,
          walletAddress: foundWallet,
          challenge,
          signature: sig,
          isRecovery: true,
        }),
      });

      const tokenData = await tokenRes.json();
      const token = tokenData.data?.token || tokenData.token;

      if (token) {
        localStorage.setItem('agents_session', JSON.stringify({
          walletAddress: foundWallet,
          ghostAddress: recoveryGAddress,
          sessionToken: token,
          completedSetup: true,
          isRecovery: true,
        }));

        window.location.href = '/dashboard';
        return;
      }

      setRecoveryError('Authentication failed. Please try again.');
    } catch (err: any) {
      console.error('[Recovery] Error:', err);
      setRecoveryError(err.message || 'Recovery failed.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="LumenBro" className="w-8 h-8 rounded-lg" />
            <span className="text-lg font-semibold text-white">LumenBro Agents</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors">
              Docs
            </a>
            {walletAddress && (
              <a href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
                Dashboard
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            Deploy AI Agents on Stellar
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Create a passkey-secured smart wallet, generate agent keys with on-chain spend policies,
            and get a working SDK config — all in under 5 minutes.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  currentStep > step.id
                    ? 'bg-green-600 text-white'
                    : currentStep === step.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {currentStep > step.id ? '✓' : step.id}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-16 h-0.5 mx-1 transition-colors ${
                    currentStep > step.id ? 'bg-green-600' : 'bg-gray-800'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step title */}
        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold text-white">
            Step {currentStep}: {STEPS[currentStep - 1].title}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {STEPS[currentStep - 1].description}
          </p>
        </div>

        {/* Step content */}
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-8">
            {currentStep === 1 && (
              <CreateWalletStep
                onComplete={(data) => {
                  setWalletAddress(data.walletAddress);
                  setGhostAddress(data.ghostAddress);
                  setSessionToken(data.sessionToken);
                  if (data.recoverySecret) setRecoverySecret(data.recoverySecret);
                  setCurrentStep(2);
                }}
              />
            )}
            {currentStep === 2 && (
              <AddAgentStep
                walletAddress={walletAddress!}
                ghostAddress={ghostAddress!}
                sessionToken={sessionToken!}
                onComplete={(data) => {
                  setAgentData(data);
                  // Persist latest agent for Go Live / Dashboard
                  localStorage.setItem('agents_last_agent', JSON.stringify(data));
                  setCurrentStep(3);
                }}
              />
            )}
            {currentStep === 3 && (
              <FundWalletStep
                walletAddress={walletAddress!}
                sessionToken={sessionToken!}
                onComplete={() => setCurrentStep(4)}
              />
            )}
            {currentStep === 4 && (
              <GoLiveStep
                walletAddress={walletAddress!}
                agentData={agentData}
                recoverySecret={recoverySecret}
              />
            )}
          </CardContent>
        </Card>

        {/* Sign In for returning users — only show on step 1 (no active session) */}
        {currentStep === 1 && !walletAddress && (
          <div className="mt-6 text-center">
            <div className="flex items-center gap-3 justify-center mb-3">
              <div className="h-px bg-gray-800 flex-1" />
              <span className="text-xs text-gray-500 uppercase tracking-wide">Already have a wallet?</span>
              <div className="h-px bg-gray-800 flex-1" />
            </div>

            {signInError && (
              <p className="text-sm text-red-400 mb-3">{signInError}</p>
            )}

            <Button
              variant="outline"
              onClick={handleSignIn}
              disabled={signingIn}
              className="border-gray-700 text-gray-300 hover:text-white hover:border-gray-600"
            >
              {signingIn ? 'Authenticating...' : 'Sign in with Passkey'}
            </Button>

            <button
              onClick={() => { setShowRecovery(!showRecovery); setRecoveryError(null); }}
              className="block mx-auto mt-3 text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              {showRecovery ? 'Hide recovery' : 'Lost your passkey? Recover with secret key'}
            </button>

            {showRecovery && (
              <div className="mt-4 bg-gray-900 border border-gray-800 rounded-lg p-4 text-left">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Recover with Secret Key
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Enter the recovery secret key (S...) that was shown when you created your wallet.
                </p>
                <Input
                  type="password"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                  placeholder="S..."
                  className="bg-gray-800 border-gray-700 text-white font-mono text-sm mb-3"
                  disabled={recoveryLoading}
                />
                {recoveryError && (
                  <p className="text-sm text-red-400 mb-3">{recoveryError}</p>
                )}
                <Button
                  onClick={handleRecoveryLogin}
                  disabled={recoveryLoading || !recoveryInput.trim()}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                >
                  {recoveryLoading ? 'Recovering...' : 'Recover Wallet'}
                </Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
