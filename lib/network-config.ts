import { Networks } from '@stellar/stellar-sdk';

const MAINNET_RPC_FALLBACKS = [
  'https://soroban-rpc.mainnet.stellar.gateway.fm',
  'https://rpc.lightsail.network/',
  'https://mainnet.sorobanrpc.com',
];

export type StellarNetwork = 'testnet' | 'mainnet';

export interface AgentSpendPolicyTier {
  tierId: string;
  label: string;
  address?: string;
  dailyLimitUsdc: number;
  dailyLimitDisplay: string;
}

export interface NetworkConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  friendbotUrl?: string;
  smartAccountFactoryAddress: string;
  smartAccountWasmHash: string;
  soroswapRouterAddress: string;
  soroswapFactoryAddress: string;
  xlmSacAddress: string;
  usdcSacAddress: string;
  agentSpendPolicyWasmHash?: string;
  agentSpendPolicyAdmin?: string;
  agentTiers: AgentSpendPolicyTier[];
}

const TESTNET_CONFIG: NetworkConfig = {
  network: 'testnet',
  networkPassphrase: Networks.TESTNET,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  smartAccountFactoryAddress: process.env.NEXT_PUBLIC_SMART_ACCOUNT_FACTORY_TESTNET ||
    'CBAJNG34NGZMJPMMFTP7PN4UD5RMUHNMBU5L6KLJZS7QU34RTDQBG4RE',
  smartAccountWasmHash: process.env.SMART_ACCOUNT_WASM_HASH ||
    '8cced6471a6f5db317d9d1e94cc8ddc43e2d6324b118c70c1555c7d990ae5499',
  soroswapRouterAddress: process.env.NEXT_PUBLIC_SOROSWAP_ROUTER_TESTNET ||
    'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD',
  soroswapFactoryAddress: process.env.NEXT_PUBLIC_SOROSWAP_FACTORY_TESTNET ||
    'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY',
  xlmSacAddress: process.env.NEXT_PUBLIC_XLM_SAC_TESTNET ||
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  usdcSacAddress: process.env.NEXT_PUBLIC_USDC_SAC_TESTNET ||
    'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  agentSpendPolicyWasmHash: process.env.AGENT_SPEND_POLICY_WASM_HASH_TESTNET ||
    '19173258dc8d5cd819032df3f6fb031e57545d044848b9b288acafb39d051496',
  agentSpendPolicyAdmin: 'GCKGWGEKRJFCAV2ULBF5W5FZSDBDGSVJOY4Y7EEVJUXV4RHF5GNYF75S',
  agentTiers: [
    { tierId: 'low', label: 'Standard — $50/day', dailyLimitUsdc: 50_0000000, dailyLimitDisplay: '$50', address: undefined },
    { tierId: 'mid', label: 'Professional — $500/day', dailyLimitUsdc: 500_0000000, dailyLimitDisplay: '$500', address: 'CD55PSGWGEWLZBTQLUTD4GQ6BTE6RP3MZVYJRZD27JMU7O2VWJ3PBYFB' },
  ],
};

const MAINNET_CONFIG: NetworkConfig = {
  network: 'mainnet',
  networkPassphrase: Networks.PUBLIC,
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_MAINNET || 'https://soroban-rpc.mainnet.stellar.gateway.fm',
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_MAINNET || 'https://horizon.stellar.org',
  friendbotUrl: undefined,
  smartAccountFactoryAddress: process.env.NEXT_PUBLIC_SMART_ACCOUNT_FACTORY_MAINNET ||
    'CBBNVETMMVVY4EQI67HR7Y4YLQCUJMYJYUXLD3UYC4PCPXO2XNWAWL6X',
  smartAccountWasmHash: process.env.SMART_ACCOUNT_WASM_HASH ||
    '8cced6471a6f5db317d9d1e94cc8ddc43e2d6324b118c70c1555c7d990ae5499',
  soroswapRouterAddress: process.env.NEXT_PUBLIC_SOROSWAP_ROUTER_MAINNET ||
    'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH',
  soroswapFactoryAddress: process.env.NEXT_PUBLIC_SOROSWAP_FACTORY_MAINNET ||
    'CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2',
  xlmSacAddress: process.env.NEXT_PUBLIC_XLM_SAC_MAINNET ||
    'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
  usdcSacAddress: process.env.NEXT_PUBLIC_USDC_SAC_MAINNET ||
    'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  agentSpendPolicyWasmHash: process.env.AGENT_SPEND_POLICY_WASM_HASH_MAINNET ||
    '19173258dc8d5cd819032df3f6fb031e57545d044848b9b288acafb39d051496',
  agentSpendPolicyAdmin: process.env.AGENT_SPEND_POLICY_ADMIN_MAINNET ||
    'GCKGWGRRJBUKYCTV2AZBSEI3SVLEBFOF7OD2AEFXA2XPZV3MJUGKRP7D',
  agentTiers: [
    { tierId: 'low', label: 'Starter — $50/day', dailyLimitUsdc: 50_0000000, dailyLimitDisplay: '$50', address: 'CBRGH27ZFVFDIHYKC4K3CSLKXHQSR5CFG2PLPZ2M37NH4PYBOBTTQAEC' },
    { tierId: 'mid', label: 'Production — $500/day', dailyLimitUsdc: 500_0000000, dailyLimitDisplay: '$500', address: 'CCRIFGLMG3PT7R3V2IFSRNDNKR2Y2DLJAI5KXYBKNJPFCL2QC4MDIZNJ' },
    { tierId: 'high', label: 'Enterprise — $2,000/day', dailyLimitUsdc: 2000_0000000, dailyLimitDisplay: '$2,000', address: 'CCSPAXNEVBNA5QAEU2YEUTU56O5KOZM4C2O7ONQ6GFPSHEWV5OJJS5H2' },
  ],
};

export function getCurrentNetwork(): StellarNetwork {
  const network = (process.env.STELLAR_NETWORK || process.env.NEXT_PUBLIC_STELLAR_NETWORK)?.toLowerCase();
  if (network === 'mainnet' || network === 'public') return 'mainnet';
  return 'testnet';
}

export function getNetworkConfig(): NetworkConfig {
  return getCurrentNetwork() === 'mainnet' ? MAINNET_CONFIG : TESTNET_CONFIG;
}

export function getNetworkConfigByName(network: StellarNetwork): NetworkConfig {
  return network === 'mainnet' ? MAINNET_CONFIG : TESTNET_CONFIG;
}

export function getRpcUrl(): string { return getNetworkConfig().rpcUrl; }
export function getHorizonUrl(): string { return getNetworkConfig().horizonUrl; }

export function getServerRpcUrl(): string {
  return process.env.SOROBAN_RPC_URL || process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || getNetworkConfig().rpcUrl;
}

export function getServerRpcUrlsWithFallback(): string[] {
  const primary = getServerRpcUrl();
  const envFallbacks = [process.env.SOROBAN_RPC_FALLBACK_1, process.env.SOROBAN_RPC_FALLBACK_2].filter((url): url is string => !!url);
  const all = [primary, ...envFallbacks];
  if (getCurrentNetwork() === 'mainnet') {
    for (const fb of MAINNET_RPC_FALLBACKS) {
      if (!all.includes(fb)) all.push(fb);
    }
  }
  return all;
}

export function getNetworkPassphrase(): string { return getNetworkConfig().networkPassphrase; }
export function isMainnet(): boolean { return getCurrentNetwork() === 'mainnet'; }
export function isTestnet(): boolean { return getCurrentNetwork() === 'testnet'; }
export function getExplorerNetwork(): string { return isMainnet() ? 'public' : 'testnet'; }

export function getAgentTiers(): AgentSpendPolicyTier[] {
  return getNetworkConfig().agentTiers;
}

export function getDeployedAgentTiers(): AgentSpendPolicyTier[] {
  return getAgentTiers().filter(t => t.address);
}

export function getAgentPolicyAddress(tierId: string): string | undefined {
  return getAgentTiers().find(t => t.tierId === tierId)?.address;
}

export function getDefaultAgentPolicyAddress(): string | undefined {
  return getAgentPolicyAddress('low') || getAgentPolicyAddress('mid');
}

export async function createRpcServerWithFallback(): Promise<{ server: import('@stellar/stellar-sdk').rpc.Server; url: string }> {
  const { rpc } = await import('@stellar/stellar-sdk');
  const urls = getServerRpcUrlsWithFallback();
  for (const url of urls) {
    try {
      const server = new rpc.Server(url);
      await server.getHealth();
      return { server, url };
    } catch {
      console.warn(`[rpc-fallback] ${url} unhealthy, trying next...`);
    }
  }
  console.error('[rpc-fallback] All RPC endpoints unhealthy, using primary');
  return { server: new (await import('@stellar/stellar-sdk')).rpc.Server(urls[0]), url: urls[0] };
}

export default getNetworkConfig;
