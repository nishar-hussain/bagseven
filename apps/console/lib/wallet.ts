'use client';

import { encodeFunctionData } from 'viem';
import {
  signMessage as coreSignMessage,
  signTypedData as coreSignTypedData,
  sendTransaction as coreSendTransaction,
  waitForTransactionReceipt,
  getAccount,
  getPublicClient,
  switchChain,
} from '@wagmi/core';
import { BagMandateAbi, canonicalMandate, canonicalSpawn, canonicalWithdraw, spendIntentDomain, spendIntentTypes, type SpendIntent } from '@bagseven/onchain';
import { wagmiConfig } from './wagmi';

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 80002);
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582') as `0x${string}`;

const erc20ApproveAbi = [
  {
    type: 'function' as const,
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable' as const,
  },
];

const erc20BalanceAbi = [
  {
    type: 'function' as const,
    name: 'balanceOf' as const,
    inputs: [{ name: 'account', type: 'address' as const }],
    outputs: [{ name: 'balance', type: 'uint256' as const }],
    stateMutability: 'view' as const,
  },
];

async function prepareAmoyFunding(contract: string, units: bigint): Promise<void> {
  const account = getAccount(wagmiConfig);
  if (!account.address) throw new Error('connect the wallet before funding the vault');
  // Read the chain from the connected account. `getChainId(config)` can still
  // return the configured/default chain while the browser wallet is actually
  // connected to another network (for example Sepolia).
  if (account.chainId !== CHAIN_ID) {
    try { await switchChain(wagmiConfig, { chainId: CHAIN_ID as 80002 }); }
    catch { throw new Error('switch the connected wallet to Polygon Amoy before funding the vault'); }
  }
  const connectedChainId = getAccount(wagmiConfig).chainId;
  if (connectedChainId !== CHAIN_ID) {
    throw new Error('the connected wallet is not on Polygon Amoy (chain 80002)');
  }
  const publicClient = await getPublicClient(wagmiConfig);
  if (!publicClient) throw new Error('Polygon Amoy RPC is unavailable');
  const code = await publicClient.getBytecode({ address: contract as `0x${string}` });
  if (!code) throw new Error('this mandate contract is not deployed on Polygon Amoy; create a new Amoy mandate');
  const balance = BigInt(await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [account.address] }) as unknown as bigint);
  if (balance < units) throw new Error(`insufficient Polygon Amoy USDC: wallet has ${(Number(balance) / 1e6).toFixed(2)}, funding requires ${(Number(units) / 1e6).toFixed(2)}`);
}

export function shortAddress(a: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** EIP-191 personal_sign via the connected wallet (RainbowKit/wagmi). */
export async function signMessage(message: string): Promise<string> {
  return coreSignMessage(wagmiConfig, { message });
}

/** Send native ETH from the connected wallet to `to`. */
export async function sendNativeEth(to: string, amountEth: string): Promise<string> {
  const value = BigInt(Math.round(Number(amountEth) * 1e18));
  return coreSendTransaction(wagmiConfig, { to: to as `0x${string}`, value });
}

/** Owner withdraws directly from the mandate contract via the connected wallet. */
export async function withdrawFromContract(contract: string, amountUsdc: string, to: string): Promise<string> {
  const units = BigInt(Math.round(Number(amountUsdc) * 1e6));
  const data = encodeFunctionData({ abi: BagMandateAbi, functionName: 'withdraw', args: [units, to.toLowerCase()] });
  const res = await coreSendTransaction(wagmiConfig, { to: contract as `0x${string}`, data });
  return res;
}

/**
 * Fund the vault from YOUR connected wallet: approve USDC to the mandate
 * contract, then call fund() — on-chain, no faucet needed.
 */
export async function fundFromContract(contract: string, amountUsdc: string): Promise<string> {
  const units = BigInt(Math.round(Number(amountUsdc) * 1e6));
  if (units <= 0n) throw new Error('funding amount must be greater than zero');
  await prepareAmoyFunding(contract, units);
  const approveData = encodeFunctionData({ abi: erc20ApproveAbi, functionName: 'approve', args: [contract.toLowerCase(), units] });
  const approveHash = await coreSendTransaction(wagmiConfig, { to: USDC_ADDRESS, data: approveData });
  // The mandate's fund() call uses transferFrom(). Wait for the approval to be
  // mined before submitting fund(), otherwise the RPC can process fund() while
  // the allowance is still zero and the vault funding transaction reverts.
  await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
  const fundData = encodeFunctionData({ abi: BagMandateAbi, functionName: 'fund', args: [units] });
  const fundHash = await coreSendTransaction(wagmiConfig, { to: contract as `0x${string}`, data: fundData });
  // Do not refresh the UI until the USDC transfer is confirmed on-chain.
  await waitForTransactionReceipt(wagmiConfig, { hash: fundHash });
  return fundHash;
}

/**
 * The operator (the key you control — your connected creator wallet) signs an
 * EIP-712 spend intent through the connected wallet. No browser-held key needed.
 */
export async function signSpendIntent(intent: SpendIntent, _address: string): Promise<string> {
  return coreSignTypedData(wagmiConfig, {
    domain: spendIntentDomain(intent.chainId),
    types: spendIntentTypes,
    primaryType: 'SpendIntent',
    message: {
      agentId: intent.agentId,
      amount: intent.amount,
      recipient: intent.recipient,
      nonce: BigInt(intent.nonce),
      timestamp: BigInt(intent.timestamp),
      chainId: BigInt(intent.chainId),
    },
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
