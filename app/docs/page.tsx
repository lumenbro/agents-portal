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
        <h1 className="text-3xl font-bold text-white mb-2">Agent Wallet SDK</h1>
        <p className="text-gray-400 mb-10">
          Set up a smart wallet, register an agent signer, and start making paid AI inference calls.
        </p>

        <div className="prose prose-invert max-w-none space-y-10">

          {/* Overview */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How It Works</h2>
            <ol className="list-decimal pl-6 space-y-2 text-sm">
              <li><strong>Create a wallet</strong> at <a href="/" className="text-blue-400 hover:underline">agents.lumenbro.com</a> &mdash; deploys a Stellar smart account (C-address)</li>
              <li><strong>Register an agent signer</strong> &mdash; Ed25519 keypair or Secp256r1 (Secure Enclave) key, gated by a spend policy</li>
              <li><strong>Fund with USDC</strong> &mdash; transfer USDC to your wallet&apos;s C-address</li>
              <li><strong>Use the SDK</strong> &mdash; your agent calls <code>client.chat()</code>, the SDK handles x402 payment automatically</li>
            </ol>
            <p className="text-sm mt-3 text-gray-500">
              The agent&apos;s key signs auth entries (not TX envelopes). The facilitator pays gas and submits the transaction.
              Your agent key never needs XLM funding.
            </p>
          </section>

          {/* Install */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Install the SDK</h2>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>npm install lumenjoule-sdk</code>
            </pre>
          </section>

          {/* Ed25519 Setup */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Configure Your Agent</h2>

            <h3 className="text-lg text-gray-200 mt-4 mb-2">Option A: Ed25519 Key (Simplest)</h3>
            <p className="text-sm text-gray-400 mb-3">
              Generate a Stellar keypair. The secret key goes in your agent&apos;s environment.
              Register the public key (G-address) as an agent signer in the portal.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient } from 'lumenjoule-sdk';

const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET!,   // S... key
  walletAddress: 'CXXX...',                     // from portal
  network: 'mainnet',
  policyAddress: 'CBRGH27...',                  // spend policy tier
});`}</code>
            </pre>

            <h3 className="text-lg text-gray-200 mt-6 mb-2">Option B: Secure Enclave Key (macOS)</h3>
            <p className="text-sm text-gray-400 mb-3">
              Hardware-bound P-256 key via <code>keypo-signer</code>. The private key never leaves the Secure Enclave.
              Register the public key as a Secp256r1 signer in the portal.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient, KeypoSigner } from 'lumenjoule-sdk';

const signer = new KeypoSigner({
  keyLabel: 'my-agent-key',
  publicKey: Buffer.from('BASE64_PUB_KEY', 'base64'),
});

const client = new SmartWalletClient({
  signer,
  walletAddress: 'CXXX...',
});`}</code>
            </pre>

            <h3 className="text-lg text-gray-200 mt-6 mb-2">Option C: Software P-256 (Dev / Windows / Linux)</h3>
            <p className="text-sm text-gray-400 mb-3">
              Software ECDSA P-256 for development. Same signing format as Secure Enclave, stored encrypted on disk.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient, SoftP256Signer } from 'lumenjoule-sdk';

// First time: generate key
const signer = await SoftP256Signer.generate('password');

// Later: load key
const signer = await SoftP256Signer.load('password');

const client = new SmartWalletClient({ signer, walletAddress: 'CXXX...' });`}</code>
            </pre>
          </section>

          {/* Chat */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Make Inference Requests</h2>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`const response = await client.chat({
  model: 'meta-llama/Llama-3.3-70B-Instruct',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing briefly.' },
  ],
  max_tokens: 200,
});

console.log(response.choices[0].message.content);
console.log('TX:', response._payment.transaction);
console.log('Cost:', response._payment.amountPaid);`}</code>
            </pre>
            <p className="text-sm text-gray-500 mt-2">
              The SDK automatically handles the x402 payment dance: request &rarr; 402 &rarr; build payment &rarr; retry with payment header.
            </p>
          </section>

          {/* Spend Policies */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Spend Policies</h2>
            <p className="text-sm text-gray-400 mb-3">
              Each agent signer is gated by an on-chain ExternalValidatorPolicy that enforces daily USDC spending limits.
              The policy is checked during <code>__check_auth</code> on every transfer and approval.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-lg font-bold text-white">$50/day</div>
                <div className="text-xs text-gray-500 mt-1">Starter</div>
                <code className="text-[10px] text-gray-600 mt-2 block break-all">CBRGH27Z...TTQAEC</code>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-lg font-bold text-white">$500/day</div>
                <div className="text-xs text-gray-500 mt-1">Production</div>
                <code className="text-[10px] text-gray-600 mt-2 block break-all">CCRIFGLM...MDIZNJ</code>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-lg font-bold text-white">$2,000/day</div>
                <div className="text-xs text-gray-500 mt-1">Enterprise</div>
                <code className="text-[10px] text-gray-600 mt-2 block break-all">CCSPAXNE...OJS5H2</code>
              </div>
            </div>

            <h3 className="text-lg text-gray-200 mt-6 mb-2">Query Budget</h3>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`const budget = await client.budgetStatus();
console.log('Daily limit:', budget.dailyLimitUsdc);
console.log('Spent today:', budget.spentTodayUsdc);
console.log('Remaining:',   budget.remainingUsdc);`}</code>
            </pre>
          </section>

          {/* x402 */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">x402 Payment Protocol</h2>
            <p className="text-sm text-gray-400 mb-3">
              The SDK implements the <a href="https://x402.org" target="_blank" rel="noopener" className="text-blue-400 hover:underline">x402</a> payment
              protocol for Stellar. Compatible with both the LumenBro facilitator and the{" "}
              <a href="https://www.openzeppelin.com/" target="_blank" rel="noopener" className="text-blue-400 hover:underline">OpenZeppelin</a> facilitator.
            </p>
            <div className="bg-gray-800 rounded-lg p-4 text-sm space-y-1">
              <div><span className="text-gray-500">1.</span> Agent sends request to compute server</div>
              <div><span className="text-gray-500">2.</span> Server returns <code className="text-yellow-400">402</code> with payment requirements</div>
              <div><span className="text-gray-500">3.</span> SDK builds transfer TX + pre-signs auth with agent key</div>
              <div><span className="text-gray-500">4.</span> SDK retries with <code className="text-yellow-400">X-Payment</code> + <code className="text-yellow-400">PAYMENT-SIGNATURE</code> headers</div>
              <div><span className="text-gray-500">5.</span> Facilitator verifies, sponsors gas, submits on-chain</div>
              <div><span className="text-gray-500">6.</span> Server returns inference result</div>
            </div>
          </section>

          {/* API Reference */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Compute Server API</h2>
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-lg p-4">
                <code className="text-green-400">POST /api/v1/chat/completions</code>
                <p className="text-sm text-gray-400 mt-1">OpenAI-compatible chat completion (x402 payment required)</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <code className="text-green-400">GET /api/models</code>
                <p className="text-sm text-gray-400 mt-1">List available models and pricing</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Base URL: <code>https://compute.lumenbro.com</code>
            </p>
          </section>

          {/* Links */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Resources</h2>
            <ul className="space-y-2 text-sm">
              <li><a href="https://github.com/lumenbro/lumenjoule-sdk" target="_blank" rel="noopener" className="text-blue-400 hover:underline">SDK on GitHub</a></li>
              <li><a href="https://www.npmjs.com/package/lumenjoule-sdk" target="_blank" rel="noopener" className="text-blue-400 hover:underline">SDK on npm</a></li>
              <li><a href="https://joule.lumenbro.com" target="_blank" rel="noopener" className="text-blue-400 hover:underline">LumenJoule Token</a></li>
              <li><a href="https://x402.org" target="_blank" rel="noopener" className="text-blue-400 hover:underline">x402 Protocol Spec</a></li>
              <li><a href="https://stellar.expert/explorer/public/contract/CBVWPBYEDJ7GYIUHL2HITMEEWM75WAMFINIQCR4ZAFZ62ISDFBVERQCX" target="_blank" rel="noopener" className="text-blue-400 hover:underline">LumenJoule on StellarExpert</a></li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
