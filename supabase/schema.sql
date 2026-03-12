-- Agents Portal — Supabase Schema
-- Run this in SQL Editor: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new
--
-- Tables: wallets, agents, api_keys
-- Auth: Service-role key used server-side (no RLS needed for API routes)

-- ============================================================
-- WALLETS
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  ghost_address TEXT,
  passkey_credential_id TEXT,
  passkey_public_key TEXT,
  network TEXT NOT NULL DEFAULT 'testnet',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_wallet_address ON wallets (wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallets_ghost_address ON wallets (ghost_address);

-- ============================================================
-- AGENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  signer_public_key TEXT NOT NULL,
  signer_type TEXT NOT NULL DEFAULT 'Ed25519',  -- 'Ed25519' | 'Secp256r1'
  encrypted_secret_key TEXT,                     -- NULL for Secp256r1 (hardware-bound)
  key_id TEXT,                                   -- SHA256(publicKey) for Secp256r1 __check_auth
  key_label TEXT,                                -- keypo-signer label (e.g., 'agent-compute-bot-1')
  secret_revealed BOOLEAN NOT NULL DEFAULT false,
  policy_tier_id TEXT,
  policy_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending_signer',  -- pending_signer | active | revoked
  signer_added_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agents_wallet_id ON agents (wallet_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agents_signer_public_key ON agents (signer_public_key);

-- ============================================================
-- API KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_agent_id ON api_keys (agent_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash);

-- ============================================================
-- RLS (disabled — server uses service_role key)
-- ============================================================
-- All API routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- If you enable RLS later, add policies per-table.
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Service role bypass (always has full access)
CREATE POLICY "Service role full access" ON wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON api_keys FOR ALL USING (true) WITH CHECK (true);
