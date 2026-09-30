'use client';

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { signTypedData } from 'viem/accounts';
import { canonicalMandate, canonicalSpawn, canonicalWithdraw, spendIntentDomain, spendIntentTypes, type SpendIntent } from '@agentos/onchain';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
  }
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connectWallet(): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found (install MetaMask)');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('No account selected');
  return address;
}

/** Read the CURRENTLY selected account without prompting (eth_accounts). */
export async function getCurrentAccount(): Promise<string | null> {
  const accounts = await getWalletAccounts();
  return accounts[0] ?? null;
}

/** Read all accounts the wallet has authorized for this site (no prompt). */
export async function getWalletAccounts(): Promise<string[]> {
  const eth = window.ethereum;
  if (!eth) return [];
  try {
    return (await eth.request({ method: 'eth_accounts' })) as string[];
  } catch {
    return [];
  }
}

/**
 * Subscribe to MetaMask account switches so the UI always tracks the account
 * the user is actually on. Returns an unsubscribe function.
 */
export function watchAccountChanges(cb: (accounts: string[]) => void): () => void {
  const eth = window.ethereum;
  if (!eth?.on) return () => undefined;
  eth.on('accountsChanged', cb as (...args: unknown[]) => void);
  return () => eth.removeListener?.('accountsChanged', cb as (...args: unknown[]) => void);
}

export function shortAddress(a: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** EIP-191 personal_sign via MetaMask. */
export async function signMessage(message: string): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found');
  const signature = (await eth.request({ method: 'personal_sign', params: [message, (await connectWallet())] })) as string;
  return signature;
}

/** Generate a fresh operator hot key for the agent (stored in the session). */
export function generateOperatorKey(): { address: string; privateKey: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}

/** The operator signs an EIP-712 spend intent with its browser-held key. */
export async function signSpendIntent(intent: SpendIntent, privateKey: string): Promise<string> {
  return signTypedData({
    privateKey: privateKey as `0x${string}`,
    domain: spendIntentDomain(intent.chainId),
    types: spendIntentTypes,
    primaryType: 'SpendIntent',
    message: { ...intent, nonce: BigInt(intent.nonce), timestamp: BigInt(intent.timestamp), chainId: BigInt(intent.chainId) },
  });
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