'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { avalancheFuji, polygonAmoy } from 'wagmi/chains';
import { fallback } from 'viem';

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'YOUR_PROJECT_ID';

export const wagmiConfig = getDefaultConfig({
  appName: 'Bagseven',
  projectId,
  chains: [polygonAmoy, avalancheFuji],
  ssr: true,
  transports: {
    // Public RPCs can rate-limit the several reads performed around an
    // approval/fund flow. Keep the configured endpoint first, then fail over
    // to a second Amoy endpoint without changing the connected wallet chain.
    [polygonAmoy.id]: fallback([
      http(process.env.NEXT_PUBLIC_RPC_URL ?? 'https://polygon-amoy.drpc.org', { retryCount: 3, retryDelay: 500 }),
      http(process.env.NEXT_PUBLIC_RPC_FALLBACK_URL ?? 'https://polygon-amoy.drpc.org', { retryCount: 3, retryDelay: 750 }),
    ]),
    [avalancheFuji.id]: fallback([
      http(process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc', { retryCount: 3, retryDelay: 500 }),
      http(process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_FALLBACK_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc', { retryCount: 3, retryDelay: 750 }),
    ]),
  },
});
