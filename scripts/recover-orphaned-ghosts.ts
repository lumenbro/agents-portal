#!/usr/bin/env npx tsx
/**
 * Ghost Account Recovery Script
 *
 * Finds orphaned ghost G-addresses sponsored by the paymaster and optionally
 * merges them back to reclaim locked XLM reserves.
 *
 * RECOVERY FLOW:
 *   1. Query Horizon for all accounts sponsored by paymaster
 *   2. Cross-reference with Supabase wallets table
 *   3. For ghosts with known passkey_public_key: re-derive ghost keypair → merge
 *   4. For ghosts with NULL passkey: report only (user must re-authenticate)
 *
 * Usage:
 *   # Discovery only (no env vars needed except SUPABASE):
 *   npx tsx scripts/recover-orphaned-ghosts.ts --discover
 *
 *   # Recover a specific ghost by providing the passkey public key:
 *   npx tsx scripts/recover-orphaned-ghosts.ts --recover --passkey-pubkey <base64>
 *
 *   # Recover all ghosts that have passkey_public_key in DB:
 *   npx tsx scripts/recover-orphaned-ghosts.ts --recover-known
 *
 * Env vars:
 *   GHOST_MASTER_KEY          - Server-side HKDF salt derivation key (required for --recover)
 *   PAYMASTER_SECRET          - Paymaster S-key (required for --recover, pays merge fees)
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Supabase admin key
 *   STELLAR_NETWORK           - "mainnet" or "testnet" (default: mainnet)
 */

import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ── Config ──────────────────────────────────────────────────────────────────

const PAYMASTER_PUBLIC = 'GAWZ3PFDQQGLD7ARUX2WWMGXU7P3R26WI7452CMBAGF5PFPVCSD3Z7LB';

const network = (process.env.STELLAR_NETWORK || process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'mainnet').toLowerCase();
const isMainnet = network === 'mainnet' || network === 'public';
const horizonUrl = isMainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
const networkPassphrase = isMainnet ? Networks.PUBLIC : Networks.TESTNET;

const horizon = new Horizon.Server(horizonUrl);

// ── Ghost derivation (mirrors lib/ghost-address-derivation.ts) ──────────

const GHOST_IKM = new TextEncoder().encode('stellar-ghost-v1-2025');
const GHOST_INFO = new TextEncoder().encode('ghost-address');

function deriveUserSalt(passkeyPubkeyBase64: string): string {
  const ghostMasterKey = process.env.GHOST_MASTER_KEY || process.env.GHOST_CHALLENGE_KEY;
  if (!ghostMasterKey) throw new Error('GHOST_MASTER_KEY not set');

  const normalized = passkeyPubkeyBase64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(passkeyPubkeyBase64.length / 4) * 4, '=');

  const hmac = crypto.createHmac('sha256', ghostMasterKey);
  hmac.update(normalized);
  return hmac.digest('base64');
}

async function deriveGhostKeypair(passkeyPubkeyBase64: string): Promise<Keypair> {
  const userSalt = deriveUserSalt(passkeyPubkeyBase64);

  const normalizedBase64 = passkeyPubkeyBase64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(passkeyPubkeyBase64.length / 4) * 4, '=');

  const passkeyRaw = Buffer.from(normalizedBase64, 'base64');
  const userSaltBuf = Buffer.from(userSalt, 'base64');
  const saltBuffer = Buffer.concat([passkeyRaw, userSaltBuf]);

  const key = await globalThis.crypto.subtle.importKey('raw', GHOST_IKM, 'HKDF', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(saltBuffer), info: GHOST_INFO },
    key,
    256,
  );

  return Keypair.fromRawEd25519Seed(Buffer.from(bits));
}

// ── Horizon helpers ─────────────────────────────────────────────────────

interface SponsoredGhost {
  ghostAddress: string;
  createdAt: string;
  txHash: string;
  balance: string;
  numSubEntries: number;
  sponsor: string;
}

async function findSponsoredGhosts(): Promise<SponsoredGhost[]> {
  console.log(`\n🔍 Querying Horizon (${isMainnet ? 'mainnet' : 'testnet'}) for paymaster operations...`);
  console.log(`   Paymaster: ${PAYMASTER_PUBLIC}\n`);

  const ghosts: SponsoredGhost[] = [];

  // Get all operations from the paymaster, look for create_account
  let page = await horizon
    .operations()
    .forAccount(PAYMASTER_PUBLIC)
    .limit(200)
    .order('desc')
    .call();

  for (const op of page.records) {
    if ((op as any).type === 'create_account') {
      const createOp = op as any;
      const ghostAddr = createOp.account;
      const txHash = createOp.transaction_hash;
      const createdAt = createOp.created_at;

      // Load the ghost account to check sponsor + balance
      try {
        const acct = await horizon.loadAccount(ghostAddr);
        const xlmBalance = acct.balances.find(
          (b: any) => b.asset_type === 'native',
        );
        ghosts.push({
          ghostAddress: ghostAddr,
          createdAt,
          txHash,
          balance: xlmBalance ? (xlmBalance as any).balance : '0',
          numSubEntries: acct.subentry_count,
          sponsor: (acct as any).sponsor || 'none',
        });
      } catch (e: any) {
        // Account may have already been merged
        if (e.response?.status === 404) {
          console.log(`   ⚠ ${ghostAddr} — already merged/deleted`);
        } else {
          console.error(`   ❌ Error loading ${ghostAddr}:`, e.message);
        }
      }
    }
  }

  return ghosts;
}

// ── Supabase helpers ────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, key);
}

interface WalletRecord {
  id: string;
  wallet_address: string;
  ghost_address: string | null;
  passkey_public_key: string | null;
  passkey_credential_id: string | null;
  network: string;
  created_at: string;
}

async function getWalletRecords(): Promise<WalletRecord[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return data || [];
}

// ── Merge ghost → paymaster ─────────────────────────────────────────────

async function mergeGhost(ghostKeypair: Keypair): Promise<string> {
  const paymasterSecret = process.env.PAYMASTER_SECRET || process.env.WALLET_DEPLOYER_SECRET_KEY;
  if (!paymasterSecret) throw new Error('PAYMASTER_SECRET required for merge');

  const paymasterKp = Keypair.fromSecret(paymasterSecret.trim());
  const paymasterAccount = await horizon.loadAccount(paymasterKp.publicKey());

  // accountMerge sends all XLM to destination and deletes the source account
  // Source = ghost, destination = paymaster
  // The ghost must sign (it's the source), paymaster pays the fee
  const tx = new TransactionBuilder(paymasterAccount, {
    fee: (Number(BASE_FEE) * 2).toString(),
    networkPassphrase,
  })
    .addOperation(
      Operation.accountMerge({
        destination: paymasterKp.publicKey(),
        source: ghostKeypair.publicKey(),
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(paymasterKp);
  tx.sign(ghostKeypair);

  const result = await horizon.submitTransaction(tx);
  return (result as any).hash;
}

// ── Main ────────────────────────────────────────────────────────────────

async function discover() {
  const ghosts = await findSponsoredGhosts();
  let wallets: WalletRecord[] = [];
  try {
    wallets = await getWalletRecords();
  } catch (e: any) {
    console.warn(`⚠ Could not query Supabase: ${e.message}`);
    console.warn('  Continuing with Horizon data only.\n');
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  GHOST ACCOUNT DISCOVERY REPORT`);
  console.log(`  Network: ${isMainnet ? 'MAINNET' : 'TESTNET'}`);
  console.log(`  Paymaster: ${PAYMASTER_PUBLIC}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  console.log(`Found ${ghosts.length} sponsored ghost account(s):\n`);

  const ghostToWallet = new Map<string, WalletRecord>();
  for (const w of wallets) {
    if (w.ghost_address) {
      ghostToWallet.set(w.ghost_address, w);
    }
  }

  let recoverable = 0;
  let orphaned = 0;
  let lockedXlm = 0;

  for (const g of ghosts) {
    const wallet = ghostToWallet.get(g.ghostAddress);
    const hasPasskey = wallet?.passkey_public_key ? true : false;
    const reservePerAccount = 0.5; // 1 base reserve = 0.5 XLM
    lockedXlm += reservePerAccount;

    console.log(`  Ghost: ${g.ghostAddress}`);
    console.log(`    Created:     ${g.createdAt}`);
    console.log(`    Balance:     ${g.balance} XLM`);
    console.log(`    Sponsor:     ${g.sponsor === PAYMASTER_PUBLIC ? 'PAYMASTER ✓' : g.sponsor}`);
    console.log(`    Sub-entries: ${g.numSubEntries}`);
    console.log(`    TX hash:     ${g.txHash}`);

    if (wallet) {
      console.log(`    Wallet:      ${wallet.wallet_address}`);
      console.log(`    Passkey:     ${hasPasskey ? 'AVAILABLE ✓' : 'NULL ✗'}`);
      if (hasPasskey) {
        console.log(`    Status:      RECOVERABLE`);
        recoverable++;
      } else {
        console.log(`    Status:      ORPHANED (passkey unknown)`);
        orphaned++;
      }
    } else {
      console.log(`    Wallet:      NO MATCH IN DB`);
      console.log(`    Status:      ORPHANED (no wallet record)`);
      orphaned++;
    }
    console.log('');
  }

  // Check for wallets without matching ghosts
  const walletsWithoutGhost = wallets.filter(
    (w) => !w.ghost_address || !ghosts.find((g) => g.ghostAddress === w.ghost_address),
  );

  if (walletsWithoutGhost.length > 0) {
    console.log(`\n  WALLETS WITHOUT GHOST MAPPING (${walletsWithoutGhost.length}):`);
    for (const w of walletsWithoutGhost) {
      console.log(`    ${w.wallet_address} (created: ${w.created_at})`);
      console.log(`      ghost_address: ${w.ghost_address || 'NULL'}`);
      console.log(`      passkey_public_key: ${w.passkey_public_key ? 'SET' : 'NULL'}`);
    }
  }

  console.log(`\n───────────────────────────────────────────────────────────`);
  console.log(`  SUMMARY`);
  console.log(`  Total ghosts:     ${ghosts.length}`);
  console.log(`  Recoverable:      ${recoverable} (passkey in DB)`);
  console.log(`  Orphaned:         ${orphaned} (passkey unknown)`);
  console.log(`  Locked XLM:       ~${lockedXlm} XLM (${ghosts.length} × 0.5 XLM base reserve)`);
  console.log(`───────────────────────────────────────────────────────────`);

  if (orphaned > 0) {
    console.log(`\n  TO RECOVER ORPHANED GHOSTS:`);
    console.log(`  1. Re-authenticate on agents.lumenbro.com (triggers passkey)`);
    console.log(`  2. The auth/token route now saves passkey_public_key to DB`);
    console.log(`  3. Re-run: npx tsx scripts/recover-orphaned-ghosts.ts --recover-known`);
    console.log(`  Or manually: --recover --passkey-pubkey <base64>\n`);
  }

  if (recoverable > 0) {
    console.log(`\n  ${recoverable} ghost(s) can be recovered now with --recover-known\n`);
  }
}

async function recoverByPasskey(passkeyPubkeyBase64: string) {
  console.log(`\nDeriving ghost keypair from passkey...`);
  const ghostKp = await deriveGhostKeypair(passkeyPubkeyBase64);
  const ghostAddr = ghostKp.publicKey();
  console.log(`  Ghost address: ${ghostAddr}`);

  // Check if account exists
  try {
    const acct = await horizon.loadAccount(ghostAddr);
    const sponsor = (acct as any).sponsor;
    if (sponsor !== PAYMASTER_PUBLIC) {
      console.error(`  ❌ Ghost exists but sponsor is ${sponsor}, not paymaster. Aborting.`);
      process.exit(1);
    }
    console.log(`  Sponsor: ${sponsor} ✓`);
    console.log(`  Balance: ${acct.balances.find((b: any) => b.asset_type === 'native')?.balance || '0'} XLM`);
  } catch (e: any) {
    if (e.response?.status === 404) {
      console.log(`  Ghost account not found on Horizon. May already be merged.`);
      process.exit(0);
    }
    throw e;
  }

  console.log(`\n  Merging ghost → paymaster...`);
  try {
    const txHash = await mergeGhost(ghostKp);
    console.log(`  ✅ Merged! TX: ${txHash}`);
    console.log(`  ~0.5 XLM recovered to paymaster.\n`);

    // Update DB to mark ghost as merged
    try {
      const supabase = getSupabase();
      await supabase
        .from('wallets')
        .update({ ghost_address: `MERGED:${ghostAddr}` })
        .eq('ghost_address', ghostAddr);
    } catch {
      // Non-critical
    }
  } catch (e: any) {
    console.error(`  ❌ Merge failed:`, e.response?.data?.extras?.result_codes || e.message);
    process.exit(1);
  }
}

async function recoverKnown() {
  const wallets = await getWalletRecords();
  const recoverable = wallets.filter((w) => w.passkey_public_key && w.ghost_address);

  if (recoverable.length === 0) {
    console.log(`\nNo wallets with both ghost_address and passkey_public_key found.`);
    console.log(`Users must re-authenticate to populate passkey_public_key.\n`);

    // Also try wallets that have passkey but no ghost mapping — derive ghost and check
    const withPasskeyOnly = wallets.filter((w) => w.passkey_public_key && !w.ghost_address);
    if (withPasskeyOnly.length > 0) {
      console.log(`Found ${withPasskeyOnly.length} wallet(s) with passkey but no ghost mapping.`);
      console.log(`Attempting ghost derivation...\n`);

      for (const w of withPasskeyOnly) {
        try {
          const ghostKp = await deriveGhostKeypair(w.passkey_public_key!);
          const ghostAddr = ghostKp.publicKey();
          console.log(`  Wallet: ${w.wallet_address}`);
          console.log(`  Derived ghost: ${ghostAddr}`);

          try {
            await horizon.loadAccount(ghostAddr);
            console.log(`  Ghost EXISTS on Horizon — can merge!`);
            await recoverByPasskey(w.passkey_public_key!);
          } catch (e: any) {
            if (e.response?.status === 404) {
              console.log(`  Ghost not found on Horizon (already merged or never created)`);
            }
          }
          console.log('');
        } catch (e: any) {
          console.error(`  ❌ Derivation failed for ${w.wallet_address}: ${e.message}`);
        }
      }
    }
    return;
  }

  console.log(`\nRecovering ${recoverable.length} ghost(s)...\n`);
  for (const w of recoverable) {
    console.log(`Wallet: ${w.wallet_address}`);
    await recoverByPasskey(w.passkey_public_key!);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.length === 0) {
  console.log(`
Ghost Account Recovery Tool
────────────────────────────
  --discover                       Find all orphaned ghost accounts
  --recover --passkey-pubkey <b64>  Merge a specific ghost by passkey
  --recover-known                  Merge all ghosts with passkey in DB
  --help                           Show this help
`);
  process.exit(0);
}

(async () => {
  try {
    if (args.includes('--discover')) {
      await discover();
    } else if (args.includes('--recover') && args.includes('--passkey-pubkey')) {
      const idx = args.indexOf('--passkey-pubkey');
      const pubkey = args[idx + 1];
      if (!pubkey) {
        console.error('Missing passkey public key after --passkey-pubkey');
        process.exit(1);
      }
      await recoverByPasskey(pubkey);
    } else if (args.includes('--recover-known')) {
      await recoverKnown();
    } else {
      console.error('Unknown command. Use --help for usage.');
      process.exit(1);
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message);
    process.exit(1);
  }
})();
