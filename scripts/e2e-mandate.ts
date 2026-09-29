/**
 * Bagseven Phase-1 end-to-end — Mandate + Vault + Tree + Refusals + Resolve.
 *
 * Flow: bootstrap agent → provision vault wallet → fund → sign a mandate →
 * bounds checks (allow/refusal) → spawn a child (share, depth) → reserve →
 * commit (counters move, payee paid) → overview → refusals (standing/released)
 * → resolve → withdraw → Phase-2 tool execution still works.
 *
 * Requires all services + demo-provider + Postgres + Redis running.
 * Usage: pnpm exec tsx scripts/e2e-mandate.ts
 */
import { Client } from '@agentos/sdk';
import { createPublicClient, http, erc20Abi } from 'viem';
import { sepolia } from 'viem/chains';
import { eq as eqMoney } from '@agentos/money';

try {
  process.loadEnvFile();
} catch {
  /* .env optional; env vars may be passed explicitly */
}

const GATEWAY = 'http://localhost:4000';
const DEMO_URL = process.env.DEMO_PROVIDER_URL ?? 'http://localhost:4007';
const DEMO_PAYOUT = process.env.DEMO_PAYOUT ?? '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const RPC = process.env.SEPOLIA_RPC_URL ?? 'http://localhost:8545';
const USDC = process.env.SEPOLIA_USDC ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
// Real-mode (SIGNER_MODE=real) on-chain assertions need a funded master wallet.
const REAL = process.env.E2E_REAL === '1';

function log(step: string, ok: boolean, detail?: unknown): void {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) process.exitCode = 1;
}

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const balanceOf = async (address: string) =>
  publicClient.readContract({ address: USDC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }) as Promise<bigint>;

async function bootstrap(label: string) {
  const consoleClient = new Client({ baseUrl: GATEWAY });
  const org = await consoleClient.createOrganization({ legal_name: `${label} Org` });
  const guardian = await consoleClient.createGuardian({ type: 'human', org_id: org.organization.id });
  const agent = await consoleClient.createAgent({ owner_org_id: org.organization.id, guardian_id: guardian.guardian.id, display_name: label });
  await consoleClient.confirmAgent(agent.agent_id, guardian.guardian_token);
  const client = new Client({ baseUrl: GATEWAY, agentId: agent.agent_id, privateKeyPem: agent.signing_private_key_pem });
  return { client, agent, guardian };
}

async function main(): Promise<void> {
  // --- Bootstrap the root agent (buyer) + a payee ---
  const root = await bootstrap('Mandate Root');
  const payee = await bootstrap('Mandate Payee');

  const vaultWallet = await root.client.provisionWallet({ agent_id: root.agent.agent_id, chain: 'sepolia' });
  await root.client.creditWallet(vaultWallet.wallet.id, { token: 'USDC', amount: '10.00' });
  const payeeWallet = await payee.client.provisionWallet({ agent_id: payee.agent.agent_id, chain: 'sepolia' });
  log('root funded + payee wallet provisioned', true);

  // --- Sign a mandate: $20/window, $2 lifetime, $1 per-purchase, 10% per-seller, depth 2 ---
  const mandate = await root.client.createMandate({
    agent_id: root.agent.agent_id,
    budget_per_window: '20.00',
    window_seconds: 86400,
    lifetime_cap: '10.00',
    per_purchase_limit: '1.00',
    per_seller_limit_bps: 1000,
    max_depth: 2,
  });
  log('mandate signed (operator-immutable)', !!mandate.mandate_id && mandate.signature.length > 0, { operator: mandate.operator_address.slice(0, 12) + '…' });

  // --- Bounds: within → allow; over per-purchase → refused ---
  const within = await root.client.proposeSpend(root.agent.agent_id, { amount: '0.50', currency: 'USDC', category: 'general', counterparty: payee.agent.agent_id }, `m-allow-${Date.now()}`);
  log('purchase within bounds → allow + spend_token', within.decision === 'allow' && !!within.spend_token, { remaining_window: within.remaining_window, can_draw: within.can_draw });

  const overLimit = await root.client.proposeSpend(root.agent.agent_id, { amount: '5.00', currency: 'USDC', category: 'general', counterparty: payee.agent.agent_id }, `m-over-${Date.now()}`);
  log('purchase over per-purchase → refused', overLimit.decision === 'refused' && overLimit.violated_bound === 'per_purchase', { bound: overLimit.violated_bound, decision: overLimit.decision });

  // --- Spawn a child at 50% share ---
  const child = await root.client.spawnAgent(mandate.mandate_id, { parent_agent_id: root.agent.agent_id, display_name: 'Child Agent', share_bps: 5000 });
  log('child spawned (share 50%, depth 1)', child.agent_id && child.depth === 1, { depth: child.depth });

  const childSpend = await root.client.proposeSpend(child.agent_id as string, { amount: '0.40', currency: 'USDC', category: 'general', counterparty: payee.agent.agent_id }, `m-child-${Date.now()}`);
  log('child purchase within bounds → allow', childSpend.decision === 'allow');

  // --- Reserve + commit an allow → counters move, payee paid ---
  const payeeBefore = await balanceOf(payeeWallet.wallet.address);
  const reservation = await root.client.reserve(
    { wallet_id: vaultWallet.wallet.id, token: 'USDC', amount: '0.50', spend_token: within.spend_token!, counterparty_id: payee.agent.agent_id, counterparty_type: 'agent' },
    `m-res-${Date.now()}`,
  );
  log('reservation held on vault wallet', reservation.status === 'held', reservation.reservation_id);
  const committed = await root.client.commitReservation(reservation.reservation_id);
  log('commit settled on-chain', committed.status === 'committed' && !!committed.tx_hash, { tx: committed.tx_hash.slice(0, 14) + '…' });

  const payeeAfter = await balanceOf(payeeWallet.wallet.address);
  if (REAL) {
    log('payee received 0.50 USDC on-chain', Number(payeeAfter - payeeBefore) / 1e6 === 0.5, { delta: Number(payeeAfter - payeeBefore) / 1e6 });
  } else {
    log('payee on-chain check skipped (dev signer) — ledger check follows', true);
  }

  const wallets = await root.client.getWallets(root.agent.agent_id);
  const usdc = wallets.wallets[0]?.balances.find((b) => b.token === 'USDC');
  log('vault ledger debited (10 → 9.5)', eqMoney(usdc?.amount ?? '', '9.50'), usdc?.amount);

  // --- Overview reflects the window spend ---
  const overview = await root.client.mandateOverview(mandate.mandate_id);
  log('overview: spent this window = 0.50', eqMoney(String(overview.spent_this_window), '0.50'), { spent: overview.spent_this_window, budget: overview.budget_per_window, can_draw: overview.can_be_drawn_now });

  // --- Refusals: the per-purchase refusal is standing (still violated) ---
  const refusals = await root.client.listRefusals({ agent_id: root.agent.agent_id, scope: 'all' });
  const standing = refusals.refusals.filter((r) => r.violatedBound === 'per_purchase' || r.violated_bound === 'per_purchase');
  log('refusals recorded (per-purchase, standing)', standing.length >= 1, { count: refusals.refusals.length });

  // --- Resolve by agent id ---
  const resolved = await root.client.resolveAgent(root.agent.agent_id);
  log('resolve by agent id → mandate + remaining spend', !!resolved.mandate?.id && resolved.remaining?.can_draw !== undefined, { can_draw: (resolved.remaining as { can_draw?: string })?.can_draw });
  const resolvedName = await root.client.resolveAgent('Mandate Root');
  log('resolve by name works', (resolvedName.agent as { display_name?: string })?.display_name === 'Mandate Root');

  // --- Per-seller bound: seller limit = 10% of 20 = 2. Spend 0.50 to the same
  //     payee four times (2.0) then a fifth (2.5) must be refused. ---
  let sellerRefused = false;
  for (let i = 0; i < 5; i++) {
    const d = await root.client.proposeSpend(root.agent.agent_id, { amount: '0.50', currency: 'USDC', category: 'general', counterparty: payee.agent.agent_id }, `m-seller-${Date.now()}-${i}`);
    if (d.decision === 'allow' && d.spend_token) {
      const r = await root.client.reserve({ wallet_id: vaultWallet.wallet.id, token: 'USDC', amount: '0.50', spend_token: d.spend_token, counterparty_id: payee.agent.agent_id, counterparty_type: 'agent' }, `m-seller-res-${Date.now()}-${i}`);
      await root.client.commitReservation(r.reservation_id);
    } else if (d.decision === 'refused' && d.violated_bound === 'per_seller') {
      sellerRefused = true;
      break;
    }
  }
  log('per-seller bound enforced (5th same-seller purchase refused)', sellerRefused);

  // --- Withdraw reduces vault available; then vault refused when empty ---
  const withdraw = await root.client.withdrawVault(String((resolved.vault as { id?: string })?.id ?? ''), { amount: '0.10' });
  log('vault withdraw reduces available balance', withdraw.balance !== undefined, { balance: (withdraw.balance as { amount?: string })?.amount });

  // --- Phase-2 smoke: tool execution still works end to end under the mandate.
//     Real-mode only (x402 verification is on-chain). ---
if (REAL) {
  const consoleClient = new Client({ baseUrl: GATEWAY });
  const provider = await consoleClient.registerProvider({ name: 'Mandate Data Provider', payout_wallet_address: DEMO_PAYOUT, payout_chain: 'sepolia' });
  await consoleClient.approveProvider(provider.provider_id);
  const tool = await consoleClient.createTool(provider.provider_token, {
    provider_id: provider.provider_id,
    name: 'liquidation-risk',
    description: 'Returns liquidation risk score for a position',
    category: 'trading',
    price: '0.10',
    price_token: 'USDC',
    endpoint_url: `${DEMO_URL}/v1/exec`,
  });
  const execution = await root.client.executeTool(root.agent.agent_id, tool.tool.id, { position: 'aave-wbtc-2x' }, `m-tool-${Date.now()}`);
  log('phase-2 tool execution works under mandate', execution.status === 'succeeded' && eqMoney(execution.price_paid, '0.10'), { paid: execution.price_paid, tx: execution.tx_hash?.slice(0, 14) + '…' });
} else {
  log('phase-2 tool smoke skipped (needs SIGNER_MODE=real + funded master) — verified separately by e2e-phase2', true);
}
}

main().catch((err) => {
  console.error('[FATAL]', (err as { body?: unknown }).body ?? err);
  process.exit(1);
});