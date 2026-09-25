/**
 * Phase-1B end-to-end verification: delegation, guardian-approval → token loop,
 * suspension fail-closed gate, spend-summary, and budget compensation.
 *
 * Runs fully off-chain (no settlement) — these features live in identity + policy.
 * Requires the gateway + identity + policy services to be running.
 *
 * Usage: pnpm exec tsx scripts/e2e-phase1b.ts
 */
import { Client } from '@agentos/sdk';
import { eq as eqMoney } from '@agentos/money';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';

function log(step: string, ok: boolean, detail?: unknown): void {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const consoleClient = new Client({ baseUrl: GATEWAY });
  const org = await consoleClient.createOrganization({ legal_name: 'Phase1B Org' });
  const guardian = await consoleClient.createGuardian({ type: 'human', org_id: org.organization.id });

  const parentRaw = await consoleClient.createAgent({
    owner_org_id: org.organization.id,
    guardian_id: guardian.guardian.id,
    display_name: 'Parent Agent',
    capabilities: ['trading', 'data-purchase'],
  });
  await consoleClient.confirmAgent(parentRaw.agent_id, guardian.guardian_token);
  const parent = new Client({ baseUrl: GATEWAY, agentId: parentRaw.agent_id, privateKeyPem: parentRaw.signing_private_key_pem });
  log('parent agent created + confirmed', true, parentRaw.agent_id);

  await parent.createPolicy({
    agent_id: parentRaw.agent_id,
    daily_budget: '100.00',
    max_transaction: '20.00',
    allowed_chains: ['sepolia'],
    allowed_categories: ['trading', 'data-purchase'],
    human_approval_threshold: '15.00',
    created_by: 'e2e-phase1b',
  });
  log('parent policy published (daily 100, approval > 15)', true);

  // --- Slice 1.7: delegation ---
  const child = await consoleClient.delegateAgent(
    parentRaw.agent_id,
    {
      display_name: 'Child Agent',
      capabilities: ['trading'],
      delegation_rules: { max_daily_budget: '40.00', max_transaction: '10.00', allowed_categories: ['trading'] },
    },
    guardian.guardian_token,
  );
  log('delegate child (valid strict subset) → active + policy', child.status === 'active' && !!child.policy, { child_id: child.agent_id, policy: child.policy });

  let overBudgetRejected = false;
  try {
    await consoleClient.delegateAgent(
      parentRaw.agent_id,
      { display_name: 'Too Big', delegation_rules: { max_daily_budget: '120.00', max_transaction: '5.00' } },
      guardian.guardian_token,
    );
  } catch (err) {
    overBudgetRejected = (err as { code?: string }).code === 'DELEGATION_SUBSET_VIOLATION';
  }
  log('delegate with over-budget child rejected (strict subset)', overBudgetRejected);

  const childClient = new Client({ baseUrl: GATEWAY, agentId: child.agent_id, privateKeyPem: child.signing_private_key_pem });

  const childSpend = await childClient.proposeSpend(
    child.agent_id,
    { amount: '5.00', currency: 'USDC', category: 'trading', chain: 'sepolia' },
    `child-${Date.now()}`,
  );
  log('child spend $5 within delegated budget → allow', childSpend.decision === 'allow', childSpend.remaining_daily_budget);

  const childOver = await childClient.proposeSpend(
    child.agent_id,
    { amount: '500.00', currency: 'USDC', category: 'trading', chain: 'sepolia' },
    `child-over-${Date.now()}`,
  );
  log('child spend $500 → deny (max_tx 10)', childOver.decision === 'deny', childOver.reason);

  // --- Guardian approval → token loop ---
  const approvalReq = await parent.proposeSpend(
    parentRaw.agent_id,
    { amount: '16.00', currency: 'USDC', category: 'trading', chain: 'sepolia' },
    `approval-${Date.now()}`,
  );
  log('above-threshold spend → pending_approval', approvalReq.decision === 'pending_approval' && !!approvalReq.approval_id, approvalReq.reason);

  const approved = await consoleClient.respondApproval(approvalReq.approval_id!, 'approved', guardian.guardian_token);
  log('guardian approves → spend_token minted', approved.decision === 'allow' && !!approved.spend_token, approved.spend_token?.slice(0, 24) + '…');

  // A second approval, rejected → no token.
  const approval2 = await parent.proposeSpend(
    parentRaw.agent_id,
    { amount: '16.00', currency: 'USDC', category: 'trading', chain: 'sepolia' },
    `approval2-${Date.now()}`,
  );
  const rejected = await consoleClient.respondApproval(approval2.approval_id!, 'rejected', guardian.guardian_token);
  log('guardian rejects → deny, no token', rejected.decision === 'deny' && !rejected.spend_token);

  // --- Spend summary + compensation (D1) ---
  const summary = await parent.spendSummary(parentRaw.agent_id);
  log('summary reflects child spend via children_spent ($5)', eqMoney(summary.children_spent, '5.00'), summary.children_spent);

  const compIntent = await childClient.proposeSpend(
    child.agent_id,
    { amount: '2.00', currency: 'USDC', category: 'trading', chain: 'sepolia' },
    `comp-${Date.now()}`,
  );
  const before = await parent.spendSummary(parentRaw.agent_id);
  log('after $2 more → children_spent $7', eqMoney(before.children_spent, '7.00'), before.children_spent);

  const comp = await childClient.compensate({
    decision_id: compIntent.decision_id,
    agent_id: child.agent_id,
    amount: '2.00',
    category: 'trading',
  });
  const after = await parent.spendSummary(parentRaw.agent_id);
  log('compensate $2 → children_spent back to $5', comp.applied && eqMoney(after.children_spent, '5.00'), after.children_spent);

  // Idempotent compensation: replaying is a no-op.
  const compAgain = await childClient.compensate({
    decision_id: compIntent.decision_id,
    agent_id: child.agent_id,
    amount: '2.00',
    category: 'trading',
  });
  log('replayed compensation is a no-op', compAgain.applied === false);

  // --- Fail-closed suspension gate (last — the parent is needed for earlier tests) ---
  await consoleClient.suspendAgent(parentRaw.agent_id, guardian.guardian_token);
  let suspendedBlocked = false;
  try {
    await parent.proposeSpend(
      parentRaw.agent_id,
      { amount: '1.00', currency: 'USDC', category: 'trading', chain: 'sepolia' },
      `susp-${Date.now()}`,
    );
  } catch (err) {
    // The gateway refuses to authenticate a suspended agent (401) — fail-closed.
    suspendedBlocked = [401, 403].includes((err as { status?: number }).status ?? 0);
  }
  log('suspended agent cannot spend (fail-closed)', suspendedBlocked);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});