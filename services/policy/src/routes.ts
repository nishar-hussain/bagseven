import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agents, guardianApprovals, policies, policyChecks } from '@agentos/db';
import { validateMoney, sub } from '@agentos/money';
import { newJti, signSpendToken } from '@agentos/auth';
import { emit } from '@agentos/events';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { evaluatePolicy, normalizeAction, type PolicyModel } from './policy.js';
import { checkAndIncrement } from './counters.js';
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
  delegation_rules: z.record(z.string(), z.unknown()).optional(),
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
        .values({ agentId: body.agent_id, requestedAction: action, status: 'pending', expiresAt })
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
}