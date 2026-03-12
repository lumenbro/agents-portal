export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <a href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-sm text-white">
              LJ
            </div>
            <span className="text-lg font-semibold text-white">LumenBro Agents</span>
          </a>
          <span className="text-gray-600 mx-2">/</span>
          <span className="text-gray-400">Documentation</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-8">Quickstart Guide</h1>

        <div className="prose prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-4">1. Install the SDK</h2>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>npm install lumenjoule-sdk</code>
            </pre>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">2. Configure Your Agent</h2>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient } from 'lumenjoule-sdk';

const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET_KEY!,
  walletAddress: process.env.WALLET_ADDRESS!,
  computeUrl: 'https://compute.lumenbro.com',
  network: 'mainnet',
});`}</code>
            </pre>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">3. Make Inference Requests</h2>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`const response = await client.chat({
  model: 'deepseek-ai/DeepSeek-V3',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is JOULE?' },
  ],
});

console.log(response.choices[0].message.content);`}</code>
            </pre>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">Spend Policies</h2>
            <p>
              Each agent signer has an on-chain ExternalValidatorPolicy that enforces daily spending limits.
              Available tiers:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>$50/day</strong> — Suitable for development and low-volume agents</li>
              <li><strong>$500/day</strong> — For production agents with higher throughput</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">API Reference</h2>
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <code className="text-green-400">POST /v1/chat/completions</code>
                <p className="text-sm text-gray-400 mt-1">OpenAI-compatible chat completion endpoint</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <code className="text-green-400">GET /v1/models</code>
                <p className="text-sm text-gray-400 mt-1">List available models</p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
