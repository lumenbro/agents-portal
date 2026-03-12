/**
 * Policy Contract Mapping System
 *
 * Maps pending transfer requirements to pre-deployed hardcoded policy contracts.
 * Each policy contract has hardcoded constraints (asset, max_amount, expiry).
 *
 * KEY INSIGHT: No `set_scope` call needed!
 * - Just add signer with policy contract address
 * - Wallet automatically calls policy.on_add() when signer is added
 * - Policy uses instance storage (works in __check_auth context)
 */

export interface PolicySpec {
  /** Policy contract C-address */
  contractId: string;
  /** Asset contracts this policy allows (C-addresses)
   *  Empty array = catch-all (allows all assets) - use with caution!
   */
  assets: string[];
  /** Maximum transfer amount (in base units, e.g., stroops) */
  maxAmount: string;
  /** Expiry ledger sequence */
  notAfter: number;
  /** Human-readable description */
  description?: string;
}

export interface PendingTransferRequirement {
  asset: string;
  amount: string; // Requested amount
  minExpiryLedger: number; // Minimum expiry ledger
}

/**
 * Find the best matching policy contract for a pending transfer requirement
 *
 * Strategy:
 * 1. Find policies matching the asset
 * 2. Filter by policies that allow the requested amount (maxAmount >= amount)
 * 3. Filter by policies that haven't expired (notAfter >= minExpiryLedger)
 * 4. Select the policy with the smallest maxAmount that still allows the transfer
 *    (to minimize exposure if compromised)
 */
export function findMatchingPolicy(
  requirement: PendingTransferRequirement,
  availablePolicies: PolicySpec[]
): PolicySpec | null {
  const requirementAmount = BigInt(requirement.amount);

  // Filter policies matching asset
  let candidates = availablePolicies.filter((p) => {
    // Catch-all: empty asset list matches everything
    if (p.assets.length === 0) {
      return true;
    }
    // Check if requirement asset is in allowed list
    return p.assets.some(
      (a) => a.toLowerCase() === requirement.asset.toLowerCase()
    );
  });

  // Filter by policies that allow the amount
  candidates = candidates.filter((p) => {
    const maxAmount = BigInt(p.maxAmount);
    return maxAmount >= requirementAmount;
  });

  // Filter by policies that haven't expired
  candidates = candidates.filter((p) => p.notAfter >= requirement.minExpiryLedger);

  if (candidates.length === 0) {
    return null;
  }

  // Sort by maxAmount ascending (to select the most restrictive policy that still works)
  candidates.sort((a, b) => {
    const aAmount = BigInt(a.maxAmount);
    const bAmount = BigInt(b.maxAmount);
    if (aAmount < bAmount) return -1;
    if (aAmount > bAmount) return 1;
    return 0;
  });

  return candidates[0];
}

/**
 * Policy contract registry
 *
 * Store deployed policy contracts with their specifications.
 * This can be:
 * - Hardcoded in code (for common configurations)
 * - Loaded from a JSON file
 * - Stored in a database
 * - Fetched from an API
 */
export class PolicyRegistry {
  private policies: Map<string, PolicySpec> = new Map();

  /**
   * Register a policy contract
   */
  register(policy: PolicySpec): void {
    const key = `${policy.assets.join(',')}-${policy.maxAmount}-${policy.notAfter}`;
    this.policies.set(key, policy);
  }

  /**
   * Get all policies for a specific asset (including catch-all policies)
   */
  getByAsset(asset: string): PolicySpec[] {
    return Array.from(this.policies.values()).filter((p) => {
      // Catch-all policies match all assets
      if (p.assets.length === 0) {
        return true;
      }
      // Check if asset is in allowed list
      return p.assets.some(
        (a) => a.toLowerCase() === asset.toLowerCase()
      );
    });
  }

  /**
   * Get all available policies
   */
  getAll(): PolicySpec[] {
    return Array.from(this.policies.values());
  }

  /**
   * Find matching policy for a requirement
   */
  findMatching(requirement: PendingTransferRequirement): PolicySpec | null {
    return findMatchingPolicy(requirement, this.getAll());
  }

  /**
   * Load policies from JSON
   */
  loadFromJson(json: PolicySpec[]): void {
    for (const policy of json) {
      this.register(policy);
    }
  }
}

/**
 * Common policy configurations
 *
 * Pre-defined common policy specs that can be deployed.
 * These use multi-asset catch-all strategies.
 */
export const COMMON_POLICY_CONFIGS = {
  // Multi-asset policies (common tokens together)
  multiAsset: {
    // Assets: Wrapped XLM + TIPS + USDC (update with actual addresses)
    assets: [
      "CCHOSNXEXTN4UPG52VNLZKDB4YVUTLXTKXPNZNL44XJRN7YQHWXUFDUO", // Wrapped XLM
      // "TIPS_CONTRACT_ADDRESS", // Add when known
      // "USDC_CONTRACT_ADDRESS", // Add when known
    ],
    amounts: [
      { maxAmount: "10000000000", description: "10 XLM" },
      { maxAmount: "50000000000", description: "50 XLM" },
      { maxAmount: "100000000000", description: "100 XLM" },
    ],
  },
  // Catch-all emergency policies (allows any asset, use sparingly)
  catchAll: [
    { maxAmount: "1000000000", description: "1 XLM - 24h catch-all" },
    { maxAmount: "5000000000", description: "5 XLM - 24h catch-all" },
  ],
} as const;

/**
 * Generate policy identifier
 *
 * Creates a human-readable identifier for a policy configuration.
 * Used for organizing deployments and logging.
 */
export function generatePolicyId(assets: string[], maxAmount: string): string {
  // Handle catch-all
  if (assets.length === 0) {
    const amount = BigInt(maxAmount);
    const amountStr = amount >= 1_000_000_000
      ? `${Number(amount / 1_000_000_000n)}XL`
      : `${Number(amount / 1_000_000n)}K`;
    return `CATCHALL-${amountStr}`;
  }

  // Multi-asset: use first asset's short code
  if (assets.length > 1) {
    const assetShort = assets[0].substring(0, 8);
    const amount = BigInt(maxAmount);
    const amountStr = amount >= 1_000_000_000
      ? `${Number(amount / 1_000_000_000n)}XL`
      : `${Number(amount / 1_000_000n)}K`;
    return `MULTI-${assetShort}-${amountStr}`;
  }

  // Single asset
  const assetShort = assets[0].substring(0, 8);
  const amount = BigInt(maxAmount);
  const amountStr = amount >= 1_000_000_000
    ? `${Number(amount / 1_000_000_000n)}XL`
    : `${Number(amount / 1_000_000n)}K`;

  return `${assetShort}-${amountStr}`;
}
