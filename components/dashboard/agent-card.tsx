'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    signer_public_key: string;
    policy_tier_id: string;
    status: string;
    created_at: string;
  };
}

export function AgentCard({ agent }: AgentCardProps) {
  const [copied, setCopied] = useState(false);

  const statusColors: Record<string, string> = {
    active: 'bg-green-900/30 text-green-400 border-green-800',
    pending_signer: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
    revoked: 'bg-red-900/30 text-red-400 border-red-800',
  };

  const copyPublicKey = () => {
    navigator.clipboard.writeText(agent.signer_public_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-medium text-white">{agent.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[agent.status] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                {agent.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-500">
                {agent.signer_public_key.substring(0, 8)}...{agent.signer_public_key.substring(48)}
              </code>
              <button
                onClick={copyPublicKey}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Policy: {agent.policy_tier_id} | Created: {new Date(agent.created_at).toLocaleDateString()}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-gray-700 text-gray-400 hover:text-white"
          >
            Manage
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
