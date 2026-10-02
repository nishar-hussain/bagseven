'use client';

import { encodeFunctionData } from 'viem';
import { signMessage as coreSignMessage, signTypedData as coreSignTypedData, sendTransaction as coreSendTransaction } from '@wagmi/core';
import { BagMandateAbi, canonicalMandate, canonicalSpawn, canonicalWithdraw, spendIntentDomain, spendIntentTypes, type SpendIntent } from '@agentos/onchain';
import { wagmiConfig } from './wagmi';

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);

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
  return coreSendTransaction(wagmiConfig, { to: contract as `0x${string}`, data });
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