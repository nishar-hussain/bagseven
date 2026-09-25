import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agents, guardians, guardianApprovals, policies, policyChecks } from '@agentos/db';
import { validateMoney, sub } from '@agentos/money';
import { hashApiKey, newJti, signSpendToken } from '@agentos/auth';
import { emit } from '@agentos/events';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { evaluatePolicy, normalizeAction, type PolicyModel } from './policy.js';
import { checkAndIncrement, currentCategory, currentChildrenSpent, currentMonthly, currentSpend, parentRemaining } from './counters.js';
import { compensate } from './compensate.js';
import { validateDelegationSubset } from './delegation.js';
import { getPolicySigningKey } from './key.js';

const createPolicySchema = z.object({
  agent_id: z.string().uuid(),
  daily_budget: z.string().min(1),
  monthly_budget: z.string().optional(),
  max_transaction: z.string().min(1),
  allowed_chains: z.array(z.string()).optional(),
  allowed_tools: z.array(z.string()).optional(),
  allowed_categories: z.array(z.string()).optional(),
  category_limits: z
    .record(z.string(), z.object({ max_per_tx: z.string().optional(), daily_budget: z.string().optional() }))
    .optional(),
  human_approval_threshold: z.string().optional(),
  delegation_rules: z
    .object({
      max_child_daily_budget: z.string().optional(),
      max_child_transaction: z.string().optional(),
      allowed_capabilities: z.array(z.string()).optional(),
    })
    .optional(),
  created_by: z.string().default('console'),
});

const spendIntentSchema = z.object({
  agent_id: z.string().uuid(),
  amount: z.string().min(1),
  currency: z.string().default('USDC'),
  category: z.string().default('general'),
  chain: z.string().optional(),
  counterparty_id: z.string().uuid().nullable().optional(),
  tool_id: z.string().optional(),
  data_offer_id: z.string().optional(),
});

const respondApprovalSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

const compensateSchema = z.object({
  decision_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  amount: z.string().min(1),
  category: z.string(),
  include_monthly: z.boolean().default(true),
});

const TOKEN_TTL_SECONDS = 30;

async function getActivePolicy(db: ServiceDeps['db'], agentId: string): Promise<PolicyModel | null> {
  const row = await db.query.policies.findFirst({
    where: and(eq(policies.agentId, agentId), isNull(policies.supersededAt)),
    orderBy: desc(policies.version),
  });
  if (!row) return null;
  return {
    id: row.id,
    agent_id: row.agentId,
    version: row.version,
    daily_budget: row.dailyBudget,
    monthly_budget: row.monthlyBudget,
    max_transaction: row.maxTransaction,
    allowed_chains: (row.allowedChains as string[]) ?? [],
    allowed_tools: (row.allowedTools as string[]) ?? [],
    allowed_categories: (row.allowedCategories as string[]) ?? [],
    category_limits: (row.categoryLimits as Record<string, { max_per_tx?: string; daily_budget?: string }>) ?? {},
    human_approval_threshold: row.humanApprovalThreshold,
  };
}

async function writeAudit(
  db: ServiceDeps['db'],
  input: { agentId: string; policyVersion: number; action: unknown; decision: 'allow' | 'deny' | 'pending_approval'; reason?: string; decisionId: string },
): Promise<void> {
  await db.insert(policyChecks).values({
    agentId: input.agentId,
    policyVersion: input.policyVersion,
    requestedAction: input.action,
    decision: input.decision,
    reason: input.reason,
    decisionId: input.decisionId,
  });
}

async function ancestorChain(db: ServiceDeps['db'], agentId: string): Promise<string[]> {
  const ids: string[] = [];
  let cur = (await db.query.agents.findFirst({ where: eq(agents.id, agentId) }))?.parentAgentId ?? null;
  while (cur) {
    ids.push(cur);
    const parent = await db.query.agents.findFirst({ where: eq(agents.id, cur) });
    cur = parent?.parentAgentId ?? null;
  }
  return ids;
}

async function verifyGuardian(db: ServiceDeps['db'], agentId: string, token: string | undefined): Promise<void> {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
  const guardian = await db.query.guardians.findFirst({ where: eq(guardians.id, agent.guardianId) });
  if (!guardian || !guardian.guardianTokenHash) throw new ApiError(403, 'FORBIDDEN', 'guardian token required');
  if (typeof token !== 'string' || hashApiKey(token) !== guardian.guardianTokenHash) {
    throw new ApiError(403, 'FORBIDDEN', 'invalid guardian token');
  }
}

export function buildPolicyRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  app.post('/v1/policies', async (req) => {
    const body = createPolicySchema.parse(req.body);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agent_id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');

    validateMoney(body.daily_budget);
    validateMoney(body.max_transaction);
    if (body.monthly_budget) validateMoney(body.monthly_budget);
    if (body.human_approval_threshold) validateMoney(body.human_approval_threshold);

    // Delegation can only narrow, never widen (D2): enforced at creation time.
    if (agent.parentAgentId) {
      const parentPolicy = await getActivePolicy(db, agent.parentAgentId);
      if (!parentPolicy) throw new ApiError(400, 'PARENT_NO_POLICY', 'parent agent has no active policy to delegate from');
      const parentRemainingBudget = await parentRemaining(redis, agent.parentAgentId, parentPolicy.daily_budget);
      const errors = validateDelegationSubset(
        parentPolicy,
        {
          daily_budget: body.daily_budget,
          max_transaction: body.max_transaction,
          allowed_chains: body.allowed_chains,
          allowed_categories: body.allowed_categories,
        },
        parentRemainingBudget,
      );
      if (errors.length > 0) throw new ApiError(400, 'DELEGATION_SUBSET_VIOLATION', errors.join('; '));
    }

    let result: typeof policies.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      await tx.update(policies).set({ supersededAt: new Date() }).where(and(eq(policies.agentId, body.agent_id), isNull(policies.supersededAt)));
      const [maxRow] = await tx
        .select({ maxVersion: policies.version })
        .from(policies)
        .where(eq(policies.agentId, body.agent_id))
        .orderBy(desc(policies.version))
        .limit(1);
      const version = (maxRow?.maxVersion ?? 0) + 1;
      const [created] = await tx
        .insert(policies)
        .values({
          agentId: body.agent_id,
          version,
          dailyBudget: body.daily_budget,
          monthlyBudget: body.monthly_budget ?? null,
          maxTransaction: body.max_transaction,
          allowedChains: body.allowed_chains ?? [],
          allowedTools: body.allowed_tools ?? [],
          allowedCategories: body.allowed_categories ?? [],
          categoryLimits: body.category_limits ?? {},
          humanApprovalThreshold: body.human_approval_threshold ?? null,
          delegationRules: body.delegation_rules ?? null,
          createdBy: body.created_by,
        })
        .returning();
      if (!created) throw new ApiError(500, 'POLICY_CREATE_FAILED', 'policy insert returned no row');
      result = created;
      await emit(tx, 'policy.version.created', body.agent_id, { agent_id: body.agent_id, version, created_by: body.created_by });
    });
    if (!result) throw new ApiError(500, 'POLICY_CREATE_FAILED', 'policy missing after transaction');

    return { policy_id: result.id, agent_id: body.agent_id, version: result.version };
  });

  app.get('/v1/policies/:agentId/active', async (req) => {
    const { agentId } = req.params as { agentId: string };
    const policy = await getActivePolicy(db, agentId);
    if (!policy) throw new ApiError(404, 'NOT_FOUND', 'no active policy for agent');
    return { policy };
  });

  // The hot path. D4: any error => 5xx/403, never a false allow.
  app.post('/v1/spend-intents', async (req) => {
    const body = spendIntentSchema.parse(req.body);
    const action = normalizeAction(body);
    const chain = action.chain ?? config.DEFAULT_CHAIN ?? 'sepolia';

    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agent_id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');

    // D4 fail-closed: a non-active agent cannot receive any policy decision.
    if (agent.status !== 'active') {
      const decisionId = randomUUID();
      await writeAudit(db, { agentId: body.agent_id, policyVersion: 0, action, decision: 'deny', reason: `agent not active (${agent.status})`, decisionId });
      return { decision: 'deny', decision_id: decisionId, reason: `agent not active (${agent.status})` };
    }

    const policy = await getActivePolicy(db, body.agent_id);
    if (!policy) {
      const decisionId = randomUUID();
      await writeAudit(db, { agentId: body.agent_id, policyVersion: 0, action, decision: 'deny', reason: 'no active policy', decisionId });
      return { decision: 'deny', decision_id: decisionId, reason: 'no active policy' };
    }

    const evalResult = evaluatePolicy(policy, action);

    if (evalResult.outcome === 'pending_approval') {
      const decisionId = randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [approval] = await db
        .insert(guardianApprovals)
        .values({ agentId: body.agent_id, decisionId, requestedAction: action, status: 'pending', expiresAt })
        .returning();
      if (!approval) throw new ApiError(500, 'APPROVAL_FAILED', 'guardian approval insert returned no row');
      await writeAudit(db, { agentId: body.agent_id, policyVersion: policy.version, action, decision: 'pending_approval', reason: evalResult.reason, decisionId });
      await emit(db, 'identity.guardian_approval.requested', body.agent_id, {
        approval_id: approval.id,
        agent_id: body.agent_id,
        requested_action: action,
      });
      return {
        decision: 'pending_approval',
        decision_id: decisionId,
        reason: evalResult.reason,
        requires_human_approval: true,
        approval_id: approval.id,
      };
    }

    if (evalResult.outcome === 'deny') {
      const decisionId = randomUUID();
      await writeAudit(db, { agentId: body.agent_id, policyVersion: policy.version, action, decision: 'deny', reason: evalResult.reason, decisionId });
      await emit(db, 'policy.decision.made', body.agent_id, { decision_id: decisionId, agent_id: body.agent_id, decision: 'deny', reason: evalResult.reason });
      return { decision: 'deny', decision_id: decisionId, reason: evalResult.reason };
    }

    // ALLOW path: atomic budget gate in Redis (D2/D3/D5).
    const catLimit = policy.category_limits[action.category]?.daily_budget ?? null;

    const ancestors: Array<{ agentId: string; dailyBudget: string }> = [];
    let parentId = agent.parentAgentId;
    while (parentId) {
      const parent = await db.query.agents.findFirst({ where: eq(agents.id, parentId) });
      if (!parent) break;
      const parentPolicy = await getActivePolicy(db, parentId);
      if (parentPolicy) ancestors.push({ agentId: parentId, dailyBudget: parentPolicy.daily_budget });
      parentId = parent.parentAgentId;
    }

    const budget = await checkAndIncrement(redis, {
      amount: action.amount,
      dailyBudget: policy.daily_budget,
      monthlyBudget: policy.monthly_budget,
      categoryDailyLimit: catLimit,
      category: action.category,
      ancestors,
      agentId: body.agent_id,
    });

    if (!budget.allowed) {
      const decisionId = randomUUID();
      await writeAudit(db, { agentId: body.agent_id, policyVersion: policy.version, action, decision: 'deny', reason: budget.reason, decisionId });
      await emit(db, 'policy.decision.made', body.agent_id, { decision_id: decisionId, agent_id: body.agent_id, decision: 'deny', reason: budget.reason });
      return { decision: 'deny', decision_id: decisionId, reason: budget.reason };
    }

    const decisionId = randomUUID();
    const now = Date.now();
    const claims = {
      v: 1 as const,
      decision_id: decisionId,
      agent_id: body.agent_id,
      amount: action.amount,
      currency: action.currency,
      chain,
      category: action.category,
      counterparty_id: action.counterparty_id ?? null,
      iat: new Date(now).toISOString(),
      exp: new Date(now + TOKEN_TTL_SECONDS * 1000).toISOString(),
      jti: newJti(),
    };

    const { privateKeyPem } = getPolicySigningKey(config);
    const spendToken = signSpendToken(claims, privateKeyPem);

    await writeAudit(db, { agentId: body.agent_id, policyVersion: policy.version, action, decision: 'allow', decisionId });
    await emit(db, 'policy.decision.made', body.agent_id, { decision_id: decisionId, agent_id: body.agent_id, decision: 'allow' });

    const remainingDaily = sub(policy.daily_budget, budget.newDailySpent);
    return {
      decision: 'allow',
      decision_id: decisionId,
      spend_token: spendToken,
      remaining_daily_budget: remainingDaily,
      matched_policy_rule: catLimit ? `category:${action.category} daily_budget` : 'daily_budget',
      requires_human_approval: false,
    };
  });

  app.get('/v1/policy-checks/:decisionId', async (req) => {
    const { decisionId } = req.params as { decisionId: string };
    const check = await db.query.policyChecks.findFirst({ where: eq(policyChecks.decisionId, decisionId) });
    if (!check) throw new ApiError(404, 'NOT_FOUND', 'decision not found');
    return { policy_check: check };
  });

  // Guardian approval → token loop. Approving re-checks the CURRENT budget and mints
  // the token; rejecting records the decision. Budget is only consumed on approval.
  app.post('/v1/guardian-approvals/:id/respond', async (req) => {
    const { id } = req.params as { id: string };
    const body = respondApprovalSchema.parse(req.body);
    const approval = await db.query.guardianApprovals.findFirst({ where: eq(guardianApprovals.id, id) });
    if (!approval) throw new ApiError(404, 'NOT_FOUND', 'approval not found');
    if (approval.status !== 'pending') throw new ApiError(409, 'ALREADY_RESPONDED', `approval is ${approval.status}`);
    if (approval.expiresAt < new Date()) throw new ApiError(409, 'EXPIRED', 'approval has expired');
    await verifyGuardian(db, approval.agentId, req.headers['x-guardian-token'] as string | undefined);

    if (body.status === 'rejected') {
      await db.update(guardianApprovals).set({ status: 'rejected', respondedAt: new Date() }).where(eq(guardianApprovals.id, id));
      await emit(db, 'identity.guardian_approval.responded', approval.agentId, { approval_id: id, agent_id: approval.agentId, status: 'rejected' });
      return { status: 'rejected', decision: 'deny', reason: 'rejected by guardian' };
    }

    const action = approval.requestedAction as ReturnType<typeof normalizeAction>;
    const policy = await getActivePolicy(db, approval.agentId);
    if (!policy) throw new ApiError(409, 'NO_POLICY', 'no active policy to issue against');
    const chain = action.chain ?? config.DEFAULT_CHAIN ?? 'sepolia';
    const catLimit = policy.category_limits[action.category]?.daily_budget ?? null;

    const ancestors: Array<{ agentId: string; dailyBudget: string }> = [];
    let parentId = (await db.query.agents.findFirst({ where: eq(agents.id, approval.agentId) }))?.parentAgentId ?? null;
    while (parentId) {
      const parent = await db.query.agents.findFirst({ where: eq(agents.id, parentId) });
      if (!parent) break;
      const parentPolicy = await getActivePolicy(db, parentId);
      if (parentPolicy) ancestors.push({ agentId: parentId, dailyBudget: parentPolicy.daily_budget });
      parentId = parent.parentAgentId;
    }

    const budget = await checkAndIncrement(redis, {
      amount: action.amount,
      dailyBudget: policy.daily_budget,
      monthlyBudget: policy.monthly_budget,
      categoryDailyLimit: catLimit,
      category: action.category,
      ancestors,
      agentId: approval.agentId,
    });

    if (!budget.allowed) {
      await db.update(guardianApprovals).set({ status: 'rejected', respondedAt: new Date() }).where(eq(guardianApprovals.id, id));
      await emit(db, 'identity.guardian_approval.responded', approval.agentId, { approval_id: id, status: 'rejected', reason: budget.reason });
      return { status: 'rejected', decision: 'deny', reason: budget.reason };
    }

    const decisionId = approval.decisionId ?? randomUUID();
    const now = Date.now();
    const claims = {
      v: 1 as const,
      decision_id: decisionId,
      agent_id: approval.agentId,
      amount: action.amount,
      currency: action.currency,
      chain,
      category: action.category,
      counterparty_id: action.counterparty_id ?? null,
      iat: new Date(now).toISOString(),
      exp: new Date(now + TOKEN_TTL_SECONDS * 1000).toISOString(),
      jti: newJti(),
    };
    const spendToken = signSpendToken(claims, getPolicySigningKey(config).privateKeyPem);

    await db.update(guardianApprovals).set({ status: 'approved', respondedAt: new Date() }).where(eq(guardianApprovals.id, id));
    await emit(db, 'identity.guardian_approval.responded', approval.agentId, { approval_id: id, status: 'approved' });
    await emit(db, 'policy.decision.made', approval.agentId, { decision_id: decisionId, decision: 'allow', source: 'guardian_approval' });
    return {
      status: 'approved',
      decision: 'allow',
      decision_id: decisionId,
      spend_token: spendToken,
      remaining_daily_budget: sub(policy.daily_budget, budget.newDailySpent),
    };
  });

  // D1: decrement spend counters when a settlement fails / reservation is released.
  app.post('/v1/compensations', async (req) => {
    const body = compensateSchema.parse(req.body);
    const ancestors = await ancestorChain(db, body.agent_id);
    const result = await compensate(redis, {
      decisionId: body.decision_id,
      agentId: body.agent_id,
      amount: validateMoney(body.amount),
      category: body.category,
      includeMonthly: body.include_monthly,
      ancestors,
    });
    return { applied: result.applied };
  });

  app.get('/v1/agents/:id/spend-summary', async (req) => {
    const { id } = req.params as { id: string };
    const policy = await getActivePolicy(db, id);
    if (!policy) throw new ApiError(404, 'NOT_FOUND', 'no active policy for agent');
    const daily = await currentSpend(redis, id, 'general');
    const monthly = await currentMonthly(redis, id);
    const childrenSpent = await currentChildrenSpent(redis, id);
    const categories: Record<string, { limit?: { max_per_tx?: string; daily_budget?: string }; spent: string }> = {};
    for (const [cat, limit] of Object.entries(policy.category_limits)) {
      categories[cat] = { limit, spent: await currentCategory(redis, id, cat) };
    }
    return {
      agent_id: id,
      policy_version: policy.version,
      daily_budget: policy.daily_budget,
      daily_spent: daily.daily,
      monthly_budget: policy.monthly_budget,
      monthly_spent: monthly,
      children_spent: childrenSpent,
      categories,
    };
  });
}