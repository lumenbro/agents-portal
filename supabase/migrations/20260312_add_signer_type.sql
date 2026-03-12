-- Add Secp256r1 (Secure Enclave / TPM) signer support to agents table
--
-- New columns:
--   signer_type  — 'Ed25519' (default) or 'Secp256r1'
--   key_id       — SHA256(publicKey) for Secp256r1 signers (used by __check_auth)
--   key_label    — keypo-signer label (e.g., 'agent-compute-bot-1')
--
-- encrypted_secret_key becomes nullable (SE keys have no extractable secret)

ALTER TABLE agents ADD COLUMN IF NOT EXISTS signer_type TEXT NOT NULL DEFAULT 'Ed25519';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS key_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS key_label TEXT;
ALTER TABLE agents ALTER COLUMN encrypted_secret_key DROP NOT NULL;
