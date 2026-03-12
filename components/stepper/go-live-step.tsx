'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface GoLiveStepProps {
  walletAddress: string;
  agentData: any;
}

export function GoLiveStep({ walletAddress, agentData }: GoLiveStepProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<'typescript' | 'python' | 'curl'>('typescript');

  const secretKey = agentData?.secretKey || 'S...YOUR_AGENT_SECRET_KEY';
  const publicKey = agentData?.agent?.signer_public_key || 'G...AGENT_PUBLIC_KEY';

  const snippets = {
    typescript: `import { SmartWalletClient } from 'lumenjoule-sdk';

const client = new SmartWalletClient({
  agentSecretKey: '${secretKey}',
  walletAddress: '${walletAddress}',
  computeUrl: 'https://compute.lumenbro.com',
  network: 'mainnet',
});

const response = await client.chat({
  model: 'deepseek-ai/DeepSeek-V3',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);`,
    python: `import requests

response = requests.post(
    'https://compute.lumenbro.com/v1/chat/completions',
    headers={
        'Content-Type': 'application/json',
        'X-Agent-Key': '${secretKey}',
        'X-Wallet-Address': '${walletAddress}',
    },
    json={
        'model': 'deepseek-ai/DeepSeek-V3',
        'messages': [{'role': 'user', 'content': 'Hello!'}],
    }
)

print(response.json()['choices'][0]['message']['content'])`,
    curl: `curl -X POST https://compute.lumenbro.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Key: ${secretKey}" \\
  -H "X-Wallet-Address: ${walletAddress}" \\
  -d '{
    "model": "deepseek-ai/DeepSeek-V3",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Secret key warning */}
      {agentData?.secretKey && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-400 mb-2">
            Save Your Agent Secret Key
          </h3>
          <div className="flex items-center gap-2">
            <code className="text-xs text-yellow-300 bg-gray-800 rounded px-2 py-1 flex-1 break-all select-all">
              {secretKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(secretKey, 'secret')}
              className="border-yellow-700 text-yellow-400 hover:bg-yellow-900/50 shrink-0"
            >
              {copied === 'secret' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-yellow-500 mt-2">
            This will not be shown again. Store it securely.
          </p>
        </div>
      )}

      {/* Code snippets */}
      <div>
        <div className="flex border-b border-gray-700 mb-4">
          {(['typescript', 'python', 'curl'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'typescript' ? 'TypeScript' : t === 'python' ? 'Python' : 'cURL'}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="bg-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">
            <code>{snippets[tab]}</code>
          </pre>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyToClipboard(snippets[tab], tab)}
            className="absolute top-2 right-2 border-gray-600 text-gray-400 hover:text-white"
          >
            {copied === tab ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Next steps */}
      <div className="flex gap-3">
        <a href="/dashboard" className="flex-1">
          <Button className="w-full bg-blue-600 hover:bg-blue-700">
            Go to Dashboard
          </Button>
        </a>
        <a href="/docs" className="flex-1">
          <Button variant="outline" className="w-full border-gray-700 text-gray-400 hover:text-white">
            Read Docs
          </Button>
        </a>
      </div>
    </div>
  );
}
