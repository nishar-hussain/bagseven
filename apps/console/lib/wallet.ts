'use client';

import { encodeFunctionData } from 'viem';
import {
  signMessage as coreSignMessage,
  signTypedData as coreSignTypedData,
  sendTransaction as coreSendTransaction,
  waitForTransactionReceipt,
} from '@wagmi/core';
import { BagMandateAbi, canonicalMandate, canonicalSpawn, canonicalWithdraw, spendIntentDomain, spendIntentTypes, type SpendIntent } from '@bagseven/onchain';
import { wagmiConfig } from './wagmi';

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as `0x${string}`;

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
