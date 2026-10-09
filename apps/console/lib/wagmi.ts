'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { polygonAmoy } from 'wagmi/chains';

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'YOUR_PROJECT_ID';

export const wagmiConfig = getDefaultConfig({
  appName: 'Bagseven',
  projectId,
  chains: [polygonAmoy],
  ssr: true,
  transports: {
    [polygonAmoy.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? 'https://polygon-amoy.drpc.org'),
  },
});
