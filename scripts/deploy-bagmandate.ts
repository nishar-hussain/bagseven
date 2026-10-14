/**
 * Deploy one standalone BagMandate demo contract to the selected supported
 * testnet. This does not fund the vault and never uses a mainnet chain.
 *
 * Fuji example:
 *   DEPLOY_CHAIN_ID=43113 pnpm deploy:bagmandate
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { chainConfigForId, canonicalMandate, MandateClient, workerKey } from '@bagseven/onchain';

function loadDotEnv(): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
    }));
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const config = { ...loadDotEnv(), ...process.env };
  const chainId = Number(config.DEPLOY_CHAIN_ID ?? config.CHAIN_ID ?? 43113);
  if (chainId !== 43113) throw new Error('This script is Fuji-only. Set DEPLOY_CHAIN_ID=43113.');
  const chain = chainConfigForId(chainId);
  const rpcUrl = config.DEPLOY_RPC_URL ?? config.AVALANCHE_FUJI_RPC_URL ?? chain.defaultRpcUrl;
  const rpcFallbackUrl = config.DEPLOY_RPC_FALLBACK_URL ?? config.AVALANCHE_FUJI_RPC_FALLBACK_URL;
  const usdc = (config.DEPLOY_USDC_ADDRESS ?? config.AVALANCHE_FUJI_USDC ?? chain.usdc) as `0x${string}`;
  const executorKey = config.DAEMON_EXECUTOR_KEY;
  const ownerKey = config.DEPLOYMENT_OWNER_KEY ?? config.DAEMON_OWNER_KEY ?? config.OWNER_DEV_KEY;
  const operatorKey = config.DEPLOYMENT_OPERATOR_KEY ?? config.DAEMON_OPERATOR_KEY ?? config.OPERATOR_DEV_KEY;
  if (!executorKey || !ownerKey || !operatorKey) throw new Error('DAEMON_EXECUTOR_KEY, an owner key, and an operator key are required');

const owner = privateKeyToAccount(ownerKey as `0x${string}`);
const operator = privateKeyToAccount(operatorKey as `0x${string}`);
const executor = privateKeyToAccount(executorKey as `0x${string}`);
if (config.DAEMON_EXECUTOR_ADDRESS && config.DAEMON_EXECUTOR_ADDRESS.toLowerCase() !== executor.address.toLowerCase()) {
  throw new Error('DAEMON_EXECUTOR_ADDRESS does not match DAEMON_EXECUTOR_KEY');
}

const mandateId = config.DEPLOYMENT_MANDATE_ID ?? randomUUID();
const budgetPerWindow = config.DEPLOYMENT_BUDGET_PER_WINDOW ?? '20';
const lifetimeCap = config.DEPLOYMENT_LIFETIME_CAP ?? '100';
const perPurchaseCap = config.DEPLOYMENT_PER_PURCHASE_CAP ?? '1';
const windowSeconds = Number(config.DEPLOYMENT_WINDOW_SECONDS ?? 86400);
const perSellerPct = Number(config.DEPLOYMENT_PER_SELLER_PCT ?? 3500);
const maxDepth = Number(config.DEPLOYMENT_MAX_DEPTH ?? 3);
const canonical = canonicalMandate({ owner: owner.address.toLowerCase() as `0x${string}`, operator: operator.address.toLowerCase() as `0x${string}`, budgetPerWindow, windowSeconds, lifetimeCap, perPurchaseCap, perSellerPct, maxDepth, chainId });
const client = new MandateClient(executorKey as `0x${string}`, { rpcUrl, rpcFallbackUrl, chainId });
const contractAddress = await client.deploy({
  owner: owner.address,
  operator: operator.address,
  enforcer: executor.address,
  usdc,
  budgetPerWindow: BigInt(Math.round(Number(budgetPerWindow) * 1e6)),
  windowSeconds,
  lifetimeCap: BigInt(Math.round(Number(lifetimeCap) * 1e6)),
  perPurchaseCap: BigInt(Math.round(Number(perPurchaseCap) * 1e6)),
  perSellerPct,
  maxDepth,
  rootWorker: workerKey(mandateId),
  rootAllocation: BigInt(Math.round(Number(lifetimeCap) * 1e6)),
});

  console.log(JSON.stringify({
    chain: chain.name,
    chain_id: chainId,
    contract_address: contractAddress,
    owner_address: owner.address,
    operator_address: operator.address,
    enforcer_address: executor.address,
    usdc_address: usdc,
    mandate_id: mandateId,
    canonical_mandate: canonical,
    note: 'Contract deployed only; vault funding and database registration are separate steps.',
  }, null, 2));
}

main().catch((error) => {
  console.error(`[deploy-bagmandate] ${(error as Error).message}`);
  process.exitCode = 1;
});
