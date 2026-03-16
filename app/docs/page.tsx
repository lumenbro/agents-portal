import { WalletArchitectureDiagram } from '@/components/docs/wallet-architecture-diagram';

export const metadata = {
  title: 'Documentation — LumenBro Agents',
  description: 'Smart wallet SDK documentation for AI agents on Stellar. Self-custodial x402 payments with on-chain spend policies.',
};

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="LumenBro" className="w-8 h-8 rounded-lg" />
            <span className="text-lg font-semibold text-white">LumenBro Agents</span>
          </a>
          <span className="text-gray-600 mx-2">/</span>
          <span className="text-gray-400">Documentation</span>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <a href="/dashboard" className="text-gray-500 hover:text-white transition-colors">Dashboard</a>
            <a href="https://www.npmjs.com/package/lumenjoule-sdk" target="_blank" rel="noopener" className="text-gray-500 hover:text-white transition-colors">npm</a>
            <a href="https://github.com/lumenbro/lumenjoule-sdk" target="_blank" rel="noopener" className="text-gray-500 hover:text-white transition-colors">GitHub</a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Agent Wallet SDK</h1>
        <p className="text-gray-400 mb-4">
          Give your AI agent a self-custodial wallet with on-chain spend limits. The SDK handles x402 payments automatically.
        </p>
        <p className="text-xs text-gray-600 mb-10">
          Machine-readable version: <a href="/llms.txt" className="text-blue-400 hover:underline">/llms.txt</a>
        </p>

        {/* Table of contents */}
        <nav className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-12">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Contents</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
            <a href="#overview" className="text-blue-400 hover:underline">Overview</a>
            <a href="#spend-policies" className="text-blue-400 hover:underline">Spend Policies</a>
            <a href="#architecture" className="text-blue-400 hover:underline">Smart Wallet Architecture</a>
            <a href="#x402" className="text-blue-400 hover:underline">x402 Payment Protocol</a>
            <a href="#quickstart" className="text-blue-400 hover:underline">Quick Start</a>
            <a href="#api-reference" className="text-blue-400 hover:underline">API Reference</a>
            <a href="#signers" className="text-blue-400 hover:underline">Signer Types</a>
            <a href="#self-custody" className="text-blue-400 hover:underline">Self-Custody</a>
            <a href="#pay-any-endpoint" className="text-blue-400 hover:underline">Pay Any x402 Endpoint</a>
            <a href="#faq" className="text-blue-400 hover:underline">FAQ</a>
          </div>
        </nav>

        <div className="prose prose-invert max-w-none space-y-14">

          {/* ===== OVERVIEW ===== */}
          <section id="overview">
            <h2 className="text-xl font-semibold text-white mb-3">Overview</h2>
            <p className="text-sm text-gray-400 mb-4">
              LumenBro Agents gives AI agents self-custodial wallets on Stellar. Your agent calls any x402-enabled API, the SDK detects the 402, signs a payment from the smart wallet, and retries. No API keys, no custodians, no seed phrases.
            </p>
            <ol className="list-decimal pl-6 space-y-2 text-sm">
              <li><strong className="text-white">Create a wallet</strong> at <a href="/" className="text-blue-400 hover:underline">agents.lumenbro.com</a> &mdash; deploys a Stellar smart account (C-address) secured by your passkey</li>
              <li><strong className="text-white">Register an agent signer</strong> &mdash; Ed25519 keypair or P-256 key, each gated by a daily spend policy</li>
              <li><strong className="text-white">Fund with USDC</strong> &mdash; send USDC to your wallet&apos;s C-address</li>
              <li><strong className="text-white">Use the SDK</strong> &mdash; <code>npm install lumenjoule-sdk</code>, call <code>client.chat()</code>, done</li>
            </ol>
            <p className="text-xs text-gray-500 mt-4">
              Agent keys only sign auth entries (not TX envelopes). The facilitator pays gas and submits the transaction.
              Agent keys never need XLM funding for x402 payments.
            </p>
          </section>

          {/* ===== ARCHITECTURE ===== */}
          <section id="architecture">
            <h2 className="text-xl font-semibold text-white mb-3">Smart Wallet Architecture</h2>
            <p className="text-sm text-gray-400 mb-4">
              Each wallet is a Stellar smart account (C-address) that acts as a shared vault. Multiple agent signers draw from the same balance, each with independent daily limits.
            </p>

            {/* Interactive SVG Diagram */}
            <div className="my-6">
              <WalletArchitectureDiagram />
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h4 className="text-white font-medium mb-1">C-address (Vault)</h4>
                <p className="text-gray-400 text-xs">
                  The smart account that holds all funds. Every transfer is gated by <code>__check_auth</code> which validates the signer&apos;s key + spend policy before allowing the transaction.
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h4 className="text-white font-medium mb-1">Agent Signers</h4>
                <p className="text-gray-400 text-xs">
                  Delegated signing keys registered on the wallet. Each signer has its own key type (Ed25519 or Secp256r1) and is bound to a spend policy contract. Like corporate cards &mdash; one funding account, multiple cards with individual limits.
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <h4 className="text-white font-medium mb-1">Spend Policies</h4>
                <p className="text-gray-400 text-xs">
                  On-chain ExternalValidatorPolicy contracts that enforce daily USDC limits. Checked on every <code>transfer()</code> and <code>approve()</code>. Even if a key is compromised, damage is capped to one day&apos;s limit.
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-4">
              Smart account contract source: <a href="https://github.com/lumenbro/stellar-smart-account" target="_blank" rel="noopener" className="text-blue-400 hover:underline">github.com/lumenbro/stellar-smart-account</a>
              {" "}&middot;{" "}
              Spend policy source: <a href="https://github.com/lumenbro/soroban-policies" target="_blank" rel="noopener" className="text-blue-400 hover:underline">github.com/lumenbro/soroban-policies</a>
            </p>
          </section>

          {/* ===== QUICK START ===== */}
          <section id="quickstart">
            <h2 className="text-xl font-semibold text-white mb-3">Quick Start</h2>

            <h3 className="text-lg text-gray-200 mt-4 mb-2">1. Install</h3>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>npm install lumenjoule-sdk</code>
            </pre>
            <p className="text-xs text-gray-500 mt-2">
              Create a wallet at <a href="/" className="text-blue-400 hover:underline">agents.lumenbro.com</a> if you haven&apos;t already.
            </p>

            <h3 className="text-lg text-gray-200 mt-6 mb-2">2. Configure</h3>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient } from "lumenjoule-sdk";

const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET,  // S... key from portal
  walletAddress: "CXXX...",                   // your wallet C-address
  network: "mainnet",
});`}</code>
            </pre>

            <h3 className="text-lg text-gray-200 mt-6 mb-2">3. Use</h3>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`const response = await client.chat({
  model: "deepseek-ai/DeepSeek-V3",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);`}</code>
            </pre>
            <p className="text-sm text-gray-500 mt-2">
              The SDK handles the x402 payment automatically: request &rarr; 402 &rarr; sign payment &rarr; retry &rarr; response.
            </p>
          </section>

          {/* ===== SIGNER TYPES ===== */}
          <section id="signers">
            <h2 className="text-xl font-semibold text-white mb-3">Signer Types</h2>
            <p className="text-sm text-gray-400 mb-4">
              Three signer implementations, same smart wallet. Pick based on your platform and security requirements.
            </p>

            {/* Signer comparison table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left">
                    <th className="py-2 pr-4 text-gray-400 font-medium">Signer</th>
                    <th className="py-2 pr-4 text-gray-400 font-medium">Platform</th>
                    <th className="py-2 pr-4 text-gray-400 font-medium">Key Storage</th>
                    <th className="py-2 text-gray-400 font-medium">Best For</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code className="text-blue-400">Ed25519</code></td>
                    <td className="py-2 pr-4">All</td>
                    <td className="py-2 pr-4">Secret key string (S...)</td>
                    <td className="py-2">Simplest setup, any platform</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code className="text-green-400">SoftP256Signer</code></td>
                    <td className="py-2 pr-4">All</td>
                    <td className="py-2 pr-4">Encrypted file (~/.lumenjoule/)</td>
                    <td className="py-2">Linux VPS, cloud servers, dev</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code className="text-purple-400">KeypoSigner</code></td>
                    <td className="py-2 pr-4">macOS</td>
                    <td className="py-2 pr-4">Secure Enclave (hardware)</td>
                    <td className="py-2">Maximum security, Mac Mini</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Ed25519 */}
            <h3 className="text-lg text-gray-200 mt-6 mb-2">Ed25519 &mdash; Stellar Keypair (Any Platform)</h3>
            <p className="text-sm text-gray-400 mb-3">
              The simplest option. Generate a Stellar keypair, register the public key (G-address) as an agent signer in the portal, and pass the secret key to the SDK.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient } from "lumenjoule-sdk";

const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET,   // S... secret key
  walletAddress: "CXXX...",                    // wallet C-address
  network: "mainnet",
});`}</code>
            </pre>

            {/* SoftP256 */}
            <h3 className="text-lg text-gray-200 mt-8 mb-2">SoftP256Signer &mdash; Software P-256 (Any Platform)</h3>
            <p className="text-sm text-gray-400 mb-3">
              Encrypted P-256 key stored on disk. Same signing format as Secure Enclave &mdash; production-ready on Linux VPS, Windows, macOS. AES-256-GCM encryption with PBKDF2-derived key.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient, SoftP256Signer } from "lumenjoule-sdk";

// First time: generate and save encrypted key
const signer = await SoftP256Signer.generate("my-password");
// Saved to: ~/.lumenjoule/agent-key.enc
// Prints: public key (paste into portal when registering Secp256r1 signer)

// After: load existing key
const signer = await SoftP256Signer.load("my-password");

const client = new SmartWalletClient({
  signer,
  walletAddress: "CXXX...",
  network: "mainnet",
});`}</code>
            </pre>

            {/* KeypoSigner */}
            <h3 className="text-lg text-gray-200 mt-8 mb-2">KeypoSigner &mdash; Secure Enclave (macOS)</h3>
            <p className="text-sm text-gray-400 mb-3">
              Hardware-bound P-256 key via <a href="https://github.com/keypo-us/keypo-cli" target="_blank" rel="noopener" className="text-blue-400 hover:underline">keypo-signer</a>. The private key lives in the Secure Enclave and can never be extracted. Install: <code>brew install keypo-signer</code>.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { SmartWalletClient, KeypoSigner } from "lumenjoule-sdk";

const signer = new KeypoSigner({
  keyLabel: "my-agent-key",
  publicKey: Buffer.from("BASE64_PUBLIC_KEY", "base64"),
});

const client = new SmartWalletClient({
  signer,
  walletAddress: "CXXX...",
  network: "mainnet",
});`}</code>
            </pre>
          </section>

          {/* ===== PAY ANY ENDPOINT ===== */}
          <section id="pay-any-endpoint">
            <h2 className="text-xl font-semibold text-white mb-3">Pay Any x402 Endpoint</h2>
            <p className="text-sm text-gray-400 mb-4">
              The wallet isn&apos;t limited to one service. <code>payAndFetch()</code> works with any x402-compatible endpoint on any server. <code>chat()</code> is a convenience wrapper for OpenAI-compatible inference APIs.
            </p>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`// AI inference (OpenAI-compatible)
const response = await client.chat({
  model: "deepseek-ai/DeepSeek-V3",
  messages: [{ role: "user", content: "Analyze this data" }],
});

// Any x402 endpoint
const data = await client.payAndFetch("https://some-api.com/v1/data", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "..." }),
});

// Direct USDC transfer (non-x402, agent pays gas)
const txHash = await client.transfer(
  USDC_CONTRACT,
  recipientAddress,
  1_000_000n,  // 0.1 USDC (7 decimals)
);`}</code>
            </pre>
          </section>

          {/* ===== SPEND POLICIES ===== */}
          <section id="spend-policies">
            <h2 className="text-xl font-semibold text-white mb-3">Spend Policies</h2>
            <p className="text-sm text-gray-400 mb-3">
              Every agent signer is gated by an on-chain ExternalValidatorPolicy contract. The policy is enforced during <code>__check_auth</code> on every transfer and approval. Even if a key is compromised, damage is capped.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">Starter</div>
                <div className="text-2xl font-bold text-white">$50</div>
                <div className="text-xs text-gray-500">per day</div>
                <code className="text-[10px] text-gray-600 mt-2 block break-all">CBRGH27ZFVFDIHYKC4K3CSLKXHQSR5CFG2PLPZ2M37NH4PYBOBTTQAEC</code>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">Production</div>
                <div className="text-2xl font-bold text-white">$500</div>
                <div className="text-xs text-gray-500">per day</div>
                <code className="text-[10px] text-gray-600 mt-2 block break-all">CCRIFGLMG3PT7R3V2IFSRNDNKR2Y2DLJAI5KXYBKNJPFCL2QC4MDIZNJ</code>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">Enterprise</div>
                <div className="text-2xl font-bold text-white">$2,000</div>
                <div className="text-xs text-gray-500">per day</div>
                <code className="text-[10px] text-gray-600 mt-2 block break-all">CCSPAXNEVBNA5QAEU2YEUTU56O5KOZM4C2O7ONQ6GFPSHEWV5OJJS5H2</code>
              </div>
            </div>

            <h3 className="text-lg text-gray-200 mt-6 mb-2">Query Budget</h3>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`// Requires policyAddress in constructor
const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET,
  walletAddress: "CXXX...",
  policyAddress: "CBRGH27Z...",  // Starter tier
});

const budget = await client.budgetStatus();
// { dailyLimitUsdc: 50, spentTodayUsdc: 3.20, remainingUsdc: 46.80 }

// Individual queries
const limit     = await client.dailyLimit();    // 500_000_000n (stroops)
const spent     = await client.spentToday();    // 32_000_000n
const remaining = await client.remaining();     // 468_000_000n`}</code>
            </pre>
          </section>

          {/* ===== X402 PROTOCOL ===== */}
          <section id="x402">
            <h2 className="text-xl font-semibold text-white mb-3">x402 Payment Protocol</h2>
            <p className="text-sm text-gray-400 mb-3">
              The SDK implements the <a href="https://x402.org" target="_blank" rel="noopener" className="text-blue-400 hover:underline">x402</a> payment
              protocol for Stellar. Compatible with both the LumenBro facilitator and the{" "}
              <a href="https://www.openzeppelin.com/" target="_blank" rel="noopener" className="text-blue-400 hover:underline">OpenZeppelin</a> Stellar facilitator.
            </p>
            <div className="bg-gray-800 rounded-lg p-5 text-sm space-y-2">
              <div className="flex gap-3"><span className="text-gray-500 w-5 text-right shrink-0">1.</span><span>Agent sends request to x402-enabled API</span></div>
              <div className="flex gap-3"><span className="text-gray-500 w-5 text-right shrink-0">2.</span><span>Server returns <code className="text-yellow-400">402 Payment Required</code> with price, asset, and destination</span></div>
              <div className="flex gap-3"><span className="text-gray-500 w-5 text-right shrink-0">3.</span><span>SDK builds USDC transfer from smart wallet + signs auth with agent key</span></div>
              <div className="flex gap-3"><span className="text-gray-500 w-5 text-right shrink-0">4.</span><span>SDK retries with <code className="text-yellow-400">PAYMENT-SIGNATURE</code> header (v2) + <code className="text-yellow-400">X-Payment</code> (v1 compat)</span></div>
              <div className="flex gap-3"><span className="text-gray-500 w-5 text-right shrink-0">5.</span><span>Facilitator verifies signature, sponsors gas, submits on-chain (~5s finality)</span></div>
              <div className="flex gap-3"><span className="text-gray-500 w-5 text-right shrink-0">6.</span><span>Server confirms settlement, returns the response</span></div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              The facilitator is a neutral relay &mdash; it doesn&apos;t need to understand smart wallets or signer types. It receives pre-signed auth entries, rebuilds the TX, and submits. The Soroban runtime calls <code>__check_auth</code> on your wallet contract transparently.
            </p>
          </section>

          {/* ===== API REFERENCE ===== */}
          <section id="api-reference">
            <h2 className="text-xl font-semibold text-white mb-3">API Reference</h2>

            <h3 className="text-lg text-gray-200 mt-4 mb-3">SmartWalletClient Constructor</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left">
                    <th className="py-2 pr-4 text-gray-400 font-medium">Option</th>
                    <th className="py-2 pr-4 text-gray-400 font-medium">Type</th>
                    <th className="py-2 pr-4 text-gray-400 font-medium">Default</th>
                    <th className="py-2 text-gray-400 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>walletAddress</code></td>
                    <td className="py-2 pr-4"><code>string</code></td>
                    <td className="py-2 pr-4 text-gray-500">required</td>
                    <td className="py-2">Smart wallet C-address</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>agentSecretKey</code></td>
                    <td className="py-2 pr-4"><code>string</code></td>
                    <td className="py-2 pr-4 text-gray-500">&mdash;</td>
                    <td className="py-2">Ed25519 secret key (S...)</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>signer</code></td>
                    <td className="py-2 pr-4"><code>AgentSigner</code></td>
                    <td className="py-2 pr-4 text-gray-500">&mdash;</td>
                    <td className="py-2">Pluggable signer (alternative to agentSecretKey)</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>network</code></td>
                    <td className="py-2 pr-4"><code>&quot;testnet&quot; | &quot;mainnet&quot;</code></td>
                    <td className="py-2 pr-4 text-gray-500">&quot;mainnet&quot;</td>
                    <td className="py-2">Stellar network</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>computeUrl</code></td>
                    <td className="py-2 pr-4"><code>string</code></td>
                    <td className="py-2 pr-4 text-gray-500">compute.lumenbro.com</td>
                    <td className="py-2">Default x402 endpoint for chat()</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>rpcUrl</code></td>
                    <td className="py-2 pr-4"><code>string</code></td>
                    <td className="py-2 pr-4 text-gray-500">auto</td>
                    <td className="py-2">Custom Soroban RPC URL</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>policyAddress</code></td>
                    <td className="py-2 pr-4"><code>string</code></td>
                    <td className="py-2 pr-4 text-gray-500">&mdash;</td>
                    <td className="py-2">Spend policy contract (for budget queries)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code>preferredAsset</code></td>
                    <td className="py-2 pr-4"><code>string</code></td>
                    <td className="py-2 pr-4 text-gray-500">USDC</td>
                    <td className="py-2">Payment asset contract</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg text-gray-200 mt-8 mb-3">Methods</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left">
                    <th className="py-2 pr-4 text-gray-400 font-medium">Method</th>
                    <th className="py-2 text-gray-400 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>chat(request)</code></td>
                    <td className="py-2">OpenAI-compatible chat completion with automatic x402 payment</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>payAndFetch(url, init?)</code></td>
                    <td className="py-2">Pay any x402 endpoint and return the response</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>transfer(token, to, amount)</code></td>
                    <td className="py-2">Direct token transfer (Ed25519 only, agent pays gas)</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>usdcBalance()</code></td>
                    <td className="py-2">USDC balance of the wallet (7-decimal stroops)</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>balance(token?)</code></td>
                    <td className="py-2">Any token balance (defaults to LumenJoule)</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>gasBalance()</code></td>
                    <td className="py-2">XLM balance of the wallet</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>budgetStatus()</code></td>
                    <td className="py-2">Daily limit, spent today, remaining (requires policyAddress)</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>dailyLimit()</code></td>
                    <td className="py-2">Policy daily limit in stroops</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4"><code>spentToday()</code></td>
                    <td className="py-2">Amount spent today in stroops</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code>remaining()</code></td>
                    <td className="py-2">Remaining daily budget in stroops</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg text-gray-200 mt-8 mb-3">x402 Protocol Helpers</h3>
            <pre className="bg-gray-800 rounded-lg p-4 text-sm overflow-x-auto">
              <code>{`import { parsePaymentRequirements, performX402Dance } from "lumenjoule-sdk";

// Parse 402 response headers
const requirements = parsePaymentRequirements(response);
// { scheme, payTo, amount, asset, network, maxTimeoutSeconds, ... }

// Full dance: request -> 402 -> build payment -> retry
const paidResponse = await performX402Dance(url, init, buildPaymentFn);`}</code>
            </pre>
          </section>

          {/* ===== COMPUTE SERVER ===== */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Compute Server API</h2>
            <p className="text-sm text-gray-400 mb-3">
              The default x402 endpoint for <code>client.chat()</code>. OpenAI-compatible, accepts USDC payments via x402.
            </p>
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-lg p-4">
                <code className="text-green-400">POST /v1/chat/completions</code>
                <p className="text-sm text-gray-400 mt-1">OpenAI-compatible chat completion. Returns 402 with payment requirements on first request.</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <code className="text-green-400">GET /api/models</code>
                <p className="text-sm text-gray-400 mt-1">List available models and per-token pricing</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Base URL: <code>https://compute.lumenbro.com</code>
            </p>
            <p className="text-xs text-gray-600 mt-1">
              You can point <code>computeUrl</code> to any x402-compatible inference server. The wallet is not locked to LumenBro compute.
            </p>
          </section>

          {/* ===== SELF CUSTODY ===== */}
          <section id="self-custody">
            <h2 className="text-xl font-semibold text-white mb-3">Why Self-Custody Matters</h2>
            <p className="text-sm text-gray-400 mb-4">
              Your agent&apos;s signing key lives on your device. The server never touches private keys &mdash; it only wraps transactions for gas sponsorship.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left">
                    <th className="py-2 pr-4 text-gray-400 font-medium">Provider</th>
                    <th className="py-2 pr-4 text-gray-400 font-medium">Key Model</th>
                    <th className="py-2 text-gray-400 font-medium">Self-Custodial?</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4 font-medium text-white">lumenjoule-sdk</td>
                    <td className="py-2 pr-4">Device-local (SE, passkey, encrypted file)</td>
                    <td className="py-2 text-green-400">Yes</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4">Privy</td>
                    <td className="py-2 pr-4">MPC sharded (server holds share)</td>
                    <td className="py-2 text-red-400">No</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4">Crossmint</td>
                    <td className="py-2 pr-4">API key custodial</td>
                    <td className="py-2 text-red-400">No</td>
                  </tr>
                  <tr className="border-b border-gray-800">
                    <td className="py-2 pr-4">Turnkey</td>
                    <td className="py-2 pr-4">Infra-managed HSM</td>
                    <td className="py-2 text-red-400">No</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Coinbase AgentKit</td>
                    <td className="py-2 pr-4">CDP API key</td>
                    <td className="py-2 text-red-400">No</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              If your wallet provider goes down or changes terms, your agent&apos;s wallet should still work. With self-custody, it does. The server is only a gas sponsor &mdash; it fee-bumps pre-signed transactions but never has access to your keys.
            </p>
          </section>

          {/* ===== FAQ ===== */}
          <section id="faq">
            <h2 className="text-xl font-semibold text-white mb-4">FAQ</h2>
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-medium text-white mb-1">Does my agent key need XLM?</h3>
                <p className="text-sm text-gray-400">
                  No. For x402 payments (the primary use case), the facilitator pays gas. Your agent key only signs auth entries, not TX envelopes. A freshly-created agent key can immediately start making x402 payments. Only direct <code>transfer()</code> calls require XLM on the agent&apos;s G-address.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white mb-1">What happens if my agent key is compromised?</h3>
                <p className="text-sm text-gray-400">
                  Damage is capped by the on-chain spend policy. If your agent is on the Starter tier, an attacker can drain at most $50 in one day. You can revoke the signer from the dashboard at any time using your passkey.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white mb-1">Can I use this with my own inference server?</h3>
                <p className="text-sm text-gray-400">
                  Yes. Set <code>computeUrl</code> to your server, or use <code>payAndFetch()</code> for any x402-compatible endpoint. The wallet is a general-purpose x402 payment wallet &mdash; it works with any service that speaks the protocol.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white mb-1">Which signer should I use on a Linux VPS?</h3>
                <p className="text-sm text-gray-400">
                  Use <code>SoftP256Signer</code> with an encrypted key file, or Ed25519 if you prefer simplicity. Cloud VPS providers don&apos;t expose hardware security modules. The spend policy is your primary security layer &mdash; it caps damage regardless of key custody method.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white mb-1">Can multiple agents share one wallet?</h3>
                <p className="text-sm text-gray-400">
                  Yes, that&apos;s the design. One wallet C-address holds pooled USDC. Each agent signer has its own key and independent daily limit. Like a corporate card program &mdash; one funding account, multiple cards.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white mb-1">What&apos;s the difference between Ed25519 and P-256?</h3>
                <p className="text-sm text-gray-400">
                  Ed25519 is the native Stellar key format &mdash; simple and widely supported. P-256 (secp256r1) is the curve used by Secure Enclave, TPM, and WebAuthn passkeys &mdash; it enables hardware-bound keys that can never be extracted. Both produce the same auth format from the smart wallet&apos;s perspective.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-white mb-1">How do I upgrade my spend policy tier?</h3>
                <p className="text-sm text-gray-400">
                  Revoke the existing signer from the dashboard, then re-register the same key with a higher-tier policy contract. Tier upgrades will be automated in a future portal update.
                </p>
              </div>
            </div>
          </section>

          {/* ===== RESOURCES ===== */}
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Resources</h2>
            <ul className="space-y-2 text-sm">
              <li><a href="/" className="text-blue-400 hover:underline">Agent Portal</a> &mdash; Create wallets + register agent signers</li>
              <li><a href="https://www.npmjs.com/package/lumenjoule-sdk" target="_blank" rel="noopener" className="text-blue-400 hover:underline">lumenjoule-sdk on npm</a></li>
              <li><a href="https://github.com/lumenbro/lumenjoule-sdk" target="_blank" rel="noopener" className="text-blue-400 hover:underline">SDK on GitHub</a></li>
              <li><a href="https://x402.org" target="_blank" rel="noopener" className="text-blue-400 hover:underline">x402 Protocol Specification</a></li>
              <li><a href="https://joule.lumenbro.com" target="_blank" rel="noopener" className="text-blue-400 hover:underline">LumenJoule Token</a></li>
              <li><a href="https://stellar.expert/explorer/public/contract/CBVWPBYEDJ7GYIUHL2HITMEEWM75WAMFINIQCR4ZAFZ62ISDFBVERQCX" target="_blank" rel="noopener" className="text-blue-400 hover:underline">LumenJoule on StellarExpert</a></li>
              <li><a href="https://stellar.org" target="_blank" rel="noopener" className="text-blue-400 hover:underline">Stellar</a></li>
            </ul>
          </section>

        </div>
      </main>

      <footer className="border-t border-gray-800 px-6 py-8 mt-12">
        <div className="max-w-4xl mx-auto text-center text-xs text-gray-600">
          <p>LumenBro Agents &mdash; Self-custodial AI agent wallets on Stellar</p>
          <p className="mt-1">
            <a href="/llms.txt" className="text-gray-500 hover:text-gray-400">llms.txt</a>
            {" "}&middot;{" "}
            <a href="https://github.com/lumenbro/lumenjoule-sdk" target="_blank" rel="noopener" className="text-gray-500 hover:text-gray-400">GitHub</a>
            {" "}&middot;{" "}
            <a href="https://x402.org" target="_blank" rel="noopener" className="text-gray-500 hover:text-gray-400">x402</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
