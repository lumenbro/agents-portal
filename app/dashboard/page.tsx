'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AgentCard } from '@/components/dashboard/agent-card';
import { NetworkToggle } from '@/components/dashboard/network-toggle';

interface Agent {
  id: string;
  name: string;
  signer_public_key: string;
  policy_tier_id: string;
  policy_address: string;
  status: string;
  created_at: string;
}

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('session_token');
    if (!token) {
      window.location.href = '/';
      return;
    }

    fetch('/api/agents', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setAgents(data.agents || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-white">Agent Management</h1>
        <NetworkToggle />
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
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
