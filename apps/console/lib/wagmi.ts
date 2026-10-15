'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { avalancheFuji } from 'wagmi/chains';
import { fallback } from 'viem';

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'YOUR_PROJECT_ID';

export const wagmiConfig = getDefaultConfig({
  appName: 'Bagseven',
  projectId,
  chains: [avalancheFuji],
  ssr: true,
  transports: {
    [avalancheFuji.id]: fallback([
      http(process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc', { retryCount: 3, retryDelay: 500 }),
      http(process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_FALLBACK_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc', { retryCount: 3, retryDelay: 750 }),
    ]),
  },
});
