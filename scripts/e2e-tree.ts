/**
 * Bagseven tree E2E on Polygon Amoy — root + spawn hierarchy + spends across the tree.
 *
 * Root → child A (50%) → grandchild C (50% of A); child B (25%). Verifies:
 * spawn depth cap (depth > max refused), spends from root/child/grandchild all
 * accrue to the shared window, per-purchase refusal, overview tree counts,
 * resolve for each node, and owner withdraw.
 *
 * Usage: pnpm exec tsx scripts/e2e-tree.ts
 */
import { readFileSync } from 'node:fs';
import { signMessage, privateKeyToAccount } from 'viem/accounts';
import { canonicalMandate, canonicalSpawn, spendIntentDomain, spendIntentTypes } from '@bagseven/onchain';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const CHAIN_ID = Number(env.CHAIN_ID ?? 80002);

const owner = privateKeyToAccount(env.OWNER_DEV_KEY as `0x${string}`);
// Distinct operator keys for each agent (only sign EIP-712 off-chain; no gas).
const ops = {
  root: privateKeyToAccount(env.OPERATOR_DEV_KEY as `0x${string}`),
  A: privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),
  B: privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f873a9a028cbc51fe025a'),
  C: privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'),
};
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
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? res.statusText), { code: json?.error?.code });
  return json;
}

async function spend(agentId: string, opKey: string, amount: string, nonce: number) {
  const op = privateKeyToAccount(opKey as `0x${string}`);
  const typed = { agentId, amount, recipient: PAYEE, nonce, timestamp: nonce, chainId: CHAIN_ID };
  const signature = await op.signTypedData({
    domain: spendIntentDomain(CHAIN_ID),
    types: spendIntentTypes,
    primaryType: 'SpendIntent',
    message: { ...typed, nonce: BigInt(nonce), timestamp: BigInt(nonce), chainId: BigInt(CHAIN_ID) },
  });
  return api('POST', '/v1/spend-intents', { agent_id: agentId, amount, recipient: PAYEE, nonce, timestamp: nonce, chain_id: CHAIN_ID, signature });
}

async function main(): Promise<void> {
  // 1. Create the mandate → the ROOT agent.
  const canonical = canonicalMandate({ owner: owner.address.toLowerCase() as `0x${string}`, operator: ops.root.address.toLowerCase() as `0x${string}`, budgetPerWindow: '20', windowSeconds: 86400, lifetimeCap: '100', perPurchaseCap: '1', perSellerPct: 3500, maxDepth: 3, chainId: CHAIN_ID });
  const sig = await signMessage({ message: canonical, privateKey: env.OWNER_DEV_KEY as `0x${string}` });
  const mandate = await api('POST', '/v1/mandates', { owner_address: owner.address, operator_address: ops.root.address, budget_per_window: '20', window_seconds: 86400, lifetime_cap: '100', per_purchase_cap: '1', per_seller_pct: 3500, max_depth: 3, chain_id: CHAIN_ID, signature: sig });
  const rootId = mandate.root_agent_id as string;
  log('root agent created (depth 0) + contract deployed on Polygon Amoy', !!mandate.contract_address, { contract: mandate.contract_address.slice(0, 10) + '…' });

  // 2. Fund the vault (master faucet, $15).
  const funded = await api('POST', `/v1/vaults/${mandate.mandate_id}/fund`, { amount: '15' });
  log('vault funded $15', funded.vault_balance === '15.00', { balance: funded.vault_balance });

  // 3. Spawn the tree: A(50%), B(25%), C(50% of A), D(50% of C = depth 3).
  const spawnUnder = async (parentId: string, op: { address: string }, share: number) => {
    const c = canonicalSpawn({ mandateId: mandate.mandate_id, parentAgentId: parentId, operator: op.address.toLowerCase() as `0x${string}`, sharePercent: share, chainId: CHAIN_ID });
    const s = await signMessage({ message: c, privateKey: env.OWNER_DEV_KEY as `0x${string}` });
    return api('POST', `/v1/mandates/${mandate.mandate_id}/spawn-agent`, { parent_agent_id: parentId, operator_address: op.address, share_percent: share, chain_id: CHAIN_ID, signature: s });
  };
  const childA = await spawnUnder(rootId, ops.A, 50);
  const childB = await spawnUnder(rootId, ops.B, 25);
  const childC = await spawnUnder(childA.agent_id, ops.C, 50);
  const childD = await spawnUnder(childC.agent_id, ops.root, 50); // depth 3 = allowed
  log('spawned A(50) B(25) C(50 of A) D(50 of C)', childA.depth === 1 && childB.depth === 1 && childC.depth === 2 && childD.depth === 3, { depths: [childA.depth, childB.depth, childC.depth, childD.depth] });

  // 4. Depth cap: a child under D would be depth 4 > max 3 → refused.
  let depthRefused = false;
  try {
    await spawnUnder(childD.agent_id, ops.A, 50);
  } catch (e) {
    depthRefused = (e as { code?: string }).code === 'EXCEEDS_MAX_DEPTH';
  }
  log('spawn at depth 4 refused (EXCEEDS_MAX_DEPTH)', depthRefused);

  // 5. Spends across the tree — all accrue to the shared window.
  const r1 = await spend(rootId, env.OPERATOR_DEV_KEY as string, '0.50', Math.floor(Date.now() / 1000));
  log('root spend $0.50 → allow + on-chain', r1.decision === 'allow' && !!r1.tx_hash, { tx: r1.tx_hash?.slice(0, 14) + '…' });

  const r2 = await spend(childA.agent_id, '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0.30', Math.floor(Date.now() / 1000) + 1);
  log('child A spend $0.30 → allow', r2.decision === 'allow');

  const r3 = await spend(childC.agent_id, '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', '0.20', Math.floor(Date.now() / 1000) + 2);
  log('grandchild C spend $0.20 → allow', r3.decision === 'allow');

  const refused = await spend(childA.agent_id, '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '2.00', Math.floor(Date.now() / 1000) + 3);
  log('child A spend $2 (> $1 cap) → refused by contract', refused.decision === 'refused' && refused.bound === 'PerTxCapExceeded', { bound: refused.bound });

  // 6. Overview reflects the whole tree.
  const overview = await api('GET', `/v1/mandates/${mandate.mandate_id}/overview`);
  const agents = (overview.agents as Array<{ depth: number; status: string }>) ?? [];
  log('overview: spent $1.00 window / 5 agents / 4 levels', overview.spent_this_window === '1.00' && agents.length === 5, { spent: overview.spent_this_window, agents: agents.length, levels: Math.max(...agents.map((a) => a.depth)) + 1, can_draw: overview.can_be_drawn_now });

  // 7. Resolve the root and a child → remaining spend.
  const rootResolve = await api('GET', `/v1/resolve?ref=${rootId}`);
  log('resolve root → remaining window $19', Number((rootResolve.remaining as { remaining_window?: string }).remaining_window) === 19, { remaining: (rootResolve.remaining as { remaining_window?: string }).remaining_window });

  // 8. Owner withdraw $5 (vault balance was 15 - 1.00 spent = 14; 14 - 5 = 9).
  const wc = ['bagseven-withdraw-v1', mandate.mandate_id, '5', owner.address.toLowerCase(), CHAIN_ID].join('|');
  const wsig = await signMessage({ message: wc, privateKey: env.OWNER_DEV_KEY as `0x${string}` });
  const withdrawn = await api('POST', `/v1/vaults/${mandate.mandate_id}/withdraw`, { amount: '5', to_address: owner.address, chain_id: CHAIN_ID, signature: wsig });
  log('owner withdraw $5 on-chain', !!withdrawn.tx_hash, { balance: withdrawn.vault_balance });

  console.log('\nTree E2E complete.');
}

main().catch((err) => {
  const e = err as { code?: string; stack?: string };
  console.error('[FATAL]', e.code, (err as Error).message);
  process.exit(1);
});
