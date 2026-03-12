'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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

export default function DashboardPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('agents_session');
      if (!saved) {
        window.location.href = '/';
        return;
      }
      const session = JSON.parse(saved);
      if (!session.walletAddress || !session.sessionToken) {
        window.location.href = '/';
        return;
      }
      setWalletAddress(session.walletAddress);

      fetch('/api/agents', {
        headers: { 'Authorization': `Bearer ${session.sessionToken}` },
      })
        .then((res) => res.json())
        .then((data) => {
          setAgents(data.agents || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } catch {
      window.location.href = '/';
    }
  }, []);

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

      {loading ? (
        <div className="text-gray-400">Loading agents...</div>
      ) : agents.length === 0 ? (
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
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-medium text-white">{agent.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded border ${statusBadge(agent.status)}`}>
                        {agent.status === 'pending_signer' ? 'Pending' : agent.status}
                      </span>
                      {(agent.signer_type || 'Ed25519') === 'Secp256r1' && (
                        <span className="text-xs px-2 py-0.5 rounded border bg-green-900/30 text-green-400 border-green-800">
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
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
