import { readFileSync } from 'node:fs';
import { canonicalMandate } from '@bagseven/onchain';
import { privateKeyToAccount } from 'viem/accounts';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && process.env[line.slice(0, i)] === undefined) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch { /* optional */ }

const policy = process.env.POLICY_URL ?? 'http://127.0.0.1:4003';
const owner = privateKeyToAccount((process.env.DEMO_OWNER_KEY ?? process.env.OWNER_DEV_KEY) as `0x${string}`);
const operator = privateKeyToAccount((process.env.DEMO_OPERATOR_KEY ?? process.env.OPERATOR_DEV_KEY) as `0x${string}`);
const chainId = Number(process.env.CHAIN_ID ?? 31337);
const caps = {
  owner_address: owner.address,
  operator_address: operator.address,
  budget_per_window: process.env.DEMO_BUDGET ?? '10.00',
  window_seconds: Number(process.env.DEMO_WINDOW_SECONDS ?? 86400),
  lifetime_cap: process.env.DEMO_LIFETIME_CAP ?? '10.00',
  per_purchase_cap: process.env.DEMO_PER_PURCHASE_CAP ?? '1.00',
  per_seller_pct: Number(process.env.DEMO_PER_SELLER_PCT ?? 3500),
  max_depth: Number(process.env.DEMO_MAX_DEPTH ?? 2),
  chain_id: chainId,
};
const signature = await owner.signMessage({ message: canonicalMandate({ owner: owner.address, operator: operator.address, budgetPerWindow: caps.budget_per_window, windowSeconds: caps.window_seconds, lifetimeCap: caps.lifetime_cap, perPurchaseCap: caps.per_purchase_cap, perSellerPct: caps.per_seller_pct, maxDepth: caps.max_depth, chainId }) });
const response = await fetch(`${policy}/v1/mandates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...caps, signature }) });
const payload = await response.json();
if (!response.ok) throw new Error(JSON.stringify(payload));
console.log(JSON.stringify({ mandate: payload, owner: owner.address, operator: operator.address }, null, 2));
console.log('\n# Bind MCP to the returned root worker:');
console.log(`BAGSEVEN_MCP_WORKER=${payload.root_agent_id}`);
console.log(`DEMO_AGENT_PROVIDER_URL=${process.env.DEMO_AGENT_PROVIDER_URL ?? 'http://127.0.0.1:4007/weather'}`);
if (process.env.DEMO_ALLOW_FUNDING === 'true' && process.env.DEMO_SETUP_FUND_AMOUNT) {
  const funded = await fetch(`${policy}/v1/vaults/${payload.mandate_id}/fund`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: process.env.DEMO_SETUP_FUND_AMOUNT }) });
  console.log(JSON.stringify({ funding: await funded.json() }, null, 2));
} else {
  console.log('# Funding skipped. Set DEMO_ALLOW_FUNDING=true and DEMO_SETUP_FUND_AMOUNT explicitly to fund a local demo vault.');
}
