/**
 * Bagseven end-to-end — the whole flow on the local anvil chain, contract-backed.
 *
 * Owner wallet → create+sign mandate (contract deployed) → fund vault → spawn a
 * child → operator-signed spend intents (allowed vs refused by the CONTRACT) →
 * overview / resolve / withdraw.
 *
 * Usage: pnpm exec tsx scripts/e2e-bagseven.ts
 * Requires: anvil on :8545 (./scripts/dev-chain.sh) + gateway + mandate service.
 */
import { readFileSync } from 'node:fs';
import { signMessage, privateKeyToAccount, parseUnits } from 'viem/accounts';
import { canonicalMandate, canonicalSpawn, canonicalWithdraw, recoverEip191, recoverSpendIntentSigner, spendIntentTypes, spendIntentDomain } from '@agentos/onchain';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const CHAIN_ID = Number(env.CHAIN_ID ?? 31337);

const owner = privateKeyToAccount(env.OWNER_DEV_KEY as `0x${string}`);
const operator = privateKeyToAccount(env.OPERATOR_DEV_KEY as `0x${string}`);
const PAYEE = '0x0000000000000000000000000000000000007777' as `0x${string}`;

function log(step: string, ok: boolean, detail?: unknown): void {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) process.exitCode = 1;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? res.statusText), { code: json?.error?.code, status: res.status });
  return json;
}

async function main(): Promise<void> {
  // 1. Create + sign a mandate (owner wallet).
  const caps = {
    owner_address: owner.address,
    operator_address: operator.address,
    budget_per_window: '20',
    window_seconds: 86400,
    lifetime_cap: '100',
    per_purchase_cap: '1',
    per_seller_pct: 3500,
    max_depth: 3,
    chain_id: CHAIN_ID,
  };
  const canonical = canonicalMandate({ owner: owner.address.toLowerCase() as any, operator: operator.address.toLowerCase() as any, budgetPerWindow: caps.budget_per_window, windowSeconds: 86400, lifetimeCap: '100', perPurchaseCap: '1', perSellerPct: 3500, maxDepth: 3, chainId: CHAIN_ID });
  const sig = await signMessage({ message: canonical, privateKey: env.OWNER_DEV_KEY as `0x${string}` });
  log('canonical mandate recovers to owner', (await recoverEip191(canonical, sig)) === owner.address);
  const mandate = await api('POST', '/v1/mandates', { ...caps, signature: sig });
  log('mandate created + contract deployed', !!mandate.contract_address, { contract: mandate.contract_address.slice(0, 10) + '…' });

  // 2. Fund the vault (backend faucet).
  const funded = await api('POST', `/v1/vaults/${mandate.mandate_id}/fund`, { amount: '50' });
  log('vault funded ($50)', funded.vault_balance === '50.00', { balance: funded.vault_balance });

// 3. Spawn a child at 50% (owner-signed) under the root agent.
  const rootAgentId = mandate.root_agent_id as string;
  const spawnCanonical = canonicalSpawn({ mandateId: mandate.mandate_id, parentAgentId: rootAgentId, operator: operator.address.toLowerCase() as `0x${string}`, sharePercent: 50, chainId: CHAIN_ID });
  const spawnSig = await signMessage({ message: spawnCanonical, privateKey: env.OWNER_DEV_KEY as `0x${string}` });
  const child = await api('POST', `/v1/mandates/${mandate.mandate_id}/spawn-agent`, { parent_agent_id: rootAgentId, operator_address: operator.address, share_percent: 50, chain_id: CHAIN_ID, signature: spawnSig });
  log('child spawned (50%, depth 1)', child.agent_id && child.depth === 1, { depth: child.depth });

  // 4. Operator-signed spend intent within bounds → allow + on-chain execute.
  const intent = { agentId: rootAgentId, amount: '0.50', recipient: PAYEE, nonce: 1, timestamp: Math.floor(Date.now() / 1000), chainId: CHAIN_ID };
  const typed = { ...intent, nonce: BigInt(intent.nonce), timestamp: BigInt(intent.timestamp), chainId: BigInt(intent.chainId) };
  const opSig = await operator.signTypedData({ domain: spendIntentDomain(CHAIN_ID), types: spendIntentTypes, primaryType: 'SpendIntent', message: typed });
  const allow = await api('POST', '/v1/spend-intents', { agent_id: rootAgentId, amount: '0.50', recipient: PAYEE, nonce: 1, timestamp: intent.timestamp, chain_id: CHAIN_ID, signature: opSig });
  log('operator spend $0.50 → allow + settled on-chain', allow.decision === 'allow' && !!allow.tx_hash, { tx: allow.tx_hash?.slice(0, 14) + '…' });

  // 5. Over per-purchase cap → refused by the contract, logged.
  const bad = await api('POST', '/v1/spend-intents', { agent_id: rootAgentId, amount: '2.00', recipient: PAYEE, nonce: 2, timestamp: intent.timestamp, chain_id: CHAIN_ID, signature: await operator.signTypedData({ domain: spendIntentDomain(CHAIN_ID), types: spendIntentTypes, primaryType: 'SpendIntent', message: { ...typed, amount: '2.00', nonce: 2n } }) });
  log('spend $2 (> $1 cap) → refused', bad.decision === 'refused' && bad.bound === 'PerTxCapExceeded', { bound: bad.bound });

  // 6. Overview reflects the spend.
  const overview = await api('GET', `/v1/mandates/${mandate.mandate_id}/overview`);
  log('overview: spent $0.50 / budget $20', overview.spent_this_window === '0.50', { spent: overview.spent_this_window, can_draw: overview.can_be_drawn_now });

  // 7. Refusals recorded.
  const refusals = await api('GET', `/v1/refusals?agent_id=${rootAgentId}`);
  log('refusal recorded', refusals.refusals.some((r: { bound: string }) => r.bound === 'PerTxCapExceeded'));

  // 8. Resolve returns remaining budget for the current root agent.
  const resolved = await api('GET', `/v1/resolve?ref=${rootAgentId}`);
  log("resolve returns mandate + remaining", !!resolved.mandate?.id && Number((resolved.remaining as { remaining_window?: string }).remaining_window ?? "0") === 19.5, { window: (resolved.remaining as { remaining_window?: string }).remaining_window });

  // 9. Owner withdraws $10.
  const wCanonical = canonicalWithdraw({ mandateId: mandate.mandate_id, amount: "10", to: owner.address.toLowerCase() as any, chainId: CHAIN_ID });
  const wSig = await signMessage({ message: wCanonical, privateKey: env.OWNER_DEV_KEY as `0x${string}` });
  const withdrawn = await api('POST', `/v1/vaults/${mandate.mandate_id}/withdraw`, { amount: '10', to_address: owner.address, chain_id: CHAIN_ID, signature: wSig });
  log('owner withdraw $10', !!withdrawn.tx_hash, { balance: withdrawn.vault_balance });

  console.log('\nE2E complete.');
}

main().catch((err) => {
  const e = err as { code?: string; stack?: string };
  console.error('[FATAL]', e.code, (err as Error).message);
  console.error((e.stack ?? '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});