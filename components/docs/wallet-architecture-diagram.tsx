'use client';

export function WalletArchitectureDiagram() {
  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox="0 0 880 620"
        className="w-full min-w-[700px]"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Smart Wallet Architecture Diagram"
      >
        <defs>
          {/* Gradients */}
          <linearGradient id="vaultGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e3a5f" />
            <stop offset="100%" stopColor="#0f1f33" />
          </linearGradient>
          <linearGradient id="signerGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a3328" />
            <stop offset="100%" stopColor="#0f1f18" />
          </linearGradient>
          <linearGradient id="policyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b2518" />
            <stop offset="100%" stopColor="#1f1510" />
          </linearGradient>
          <linearGradient id="ownerGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d1f4e" />
            <stop offset="100%" stopColor="#1a1230" />
          </linearGradient>
          <linearGradient id="facilitatorGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f2937" />
            <stop offset="100%" stopColor="#111827" />
          </linearGradient>
          <linearGradient id="x402Grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1e40af" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>

          {/* Arrow marker */}
          <marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
          </marker>
          <marker id="arrowBlue" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
          </marker>
          <marker id="arrowGreen" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
          </marker>
          <marker id="arrowAmber" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
          </marker>
        </defs>

        {/* ====== BACKGROUND ====== */}
        <rect width="880" height="620" rx="12" fill="#030712" />

        {/* Title */}
        <text x="440" y="32" textAnchor="middle" fill="#e5e7eb" fontSize="16" fontWeight="bold" fontFamily="system-ui, sans-serif">
          Smart Wallet Architecture
        </text>
        <text x="440" y="50" textAnchor="middle" fill="#6b7280" fontSize="11" fontFamily="system-ui, sans-serif">
          One vault, multiple agents, independent spend limits
        </text>

        {/* ====== OWNER (top-left) ====== */}
        <rect x="30" y="75" width="170" height="80" rx="10" fill="url(#ownerGrad)" stroke="#7c3aed" strokeWidth="1.5" />
        {/* Lock icon */}
        <rect x="48" y="96" width="14" height="10" rx="2" fill="none" stroke="#a78bfa" strokeWidth="1.5" />
        <path d="M51 96 v-4 a4 4 0 0 1 8 0 v4" fill="none" stroke="#a78bfa" strokeWidth="1.5" />
        <text x="72" y="106" fill="#c4b5fd" fontSize="12" fontWeight="600" fontFamily="system-ui, sans-serif">Owner Passkey</text>
        <text x="48" y="124" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Secp256r1 (WebAuthn)</text>
        <text x="48" y="138" fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">Full control: pause, revoke, add</text>

        {/* Arrow: Owner → Vault */}
        <line x1="200" y1="115" x2="268" y2="175" stroke="#7c3aed" strokeWidth="1.5" markerEnd="url(#arrow)" strokeDasharray="6 3" />
        <text x="220" y="138" fill="#7c3aed" fontSize="9" fontFamily="system-ui, sans-serif" transform="rotate(25, 220, 138)">admin auth</text>

        {/* ====== SMART WALLET VAULT (center) ====== */}
        <rect x="270" y="75" width="340" height="155" rx="12" fill="url(#vaultGrad)" stroke="#3b82f6" strokeWidth="2" />
        {/* Vault header */}
        <text x="440" y="97" textAnchor="middle" fill="#93c5fd" fontSize="13" fontWeight="700" fontFamily="system-ui, sans-serif">Smart Wallet (C-address)</text>
        <text x="440" y="113" textAnchor="middle" fill="#6b7280" fontSize="9.5" fontFamily="system-ui, sans-serif">Stellar Smart Account &middot; On-Chain Contract</text>

        {/* USDC balance box */}
        <rect x="295" y="125" width="130" height="42" rx="6" fill="#0f172a" stroke="#1e3a5f" strokeWidth="1" />
        <text x="360" y="143" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="system-ui, sans-serif">Pooled Balance</text>
        <text x="360" y="158" textAnchor="middle" fill="#22c55e" fontSize="12" fontWeight="600" fontFamily="system-ui, sans-serif">USDC</text>

        {/* __check_auth box */}
        <rect x="450" y="125" width="140" height="42" rx="6" fill="#0f172a" stroke="#1e3a5f" strokeWidth="1" />
        <text x="520" y="143" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="system-ui, sans-serif">Authorization Gate</text>
        <text x="520" y="158" textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="600" fontFamily="monospace">__check_auth</text>

        {/* Subtitle */}
        <text x="440" y="210" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="system-ui, sans-serif">
          Every transfer validated: signer key + spend policy
        </text>

        {/* ====== AGENT SIGNERS (middle row) ====== */}

        {/* Agent 1: Ed25519 */}
        <rect x="50" y="280" width="220" height="105" rx="10" fill="url(#signerGrad)" stroke="#22c55e" strokeWidth="1.5" />
        <circle cx="72" cy="302" r="10" fill="#052e16" stroke="#22c55e" strokeWidth="1" />
        <text x="72" y="306" textAnchor="middle" fill="#22c55e" fontSize="10" fontWeight="bold" fontFamily="monospace">1</text>
        <text x="90" y="306" fill="#86efac" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Agent Signer (Ed25519)</text>
        <text x="72" y="325" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Secret key: S...XXXXX</text>
        <text x="72" y="340" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Platform: Any (Linux, macOS, Windows)</text>
        <rect x="72" y="350" width="175" height="22" rx="4" fill="#1a1510" stroke="#92400e" strokeWidth="1" />
        <text x="160" y="365" textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">Starter Policy: $50/day</text>

        {/* Agent 2: SoftP256 */}
        <rect x="330" y="280" width="220" height="105" rx="10" fill="url(#signerGrad)" stroke="#22c55e" strokeWidth="1.5" />
        <circle cx="352" cy="302" r="10" fill="#052e16" stroke="#22c55e" strokeWidth="1" />
        <text x="352" y="306" textAnchor="middle" fill="#22c55e" fontSize="10" fontWeight="bold" fontFamily="monospace">2</text>
        <text x="370" y="306" fill="#86efac" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Agent Signer (P-256)</text>
        <text x="352" y="325" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Encrypted file: ~/.lumenjoule/</text>
        <text x="352" y="340" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Platform: Any (SoftP256Signer)</text>
        <rect x="352" y="350" width="175" height="22" rx="4" fill="#1a1510" stroke="#92400e" strokeWidth="1" />
        <text x="440" y="365" textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">Production: $500/day</text>

        {/* Agent 3: KeypoSigner */}
        <rect x="610" y="280" width="220" height="105" rx="10" fill="url(#signerGrad)" stroke="#22c55e" strokeWidth="1.5" />
        <circle cx="632" cy="302" r="10" fill="#052e16" stroke="#22c55e" strokeWidth="1" />
        <text x="632" y="306" textAnchor="middle" fill="#22c55e" fontSize="10" fontWeight="bold" fontFamily="monospace">3</text>
        <text x="650" y="306" fill="#86efac" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">Agent Signer (SE)</text>
        <text x="632" y="325" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Secure Enclave (hardware)</text>
        <text x="632" y="340" fill="#9ca3af" fontSize="9.5" fontFamily="system-ui, sans-serif">Platform: macOS (KeypoSigner)</text>
        <rect x="632" y="350" width="175" height="22" rx="4" fill="#1a1510" stroke="#92400e" strokeWidth="1" />
        <text x="720" y="365" textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">Enterprise: $2,000/day</text>

        {/* Arrows: Agents → Vault */}
        <line x1="160" y1="280" x2="360" y2="230" stroke="#22c55e" strokeWidth="1.2" markerEnd="url(#arrowGreen)" />
        <line x1="440" y1="280" x2="440" y2="230" stroke="#22c55e" strokeWidth="1.2" markerEnd="url(#arrowGreen)" />
        <line x1="720" y1="280" x2="520" y2="230" stroke="#22c55e" strokeWidth="1.2" markerEnd="url(#arrowGreen)" />

        {/* Label: "sign auth" */}
        <text x="250" y="253" fill="#22c55e" fontSize="9" fontFamily="system-ui, sans-serif" textAnchor="middle">sign auth</text>
        <text x="462" y="260" fill="#22c55e" fontSize="9" fontFamily="system-ui, sans-serif">sign auth</text>
        <text x="620" y="253" fill="#22c55e" fontSize="9" fontFamily="system-ui, sans-serif" textAnchor="middle">sign auth</text>

        {/* ====== X402 PAYMENT FLOW (bottom) ====== */}

        {/* x402 Flow Banner */}
        <rect x="50" y="430" width="780" height="30" rx="6" fill="url(#x402Grad)" fillOpacity="0.15" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 3" />
        <text x="440" y="450" textAnchor="middle" fill="#93c5fd" fontSize="11" fontWeight="600" fontFamily="system-ui, sans-serif">
          x402 Payment Flow
        </text>

        {/* Flow boxes */}
        {/* 1. Agent */}
        <rect x="50" y="480" width="130" height="55" rx="8" fill="#111827" stroke="#374151" strokeWidth="1" />
        <text x="115" y="502" textAnchor="middle" fill="#d1d5db" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">AI Agent</text>
        <text x="115" y="518" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">client.chat()</text>

        {/* 2. x402 API */}
        <rect x="230" y="480" width="130" height="55" rx="8" fill="#111827" stroke="#374151" strokeWidth="1" />
        <text x="295" y="498" textAnchor="middle" fill="#fbbf24" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">x402 API</text>
        <text x="295" y="514" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">Returns 402 +</text>
        <text x="295" y="526" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">payment requirements</text>

        {/* 3. Facilitator */}
        <rect x="410" y="480" width="130" height="55" rx="8" fill="url(#facilitatorGrad)" stroke="#374151" strokeWidth="1" />
        <text x="475" y="502" textAnchor="middle" fill="#d1d5db" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">Facilitator</text>
        <text x="475" y="518" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">Verify + pay gas</text>

        {/* 4. Stellar */}
        <rect x="590" y="480" width="130" height="55" rx="8" fill="#111827" stroke="#374151" strokeWidth="1" />
        <text x="655" y="502" textAnchor="middle" fill="#d1d5db" fontSize="10" fontWeight="600" fontFamily="system-ui, sans-serif">Stellar Network</text>
        <text x="655" y="518" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">~5s finality</text>

        {/* 5. Smart Wallet (on-chain) */}
        <rect x="770" y="480" width="60" height="55" rx="8" fill="#0f172a" stroke="#3b82f6" strokeWidth="1" />
        <text x="800" y="502" textAnchor="middle" fill="#93c5fd" fontSize="9" fontWeight="600" fontFamily="system-ui, sans-serif">Wallet</text>
        <text x="800" y="515" textAnchor="middle" fill="#f59e0b" fontSize="8" fontFamily="monospace">check</text>
        <text x="800" y="526" textAnchor="middle" fill="#f59e0b" fontSize="8" fontFamily="monospace">auth</text>

        {/* Flow arrows */}
        <line x1="180" y1="507" x2="225" y2="507" stroke="#6b7280" strokeWidth="1.2" markerEnd="url(#arrow)" />
        <text x="202" y="500" textAnchor="middle" fill="#6b7280" fontSize="8" fontFamily="system-ui, sans-serif">request</text>

        <line x1="360" y1="507" x2="405" y2="507" stroke="#6b7280" strokeWidth="1.2" markerEnd="url(#arrow)" />
        <text x="382" y="500" textAnchor="middle" fill="#6b7280" fontSize="8" fontFamily="system-ui, sans-serif">pay</text>

        <line x1="540" y1="507" x2="585" y2="507" stroke="#6b7280" strokeWidth="1.2" markerEnd="url(#arrow)" />
        <text x="562" y="500" textAnchor="middle" fill="#6b7280" fontSize="8" fontFamily="system-ui, sans-serif">submit</text>

        <line x1="720" y1="507" x2="765" y2="507" stroke="#3b82f6" strokeWidth="1.2" markerEnd="url(#arrowBlue)" />

        {/* Return arrow (dotted) */}
        <path d="M 295 535 L 295 555 L 115 555 L 115 535" fill="none" stroke="#22c55e" strokeWidth="1" strokeDasharray="4 3" markerEnd="url(#arrowGreen)" />
        <text x="205" y="565" textAnchor="middle" fill="#22c55e" fontSize="8" fontFamily="system-ui, sans-serif">response (after settlement)</text>

        {/* ====== KEY INSIGHT BOX (bottom-right) ====== */}
        <rect x="590" y="555" width="240" height="50" rx="8" fill="#0f172a" stroke="#1e3a5f" strokeWidth="1" />
        <text x="600" y="572" fill="#94a3b8" fontSize="9" fontWeight="600" fontFamily="system-ui, sans-serif">Key Insight</text>
        <text x="600" y="586" fill="#6b7280" fontSize="8.5" fontFamily="system-ui, sans-serif">Agent keys never need XLM. Facilitator</text>
        <text x="600" y="598" fill="#6b7280" fontSize="8.5" fontFamily="system-ui, sans-serif">pays gas. Spend policy caps damage on-chain.</text>

        {/* ====== LEGEND (bottom-left) ====== */}
        <rect x="50" y="575" width="14" height="10" rx="2" fill="url(#vaultGrad)" stroke="#3b82f6" strokeWidth="1" />
        <text x="70" y="584" fill="#6b7280" fontSize="8.5" fontFamily="system-ui, sans-serif">Vault (holds funds)</text>

        <rect x="170" y="575" width="14" height="10" rx="2" fill="url(#signerGrad)" stroke="#22c55e" strokeWidth="1" />
        <text x="190" y="584" fill="#6b7280" fontSize="8.5" fontFamily="system-ui, sans-serif">Agent Signer</text>

        <rect x="280" y="575" width="14" height="10" rx="2" fill="#1a1510" stroke="#92400e" strokeWidth="1" />
        <text x="300" y="584" fill="#6b7280" fontSize="8.5" fontFamily="system-ui, sans-serif">Spend Policy</text>

        <rect x="390" y="575" width="14" height="10" rx="2" fill="url(#ownerGrad)" stroke="#7c3aed" strokeWidth="1" />
        <text x="410" y="584" fill="#6b7280" fontSize="8.5" fontFamily="system-ui, sans-serif">Owner (passkey)</text>

        {/* Contract source link */}
        <text x="440" y="612" textAnchor="middle" fill="#4b5563" fontSize="8.5" fontFamily="system-ui, sans-serif">
          Contract: github.com/lumenbro/stellar-smart-account
        </text>
      </svg>
    </div>
  );
}
