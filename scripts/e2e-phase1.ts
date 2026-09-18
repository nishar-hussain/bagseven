/**
 * Phase 1 end-to-end manual verification script (slices 1.1–1.9).
 *
 * Runs the full money-moving loop against the gateway:
 *   create org -> guardian -> agent -> confirm -> provision wallet -> fund (dev faucet)
 *   -> publish policy -> over-limit spend DENIED -> in-limit spend ALLOWED + spend_token
 *   -> reserve -> commit -> receipt.
 *
 * Usage:  pnpm exec tsx scripts/e2e-phase1.ts  (gateway + services must be running)
 */
import { Client } from '@agentos/sdk';
import { eq as eqMoney } from '@agentos/money';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const COUNTERPARTY = crypto.randomUUID();

function log(step: string, ok: boolean, detail?: unknown): void {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${step}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const consoleClient = new Client({ baseUrl: GATEWAY });

  // 1.1 Create org + guardian + agent
  const org = await consoleClient.createOrganization({ legal_name: 'E2E Test Org' });
  log('create org', !!org.organization.id, org.organization.id);

  const guardian = await consoleClient.createGuardian({
    type: 'human',
    org_id: org.organization.id,
    contact_email: 'guardian@example.com',
  });
  log('create guardian', !!guardian.guardian_token, { guardian_id: guardian.guardian.id });

  const agent = await consoleClient.createAgent({
    owner_org_id: org.organization.id,
    guardian_id: guardian.guardian.id,
    display_name: 'E2E Trading Agent',
    capabilities: ['trading', 'data-purchase'],
  });
  log('create agent (slice 1.1)', !!agent.signing_private_key_pem, { agent_id: agent.agent_id, status: agent.status });

  // 1.2 Guardian confirms -> active
  const confirmed = await consoleClient.confirmAgent(agent.agent_id, guardian.guardian_token);
  log('guardian confirms agent -> active (slice 1.2)', confirmed.status === 'active', confirmed.status);

  const agentClient = new Client({ baseUrl: GATEWAY, agentId: agent.agent_id, privateKeyPem: agent.signing_private_key_pem });

  // 1.3 Provision wallet + fund via dev faucet
  const wallet = await agentClient.provisionWallet({ agent_id: agent.agent_id, chain: 'base-sepolia' });
  log('provision wallet (slice 1.3)', !!wallet.wallet.address, { wallet_id: wallet.wallet.id, address: wallet.wallet.address });

  const funded = await agentClient.creditWallet(wallet.wallet.id, { token: 'USDC', amount: '100.00' });
  log('dev faucet funds wallet', eqMoney(funded.balance.amount, '100.00'), funded.balance.amount);

  // 1.4 Publish policy
  await agentClient.createPolicy({
    agent_id: agent.agent_id,
    daily_budget: '50.00',
    max_transaction: '20.00',
    allowed_chains: ['base-sepolia'],
    allowed_categories: ['trading', 'data-purchase'],
    category_limits: { 'data-purchase': { daily_budget: '10.00', max_per_tx: '5.00' } },
    human_approval_threshold: '15.00',
    created_by: 'e2e-script',
  });
  log('publish policy (slice 1.4)', true);

  // 1.4 Over-limit spend -> deterministic DENY
  const denied = await agentClient.proposeSpend(
    agent.agent_id,
    { amount: '500.00', currency: 'USDC', category: 'trading', chain: 'base-sepolia', counterparty: COUNTERPARTY },
    'idem-1',
  );
  log('over-limit spend DENIED', denied.decision === 'deny', denied.reason);

  // 1.4 In-limit spend -> ALLOW + spend_token
  const allowed = await agentClient.proposeSpend(
    agent.agent_id,
    { amount: '3.00', currency: 'USDC', category: 'data-purchase', chain: 'base-sepolia', counterparty: COUNTERPARTY },
    'idem-2',
  );
  log('in-limit spend ALLOWED + token (slice 1.5)', allowed.decision === 'allow' && !!allowed.spend_token, {
    decision_id: allowed.decision_id,
    remaining: allowed.remaining_daily_budget,
  });

  // D5 idempotency: same intent + same key -> same decision_id
  const allowedAgain = await agentClient.proposeSpend(
    agent.agent_id,
    { amount: '3.00', currency: 'USDC', category: 'data-purchase', chain: 'base-sepolia', counterparty: COUNTERPARTY },
    'idem-2',
  );
  log('idempotent retry returns same decision (D5)', allowedAgain.decision_id === allowed.decision_id);

  // 1.4 Category daily budget: 3 spent, category daily = 10 -> 8 more would exceed -> DENY
  const catDenied = await agentClient.proposeSpend(
    agent.agent_id,
    { amount: '8.00', currency: 'USDC', category: 'data-purchase', chain: 'base-sepolia', counterparty: COUNTERPARTY },
    'idem-3',
  );
  log('category daily budget DENIED (D3)', catDenied.decision === 'deny', catDenied.reason);

  // 1.5 Reserve + commit with spend_token
  const reserved = await agentClient.reserve(
    {
      wallet_id: wallet.wallet.id,
      token: 'USDC',
      amount: '3.00',
      spend_token: allowed.spend_token!,
      counterparty_id: COUNTERPARTY,
      counterparty_type: 'agent',
    },
    'idem-4',
  );
  log('reserve held (slice 1.5)', reserved.status === 'held', reserved.reservation_id);

  const committed = await agentClient.commitReservation(reserved.reservation_id);
  log('commit -> settled with tx_hash (slice 1.5)', committed.status === 'committed' && !!committed.tx_hash, committed.tx_hash);

  // 1.9 Receipt written
  const receipts = await agentClient.getAgentReceipts(agent.agent_id);
  log('receipt created (slice 1.9)', receipts.receipts.length >= 1, receipts.receipts[0]?.id);

  // Balances: 100 - 3 = 97 available, 0 reserved
  const after = await agentClient.getWallets(agent.agent_id);
  const usdc = after.wallets[0]?.balances.find((b) => b.token === 'USDC');
  log('balance debited 100 -> 97', eqMoney(usdc?.amount ?? '', '97.00'), usdc?.amount);
  log('reserved drained to 0', eqMoney(usdc?.reservedAmount ?? '', '0'), usdc?.reservedAmount);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});