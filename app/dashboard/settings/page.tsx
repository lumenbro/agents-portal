'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Recovery key state
  const [hasRecoveryKey, setHasRecoveryKey] = useState<boolean | null>(null);
  const [recoverySetupLoading, setRecoverySetupLoading] = useState(false);
  const [recoverySetupStatus, setRecoverySetupStatus] = useState('');
  const [recoverySecretDisplay, setRecoverySecretDisplay] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const truncate = (s: string, n: number = 8) =>
    s.length > n * 2 ? `${s.slice(0, n)}...${s.slice(-n)}` : s;

  const fetchRecoveryStatus = useCallback(async () => {
    try {
      const { authFetch } = await import('@/lib/authenticated-fetch');
      const res = await authFetch('/api/wallet/recovery-status');
      if (res.ok) {
        const data = await res.json();
        setHasRecoveryKey(data.data?.hasRecoveryKey ?? false);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('agents_session');
      if (!saved) { window.location.href = '/'; return; }
      const session = JSON.parse(saved);
      if (!session.walletAddress) { window.location.href = '/'; return; }
      setWalletAddress(session.walletAddress);
      fetchRecoveryStatus();
    } catch {
      window.location.href = '/';
    }
  }, [fetchRecoveryStatus]);

  const handleSetupRecoveryKey = async () => {
    if (!walletAddress) return;
    setRecoverySetupLoading(true);
    setRecoverySetupStatus('');
    setRecoverySecretDisplay(null);

    try {
      // 0. Get passkey info + ghost keypair
      setRecoverySetupStatus('Preparing credentials...');
      const stored = localStorage.getItem('agents_passkey');
      if (!stored) throw new Error('Passkey info not found. Please log in again.');
      const { credentialId, publicKey: passkeyPublicKey, ghostAddress } = JSON.parse(stored);

      const { deriveGhostKeypairSecure } = await import('@/lib/ghost-address-derivation');
      const ghostKeypair = await deriveGhostKeypairSecure(passkeyPublicKey);

      // 1. Generate Ed25519 recovery keypair
      setRecoverySetupStatus('Generating recovery key...');
      const { Keypair } = await import('@stellar/stellar-sdk');
      const recoveryKeypair = Keypair.random();
      const recoveryGAddress = recoveryKeypair.publicKey();
      const recoverySecret = recoveryKeypair.secret();
      const recoveryPubBase64 = Buffer.from(recoveryKeypair.rawPublicKey()).toString('base64');

      // 2. Build add_signer TX (Admin Ed25519, no policy)
      setRecoverySetupStatus('Building transaction...');
      const { authFetch } = await import('@/lib/authenticated-fetch');
      const addRes = await authFetch('/api/signer/add', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          signerPublicKey: recoveryGAddress,
          signerType: 'Ed25519',
          role: 'Admin',
          sourceAddress: ghostAddress,
          skipPolicy: true,
        }),
      });

      if (!addRes.ok) {
        const err = await addRes.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Failed to build add_signer transaction');
      }

      const addJson = await addRes.json();
      const { rawTxXdr, assembledTxXdr, authEntryXdr, latestLedger, networkPassphrase } = addJson;

      // 3. Sign auth entry with passkey
      setRecoverySetupStatus('Approve with passkey...');
      const { xdr: xdrLib, Transaction } = await import('@stellar/stellar-sdk');
      const authEntryObj = xdrLib.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
      const { signWithPasskey } = await import('@/lib/passkey/crossmint-webauthn');
      const signedAuthEntry = await signWithPasskey(
        authEntryObj,
        credentialId,
        networkPassphrase,
        parseInt(latestLedger),
      );
      const signedAuthEntryXdr = signedAuthEntry.toXDR('base64');

      // 4. Finalize TX
      setRecoverySetupStatus('Finalizing transaction...');
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
        const err = await finalizeRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to finalize transaction');
      }

      const finalizeJson = await finalizeRes.json();
      const innerXdr = finalizeJson.innerXdr;

      // 5. Sign inner TX with ghost keypair
      setRecoverySetupStatus('Signing transaction...');
      const innerTx = new Transaction(innerXdr, networkPassphrase);
      innerTx.sign(ghostKeypair);
      const signedInnerXdr = innerTx.toXDR();

      // 6. Submit via paymaster
      setRecoverySetupStatus('Submitting to network...');
      const challengeRes = await fetch('/api/paymaster/challenge');
      const challengeJson = await challengeRes.json();
      const challenge = challengeJson.challenge;

      const challengeBytes = Buffer.from(challenge, 'hex');
      const ghostSig = ghostKeypair.sign(challengeBytes).toString('base64');

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
        const err = await submitRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to submit transaction');
      }

      // 7. Store recovery public key in DB
      setRecoverySetupStatus('Saving recovery key...');
      await authFetch('/api/wallet/set-recovery-key', {
        method: 'POST',
        body: JSON.stringify({ recoveryPublicKey: recoveryPubBase64 }),
      });

      // 8. Done — show the secret key
      setHasRecoveryKey(true);
      setRecoverySecretDisplay(recoverySecret);
      setRecoverySetupStatus('');
    } catch (err: any) {
      console.error('[RecoverySetup] Error:', err);
      setRecoverySetupStatus(`Error: ${err.message}`);
    } finally {
      setRecoverySetupLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* Wallet info */}
      {walletAddress && (
        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm text-gray-400">Wallet:</span>
          <code className="text-sm text-blue-400 bg-gray-800 rounded px-2 py-0.5 select-all">
            {truncate(walletAddress)}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(walletAddress, 'wallet')}
            className="border-gray-700 text-gray-400 hover:text-white h-6 px-2 text-xs"
          >
            {copied === 'wallet' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      )}

      {/* Recovery Key */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">Recovery Key</h2>
        <Card className={hasRecoveryKey === false ? 'bg-orange-900/10 border-orange-900/50' : 'bg-gray-900 border-gray-800'}>
          <CardContent className="p-5">
            {recoverySecretDisplay ? (
              /* Show recovery secret once after setup */
              <div>
                <h3 className="text-sm font-medium text-orange-400 mb-2">
                  Recovery Key Created — Save This Now
                </h3>
                <p className="text-xs text-orange-300 mb-3">
                  This is the <strong>only time</strong> this key will be shown. It has full Admin access to your wallet.
                  If you lose your passkey, enter this key on the login page to recover your wallet.
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs text-orange-300 bg-gray-800 rounded px-2 py-1 flex-1 break-all select-all font-mono">
                    {recoverySecretDisplay}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(recoverySecretDisplay, 'recovery')}
                    className="border-orange-700 text-orange-400 hover:bg-orange-900/50 shrink-0"
                  >
                    {copied === 'recovery' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <p className="text-xs text-orange-500 font-medium">
                  Store it somewhere safe and offline. This will NOT be shown again.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRecoverySecretDisplay(null)}
                  className="mt-3 border-gray-700 text-gray-400 hover:text-white text-xs"
                >
                  I&apos;ve saved it
                </Button>
              </div>
            ) : hasRecoveryKey ? (
              /* Recovery key is set */
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded border bg-green-900/50 text-green-400 border-green-800">
                      Active
                    </span>
                    <span className="text-sm text-gray-300">Recovery key is registered on-chain</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    If you lose your passkey, use your recovery secret key (S...) on the login page to restore access.
                  </p>
                </div>
              </div>
            ) : hasRecoveryKey === false ? (
              /* No recovery key */
              <div>
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm text-orange-400 font-medium mb-1">No recovery key</p>
                    <p className="text-xs text-gray-500">
                      If you lose your passkey (device lost, wiped, or broken), you won&apos;t be able to
                      access this wallet without a recovery key. This adds a backup Ed25519 Admin signer on-chain.
                    </p>
                  </div>
                  <Button
                    onClick={handleSetupRecoveryKey}
                    disabled={recoverySetupLoading}
                    className="bg-orange-600 hover:bg-orange-700 text-white shrink-0"
                  >
                    {recoverySetupLoading ? 'Setting up...' : 'Set Up Recovery Key'}
                  </Button>
                </div>
                <div className="text-xs text-gray-600 border-t border-gray-800 pt-3">
                  <strong>How it works:</strong> An Ed25519 keypair is generated in your browser. The public key is added
                  as an Admin signer on your smart wallet contract. The secret key (S...) is shown once — save it offline.
                  During recovery, enter the secret key on the login page to restore wallet access and add a new passkey.
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Loading...</div>
            )}
            {recoverySetupStatus && (
              <div className={`mt-3 text-sm ${recoverySetupStatus.startsWith('Error:') ? 'text-red-400' : 'text-gray-400'}`}>
                {!recoverySetupStatus.startsWith('Error:') && (
                  <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                )}
                {recoverySetupStatus}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Session */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">Session</h2>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300">Sign out and clear local session data.</p>
                <p className="text-xs text-gray-500 mt-1">
                  Your wallet and agents remain on-chain. You can sign back in with your passkey.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  localStorage.removeItem('agents_session');
                  localStorage.removeItem('agents_passkey');
                  window.location.href = '/';
                }}
                className="border-gray-700 text-gray-400 hover:text-white shrink-0"
              >
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
