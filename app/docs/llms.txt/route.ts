import { NextResponse } from 'next/server';

const DOCS_TEXT = `# LumenBro Agent Wallet SDK (lumenjoule-sdk)
> Self-custodial AI agent wallets on Stellar with on-chain spend policies and x402 payments.
> npm: https://www.npmjs.com/package/lumenjoule-sdk
> GitHub: https://github.com/lumenbro/lumenjoule-sdk
> Portal: https://agents.lumenbro.com
> Docs: https://agents.lumenbro.com/docs

## Overview

lumenjoule-sdk gives AI agents self-custodial wallets on Stellar. The SDK handles x402 payments automatically — your agent calls any x402-enabled API, the SDK detects the 402, signs a payment from the smart wallet, and retries. No API keys, no custodians, no seed phrases.

1. Create a wallet at agents.lumenbro.com — deploys a Stellar smart account (C-address) secured by your passkey
2. Register an agent signer — Ed25519 keypair or P-256 key, each gated by a daily spend policy
3. Fund with USDC — send USDC to your wallet's C-address
4. Install SDK — npm install lumenjoule-sdk, call client.chat(), done

Agent keys only sign auth entries (not TX envelopes). The facilitator pays gas. Agent keys never need XLM funding for x402 payments.

## Install

npm install lumenjoule-sdk

## Quick Start

\`\`\`typescript
import { SmartWalletClient } from "lumenjoule-sdk";

const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET,  // S... key from portal
  walletAddress: "CXXX...",                   // your wallet C-address
  network: "mainnet",
});

const response = await client.chat({
  model: "deepseek-ai/DeepSeek-V3",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
\`\`\`

## Smart Wallet Architecture

Each wallet is a Stellar smart account (C-address) that acts as a shared vault. Multiple agent signers draw from the same balance, each with independent daily limits.

Smart Wallet (C-address)
├── Holds USDC (pooled balance)
├── Owner: your passkey (full control, can pause/revoke)
├── Agent Signer #1 (Ed25519) — Spend Policy: $50/day
├── Agent Signer #2 (P-256 Secure Enclave) — Spend Policy: $500/day
└── Agent Signer #3 (P-256 Software Key) — Spend Policy: $2,000/day

- C-address (Vault): Holds all funds. Every transfer is gated by __check_auth which validates the signer's key + spend policy.
- Agent Signers: Delegated signing keys registered on the wallet. Like corporate cards — one funding account, multiple cards with individual limits.
- Spend Policies: On-chain ExternalValidatorPolicy contracts that enforce daily USDC limits on transfer() and approve().

## Signer Types

Three signer implementations, same smart wallet:

| Signer          | Platform | Key Storage                      | Best For                         |
|-----------------|----------|----------------------------------|----------------------------------|
| Ed25519         | All      | Secret key string (S...)         | Simplest setup, any platform     |
| SoftP256Signer  | All      | Encrypted file (~/.lumenjoule/)  | Linux VPS, cloud servers, dev    |
| KeypoSigner     | macOS    | Secure Enclave (hardware)        | Maximum security, Mac Mini       |

### Ed25519 — Stellar Keypair (Any Platform)

\`\`\`typescript
import { SmartWalletClient } from "lumenjoule-sdk";

const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET,   // S... secret key
  walletAddress: "CXXX...",
  network: "mainnet",
});
\`\`\`

### SoftP256Signer — Software P-256 (Any Platform)

Encrypted P-256 key stored on disk. Same signing format as Secure Enclave. AES-256-GCM encryption with PBKDF2-derived key.

\`\`\`typescript
import { SmartWalletClient, SoftP256Signer } from "lumenjoule-sdk";

// First time: generate and save encrypted key
const signer = await SoftP256Signer.generate("my-password");
// Saved to: ~/.lumenjoule/agent-key.enc

// After: load existing key
const signer = await SoftP256Signer.load("my-password");

const client = new SmartWalletClient({
  signer,
  walletAddress: "CXXX...",
  network: "mainnet",
});
\`\`\`

### KeypoSigner — Secure Enclave (macOS)

Hardware-bound P-256 key via keypo-signer. Private key never leaves the Secure Enclave.
Install: brew install keypo-signer

\`\`\`typescript
import { SmartWalletClient, KeypoSigner } from "lumenjoule-sdk";

const signer = new KeypoSigner({
  keyLabel: "my-agent-key",
  publicKey: Buffer.from("BASE64_PUBLIC_KEY", "base64"),
});

const client = new SmartWalletClient({
  signer,
  walletAddress: "CXXX...",
  network: "mainnet",
});
\`\`\`

## Pay Any x402 Endpoint

The wallet works with any x402-compatible endpoint, not just LumenBro compute.

\`\`\`typescript
// AI inference (OpenAI-compatible)
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
const txHash = await client.transfer(USDC_CONTRACT, recipientAddress, 1_000_000n);
\`\`\`

## Spend Policies

Every agent signer is gated by an on-chain ExternalValidatorPolicy contract. Even if a key is compromised, damage is capped.

| Tier        | Daily Limit | Contract Address                                              |
|-------------|-------------|---------------------------------------------------------------|
| Starter     | $50/day     | CBRGH27ZFVFDIHYKC4K3CSLKXHQSR5CFG2PLPZ2M37NH4PYBOBTTQAEC    |
| Production  | $500/day    | CCRIFGLMG3PT7R3V2IFSRNDNKR2Y2DLJAI5KXYBKNJPFCL2QC4MDIZNJ    |
| Enterprise  | $2,000/day  | CCSPAXNEVBNA5QAEU2YEUTU56O5KOZM4C2O7ONQ6GFPSHEWV5OJJS5H2    |

Query budget:

\`\`\`typescript
const client = new SmartWalletClient({
  agentSecretKey: process.env.AGENT_SECRET,
  walletAddress: "CXXX...",
  policyAddress: "CBRGH27Z...",  // Starter tier
});

const budget = await client.budgetStatus();
// { dailyLimitUsdc: 50, spentTodayUsdc: 3.20, remainingUsdc: 46.80 }
\`\`\`

## x402 Payment Protocol

The SDK implements the x402 (https://x402.org) payment protocol for Stellar. Compatible with both LumenBro and OpenZeppelin facilitators.

1. Agent sends request to x402-enabled API
2. Server returns 402 Payment Required with price, asset, and destination
3. SDK builds USDC transfer from smart wallet + signs auth with agent key
4. SDK retries with PAYMENT-SIGNATURE header (v2) + X-Payment (v1 compat)
5. Facilitator verifies signature, sponsors gas, submits on-chain (~5s finality)
6. Server confirms settlement, returns the response

The facilitator is a neutral relay — it doesn't need to understand smart wallets or signer types. It receives pre-signed auth entries, rebuilds the TX, and submits. The Soroban runtime calls __check_auth on your wallet contract transparently.

## API Reference — SmartWalletClient

### Constructor Options

| Option          | Type                      | Default              | Description                              |
|-----------------|---------------------------|----------------------|------------------------------------------|
| walletAddress   | string                    | required             | Smart wallet C-address                   |
| agentSecretKey  | string                    | —                    | Ed25519 secret key (S...)                |
| signer          | AgentSigner               | —                    | Pluggable signer (alt to agentSecretKey) |
| network         | "testnet" | "mainnet"     | "mainnet"            | Stellar network                          |
| computeUrl      | string                    | compute.lumenbro.com | Default x402 endpoint for chat()         |
| rpcUrl          | string                    | auto                 | Custom Soroban RPC URL                   |
| policyAddress   | string                    | —                    | Spend policy contract (budget queries)   |
| preferredAsset  | string                    | USDC                 | Payment asset contract                   |

### Methods

| Method                        | Description                                                      |
|-------------------------------|------------------------------------------------------------------|
| chat(request)                 | OpenAI-compatible chat with automatic x402 payment               |
| payAndFetch(url, init?)       | Pay any x402 endpoint and return the response                    |
| transfer(token, to, amount)   | Direct token transfer (Ed25519 only, agent pays gas)             |
| usdcBalance()                 | USDC balance of the wallet (7-decimal stroops)                   |
| balance(token?)               | Any token balance (defaults to LumenJoule)                       |
| gasBalance()                  | XLM balance of the wallet                                        |
| budgetStatus()                | Daily limit, spent today, remaining (requires policyAddress)     |
| dailyLimit()                  | Policy daily limit in stroops                                    |
| spentToday()                  | Amount spent today in stroops                                    |
| remaining()                   | Remaining daily budget in stroops                                |

### x402 Protocol Helpers

\`\`\`typescript
import { parsePaymentRequirements, performX402Dance } from "lumenjoule-sdk";

// Parse 402 response headers
const requirements = parsePaymentRequirements(response);

// Full dance: request -> 402 -> build payment -> retry
const paidResponse = await performX402Dance(url, init, buildPaymentFn);
\`\`\`

## Compute Server API

Default x402 endpoint for client.chat(). OpenAI-compatible, accepts USDC payments via x402.

Base URL: https://compute.lumenbro.com

- POST /v1/chat/completions — OpenAI-compatible chat completion (returns 402 first)
- GET /api/models — List available models and per-token pricing

You can point computeUrl to any x402-compatible inference server. The wallet is not locked to LumenBro compute.

## Self-Custody

Your agent's signing key lives on your device. The server never touches private keys — it only wraps transactions for gas sponsorship.

| Provider          | Key Model                            | Self-Custodial? |
|-------------------|--------------------------------------|-----------------|
| lumenjoule-sdk    | Device-local (SE, passkey, enc file) | Yes             |
| Privy             | MPC sharded (server holds share)     | No              |
| Crossmint         | API key custodial                    | No              |
| Turnkey           | Infra-managed HSM                    | No              |
| Coinbase AgentKit | CDP API key                          | No              |

If your wallet provider goes down or changes terms, your agent's wallet should still work. With self-custody, it does.

## FAQ

Q: Does my agent key need XLM?
A: No. For x402 payments, the facilitator pays gas. Agent keys only sign auth entries. Only direct transfer() calls require XLM.

Q: What happens if my agent key is compromised?
A: Damage is capped by the on-chain spend policy (e.g., $50/day on Starter). You can revoke the signer from the dashboard using your passkey.

Q: Can I use this with my own inference server?
A: Yes. Set computeUrl to your server, or use payAndFetch() for any x402-compatible endpoint.

Q: Which signer should I use on a Linux VPS?
A: SoftP256Signer with an encrypted key file, or Ed25519 for simplicity. The spend policy is your primary security layer.

Q: Can multiple agents share one wallet?
A: Yes. One wallet C-address holds pooled USDC. Each agent signer has its own key and independent daily limit.

Q: What's the difference between Ed25519 and P-256?
A: Ed25519 is native Stellar — simple and widely supported. P-256 (secp256r1) is the curve used by Secure Enclave, TPM, and WebAuthn passkeys — it enables hardware-bound keys that can never be extracted. Both produce the same auth format.

Q: How do I upgrade my spend policy tier?
A: Revoke the existing signer from the dashboard, then re-register the same key with a higher-tier policy. Automated tier upgrades coming soon.

## Contract Addresses (Mainnet)

- USDC SAC: CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
- LumenJoule SAC: CBVWPBYEDJ7GYIUHL2HITMEEWM75WAMFINIQCR4ZAFZ62ISDFBVERQCX
- Starter Policy ($50/day): CBRGH27ZFVFDIHYKC4K3CSLKXHQSR5CFG2PLPZ2M37NH4PYBOBTTQAEC
- Production Policy ($500/day): CCRIFGLMG3PT7R3V2IFSRNDNKR2Y2DLJAI5KXYBKNJPFCL2QC4MDIZNJ
- Enterprise Policy ($2,000/day): CCSPAXNEVBNA5QAEU2YEUTU56O5KOZM4C2O7ONQ6GFPSHEWV5OJJS5H2

## Links

- Portal: https://agents.lumenbro.com
- npm: https://www.npmjs.com/package/lumenjoule-sdk
- GitHub: https://github.com/lumenbro/lumenjoule-sdk
- x402 Protocol: https://x402.org
- LumenJoule Token: https://joule.lumenbro.com
- Stellar: https://stellar.org
`;

export async function GET() {
  return new NextResponse(DOCS_TEXT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
