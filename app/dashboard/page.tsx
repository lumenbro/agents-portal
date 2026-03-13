'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface Agent {
  id: string;
  name: string;
  signer_public_key: string;
  signer_type?: string;
  key_label?: string;
  policy_tier_id: string;
  policy_address: string;
  status: string;
  created_at: string;
}

interface BudgetInfo {
  dailyLimitUsdc: number;
  spentTodayUsdc: number;
  remainingUsdc: number;
}

export default function DashboardPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Revoke dialog state
  const [revokeAgent, setRevokeAgent] = useState<Agent | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  // Spend tracking
  const [budgets, setBudgets] = useState<Record<string, BudgetInfo>>({});

  const fetchBudgets = useCallback(async (wallet: string, agentList: Agent[]) => {
    const active = agentList.filter((a) => a.status === 'active' && a.policy_address);
    const results: Record<string, BudgetInfo> = {};
    await Promise.allSettled(
      active.map(async (agent) => {
        try {
          const { authFetch } = await import('@/lib/authenticated-fetch');
          const res = await authFetch(
            `/api/policy/budget?walletAddress=${wallet}&policyAddress=${agent.policy_address}`
          );
          if (res.ok) {
            const data = await res.json();
            results[agent.id] = {
              dailyLimitUsdc: data.dailyLimitUsdc,
              spentTodayUsdc: data.spentTodayUsdc,
              remainingUsdc: data.remainingUsdc,
            };
          }
        } catch { /* ignore individual failures */ }
      })
    );
    setBudgets(results);
  }, []);

  const fetchAgents = useCallback(async (wallet: string) => {
    try {
      const { authFetch } = await import('@/lib/authenticated-fetch');
      const res = await authFetch('/api/agents');

      if (res.status === 401) {
        // authFetch already tried to refresh — if still 401, session is truly gone
        setSessionExpired(true);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const agentList = data.agents || [];
      setAgents(agentList);
      fetchBudgets(wallet, agentList);
    } catch { /* ignore */ }
    setLoading(false);
  }, [fetchBudgets]);

  const handleManualRefresh = async () => {
    try {
      const { clearBrowserSessionToken } = await import('@/lib/authenticated-fetch');
      clearBrowserSessionToken(); // Force re-acquire
      setSessionExpired(false);
      setLoading(true);
      if (walletAddress) fetchAgents(walletAddress);
    } catch {
      setSessionExpired(true);
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('agents_session');
      if (!saved) {
        window.location.href = '/';
        return;
      }
      const session = JSON.parse(saved);
      if (!session.walletAddress) {
        window.location.href = '/';
        return;
      }
      setWalletAddress(session.walletAddress);
      fetchAgents(session.walletAddress);
    } catch {
      window.location.href = '/';
    }
  }, [fetchAgents]);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const truncate = (s: string, n: number = 12) =>
    s.length > n * 2 ? `${s.slice(0, n)}...${s.slice(-n)}` : s;

  const tierLabel = (tier: string) => {
    const map: Record<string, string> = {
      low: 'Starter ($50/day)',
      mid: 'Production ($500/day)',
      high: 'Enterprise ($2,000/day)',
    };
    return map[tier] || tier;
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-900/50 text-green-400 border-green-800',
      pending_signer: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
      revoked: 'bg-red-900/50 text-red-400 border-red-800',
    };
    return colors[status] || 'bg-gray-800 text-gray-400 border-gray-700';
  };

  // --- Edit name ---
  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setEditName(agent.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = async (agentId: string) => {
    if (!editName.trim()) return;
    setEditSaving(true);
    try {
      const { authFetch } = await import('@/lib/authenticated-fetch');
      const res = await authFetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update');
      }
      // Update local state
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, name: editName.trim() } : a))
      );
      setEditingId(null);
    } catch (err: any) {
      alert(err.message || 'Failed to update agent name');
    } finally {
      setEditSaving(false);
    }
  };

  // --- Revoke agent (on-chain + DB) ---
  const [revokeStatus, setRevokeStatus] = useState('');

  const confirmRevoke = async () => {
    if (!revokeAgent || !walletAddress) return;
    setRevokeLoading(true);
    setRevokeStatus('');

    try {
      // 0. Re-derive ghost keypair
      setRevokeStatus('Preparing credentials...');
      const stored = localStorage.getItem('agents_passkey');
      if (!stored) throw new Error('Passkey info not found. Please log in again.');
      const { credentialId, publicKey: passkeyPublicKey, ghostAddress } = JSON.parse(stored);

      const { deriveGhostKeypairSecure } = await import('@/lib/ghost-address-derivation');
      const ghostKeypair = await deriveGhostKeypairSecure(passkeyPublicKey);

      // 1. Build revoke_signer TX
      setRevokeStatus('Building revoke transaction...');
      const revokeBody: Record<string, any> = {
        walletAddress,
        signerPublicKey: revokeAgent.signer_public_key,
        signerType: revokeAgent.signer_type || 'Ed25519',
        sourceAddress: ghostAddress,
      };

      // For Secp256r1, pass key_id if available
      if (revokeAgent.signer_type === 'Secp256r1' && (revokeAgent as any).key_id) {
        revokeBody.keyId = (revokeAgent as any).key_id;
      }

      const { authFetch } = await import('@/lib/authenticated-fetch');
      const revokeRes = await authFetch('/api/signer/revoke', {
        method: 'POST',
        body: JSON.stringify(revokeBody),
      });

      if (!revokeRes.ok) {
        const err = await revokeRes.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Failed to build revoke transaction');
      }

      const revokeJson = await revokeRes.json();
      const { rawTxXdr, assembledTxXdr, authEntryXdr, latestLedger, networkPassphrase } = revokeJson;

      // 2. Sign auth entry with passkey
      setRevokeStatus('Approve with passkey...');
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

      // 3. Finalize TX (re-simulate with signed auth for correct footprint)
      setRevokeStatus('Finalizing transaction...');
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

      // 4. Sign inner TX with ghost keypair
      setRevokeStatus('Signing transaction...');
      const innerTx = new Transaction(innerXdr, networkPassphrase);
      innerTx.sign(ghostKeypair);
      const signedInnerXdr = innerTx.toXDR();

      // 5. Get challenge + submit via paymaster
      setRevokeStatus('Submitting to network...');
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

      // 6. Update DB status
      setRevokeStatus('Updating agent status...');
      await authFetch(`/api/agents/${revokeAgent.id}`, {
        method: 'DELETE',
      });

      // Update local state
      setAgents((prev) =>
        prev.map((a) => (a.id === revokeAgent.id ? { ...a, status: 'revoked' } : a))
      );
      setRevokeAgent(null);
    } catch (err: any) {
      console.error('[Revoke] Error:', err);
      setRevokeStatus(`Error: ${err.message}`);
      // Don't close dialog on error — let user see the message and retry
    } finally {
      setRevokeLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Wallet info */}
      {walletAddress && (
        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm text-gray-400">Wallet:</span>
          <code className="text-sm text-blue-400 bg-gray-800 rounded px-2 py-0.5 select-all">
            {truncate(walletAddress, 8)}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(walletAddress, 'wallet')}
            className="border-gray-700 text-gray-400 hover:text-white h-6 px-2 text-xs"
          >
            {copied === 'wallet' ? 'Copied!' : 'Copy'}
          </Button>
          <a
            href={`https://stellar.expert/explorer/public/contract/${walletAddress}`}
            target="_blank"
            rel="noopener"
            className="text-xs text-gray-500 hover:text-blue-400"
          >
            Explorer
          </a>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Agents</h1>
        <a href="/">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-sm">
            + Add Agent
          </Button>
        </a>
      </div>

      {/* Session expired banner */}
      {sessionExpired && (
        <Card className="bg-yellow-900/20 border-yellow-800 mb-6">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-yellow-400 font-medium text-sm">Session expired</p>
              <p className="text-yellow-400/70 text-xs mt-1">
                Your session has expired. Click refresh to re-authenticate using your stored passkey data.
              </p>
            </div>
            <Button
              onClick={handleManualRefresh}
              size="sm"
              className="bg-yellow-600 hover:bg-yellow-700 text-white shrink-0"
            >
              Refresh Session
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-gray-400">Loading agents...</div>
      ) : agents.length === 0 && !sessionExpired ? (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-8 text-center">
            <p className="text-gray-400 mb-4">No agents yet.</p>
            <a href="/">
              <Button className="bg-blue-600 hover:bg-blue-700">
                Create Your First Agent
              </Button>
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {agents.map((agent) => (
            <Card key={agent.id} className="bg-gray-900 border-gray-800">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    {/* Name row — inline edit */}
                    <div className="flex items-center gap-3">
                      {editingId === agent.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(agent.id);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="h-7 text-sm bg-gray-800 border-gray-700 text-white max-w-[200px]"
                            autoFocus
                            disabled={editSaving}
                          />
                          <Button
                            size="sm"
                            onClick={() => saveEdit(agent.id)}
                            disabled={editSaving || !editName.trim()}
                            className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700"
                          >
                            {editSaving ? '...' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEdit}
                            disabled={editSaving}
                            className="h-7 px-2 text-xs border-gray-700 text-gray-400"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <h3
                          className="text-base font-medium text-white cursor-pointer hover:text-blue-400 transition-colors"
                          onClick={() => startEdit(agent)}
                          title="Click to edit name"
                        >
                          {agent.name}
                        </h3>
                      )}

                      <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${statusBadge(agent.status)}`}>
                        {agent.status === 'pending_signer' ? 'Pending' : agent.status}
                      </span>
                      {(agent.signer_type || 'Ed25519') === 'Secp256r1' && (
                        <span className="text-xs px-2 py-0.5 rounded border bg-green-900/30 text-green-400 border-green-800 shrink-0">
                          Secure Enclave
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                      <div>
                        <span className="text-gray-500">Signer: </span>
                        <code className="text-gray-300 text-xs">
                          {truncate(agent.signer_public_key)}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-500">Policy: </span>
                        <span className="text-gray-300">{tierLabel(agent.policy_tier_id || '')}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Type: </span>
                        <span className="text-gray-300">{agent.signer_type || 'Ed25519'}</span>
                      </div>
                      {agent.key_label && (
                        <div>
                          <span className="text-gray-500">Label: </span>
                          <code className="text-green-400 text-xs">{agent.key_label}</code>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500">Created: </span>
                        <span className="text-gray-300">
                          {new Date(agent.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Spend tracking */}
                    {agent.status === 'active' && budgets[agent.id] && (
                      <div className="mt-3 pt-3 border-t border-gray-800">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-gray-400">
                            Daily spend: ${budgets[agent.id].spentTodayUsdc.toFixed(2)} / ${budgets[agent.id].dailyLimitUsdc.toFixed(2)}
                          </span>
                          <span className="text-gray-500">
                            ${budgets[agent.id].remainingUsdc.toFixed(2)} remaining
                          </span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              budgets[agent.id].spentTodayUsdc / budgets[agent.id].dailyLimitUsdc > 0.9
                                ? 'bg-red-500'
                                : budgets[agent.id].spentTodayUsdc / budgets[agent.id].dailyLimitUsdc > 0.7
                                ? 'bg-yellow-500'
                                : 'bg-blue-500'
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (budgets[agent.id].spentTodayUsdc / budgets[agent.id].dailyLimitUsdc) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {agent.status !== 'revoked' && (
                    <div className="shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRevokeAgent(agent)}
                        className="border-red-900 text-red-400 hover:bg-red-900/30 hover:text-red-300 h-8 px-3 text-xs"
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Revoke confirmation dialog */}
      <Dialog open={!!revokeAgent} onOpenChange={(open) => !open && setRevokeAgent(null)}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white">
          <DialogHeader>
            <DialogTitle>Revoke Agent</DialogTitle>
            <DialogDescription className="text-gray-400">
              This will revoke <span className="text-white font-medium">{revokeAgent?.name}</span>&apos;s
              signing permissions. The agent key will no longer be able to authorize transactions
              on your smart wallet. This action cannot be undone from the dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
            This will remove the signer key on-chain via <code className="text-xs bg-gray-800 px-1 rounded">revoke_signer</code> and
            mark the agent as revoked in the portal. You will need to approve with your passkey.
          </div>

          {revokeStatus && (
            <div className={`text-sm ${revokeStatus.startsWith('Error:') ? 'text-red-400' : 'text-gray-400'}`}>
              {!revokeStatus.startsWith('Error:') && (
                <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
              )}
              {revokeStatus}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setRevokeAgent(null); setRevokeStatus(''); }}
              disabled={revokeLoading}
              className="border-gray-700 text-gray-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRevoke}
              disabled={revokeLoading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {revokeLoading ? 'Revoking...' : 'Revoke Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
