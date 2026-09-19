import type { Address } from 'viem';
import { sepolia } from 'viem/chains';

/**
 * Chain configuration for the treasury's real on-chain signer.
 * EVM-only for now; the Signer interface isolates the treasury from chain mechanics.
 */
export interface ChainSpec {
  id: number;
  name: string;
  rpcUrl: string;
  usdcAddress: Address;
  nativeDecimals: number;
  /** ERC-20 decimals per token. USDC is 6 on Sepolia; ETH uses nativeDecimals. */
  tokenDecimals: Record<string, number>;
  /** Small native-gas grant sent alongside token credits so derived agents can pay gas. */
  gasGrantNative: string;
  /** viem chain definition used for the signing clients. */
  viemChain: typeof sepolia;
}

export function loadChainSpecs(env: NodeJS.ProcessEnv): Record<string, ChainSpec> {
  return {
    sepolia: {
      id: 11155111,
      name: 'Ethereum Sepolia',
      rpcUrl: env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
      usdcAddress: (env.SEPOLIA_USDC ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Address,
      nativeDecimals: 18,
      tokenDecimals: { USDC: 6, ETH: 18 },
      gasGrantNative: env.GAS_GRANT_NATIVE ?? '0.01',
      viemChain: sepolia,
    },
  };
}