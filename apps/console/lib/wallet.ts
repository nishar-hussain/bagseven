'use client';

import { encodeFunctionData } from 'viem';
import { BagMandateAbi, canonicalMandate, canonicalSpawn, canonicalWithdraw, spendIntentDomain, spendIntentTypes, type SpendIntent } from '@agentos/onchain';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);
const SEPOLIA_CHAIN_ID = '0xaa36a7';

let cachedProvider: Window['ethereum'] | undefined;

/**
 * Resolve the wallet provider, PREFERRING MetaMask.
 * Phantom (and others) also inject `window.ethereum`, so we first look for
 * MetaMask via EIP-6963 (announced providers) / the isMetaMask flag, and only
 * fall back to the raw injected provider if MetaMask isn't present.
 */
export async function getProvider(): Promise<Window['ethereum'] | undefined> {
  if (cachedProvider) return cachedProvider;
  if (typeof window === 'undefined') return undefined;

  const announced: Window['ethereum'][] = [];
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ info?: { rdns?: string }; provider?: Window['ethereum'] }>).detail;
    if (detail?.provider) announced.push(detail.provider);
  };
  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((r) => setTimeout(r, 150));
  window.removeEventListener('eip6963:announceProvider', handler);

  const metamask = announced.find((p) => p?.isMetaMask) ?? announced[0];
  const injected = window.ethereum;
  cachedProvider = metamask ?? (injected?.isMetaMask ? injected : injected);
  return cachedProvider;
}

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connectWallet(): Promise<string> {
  const eth = await getProvider();
  if (!eth) throw new Error('No browser wallet found (install MetaMask)');
  await ensureSepolia();
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('No account selected');
  return address;
}

/** Ensure MetaMask is on Sepolia, switching the chain if needed. */
export async function ensureSepolia(): Promise<void> {
  const eth = await getProvider();
  if (!eth) return;
  const chainId = (await eth.request({ method: 'eth_chainId' })) as string;
  if (chainId === SEPOLIA_CHAIN_ID) return;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] });
  } catch {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: SEPOLIA_CHAIN_ID,
        chainName: 'Sepolia',
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
      }],
    });
  }
}

/** Read the CURRENTLY selected account without prompting (eth_accounts). */
export async function getCurrentAccount(): Promise<string | null> {
  const accounts = await getWalletAccounts();
  return accounts[0] ?? null;
}

/** Read all accounts the wallet has authorized for this site (no prompt). */
export async function getWalletAccounts(): Promise<string[]> {
  const eth = await getProvider();
  if (!eth) return [];
  try {
    return (await eth.request({ method: 'eth_accounts' })) as string[];
  } catch {
    return [];
  }
}

/**
 * Subscribe to wallet account switches so the UI always tracks the account the
 * user is actually on. Returns an unsubscribe function.
 */
export function watchAccountChanges(cb: (accounts: string[]) => void): () => void {
  let off: (() => void) | undefined;
  getProvider().then((eth) => {
    if (eth?.on) {
      eth.on('accountsChanged', cb as (...args: unknown[]) => void);
      off = () => eth.removeListener?.('accountsChanged', cb as (...args: unknown[]) => void);
    }
  });
  return () => off?.();
}

export function shortAddress(a: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** EIP-191 personal_sign via MetaMask. */
export async function signMessage(message: string): Promise<string> {
  const eth = await getProvider();
  if (!eth) throw new Error('No browser wallet found');
  const signature = (await eth.request({ method: 'personal_sign', params: [message, (await connectWallet())] })) as string;
  return signature;
}

/** Send native ETH from the connected wallet to `to` via MetaMask. */
export async function sendNativeEth(to: string, amountEth: string): Promise<string> {
  const eth = await getProvider();
  if (!eth) throw new Error('No browser wallet found');
  const from = await connectWallet();
  const value = BigInt(Math.round(Number(amountEth) * 1e18));
  return (await eth.request({ method: 'eth_sendTransaction', params: [{ from, to, value: `0x${value.toString(16)}` }] })) as string;
}

/** Owner withdraws directly from the mandate contract via MetaMask (on-chain). */
export async function withdrawFromContract(contract: string, amountUsdc: string, to: string): Promise<string> {
  const eth = await getProvider();
  if (!eth) throw new Error('No browser wallet found');
  await ensureSepolia();
  const from = await connectWallet();
  const units = BigInt(Math.round(Number(amountUsdc) * 1e6));
  const data = encodeFunctionData({ abi: BagMandateAbi, functionName: 'withdraw', args: [units, to.toLowerCase()] });
  return (await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: contract, data, value: '0x0' }] })) as string;
}

/**
 * The operator (which you set to the key you control — your creator wallet)
 * signs an EIP-712 spend intent through MetaMask. No browser-held key needed.
 */
export async function signSpendIntent(intent: SpendIntent, address: string): Promise<string> {
  const eth = await getProvider();
  if (!eth) throw new Error('No browser wallet found');
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ...spendIntentTypes,
    },
    primaryType: 'SpendIntent',
    domain: spendIntentDomain(intent.chainId),
    message: {
      agentId: intent.agentId,
      amount: intent.amount,
      recipient: intent.recipient,
      nonce: String(intent.nonce),
      timestamp: String(intent.timestamp),
      chainId: String(intent.chainId),
    },
  };
  const signature = (await eth.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData)] })) as string;
  return signature;
}

export function mandateCanonical(input: {
  owner: string;
  operator: string;
  budgetPerWindow: string;
  windowSeconds: number;
  lifetimeCap: string;
  perPurchaseCap: string;
  perSellerPct: number;
  maxDepth: number;
}): string {
  return canonicalMandate({ ...input, owner: input.owner.toLowerCase() as `0x${string}`, operator: input.operator.toLowerCase() as `0x${string}`, chainId: CHAIN_ID });
}

export function spawnCanonical(input: { mandateId: string; parentAgentId: string; operator: string; sharePercent: number }): string {
  return canonicalSpawn({ ...input, operator: input.operator.toLowerCase() as `0x${string}`, chainId: CHAIN_ID });
}

export function withdrawCanonical(input: { mandateId: string; amount: string; to: string }): string {
  return canonicalWithdraw({ ...input, to: input.to.toLowerCase() as `0x${string}`, chainId: CHAIN_ID });
}