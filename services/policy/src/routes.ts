import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { agents, balances, mandates, policyChecks, refusals, vaults, wallets } from '@agentos/db';
import { sub } from '@agentos/money';
import { newJti, signBytes, signSpendToken } from '@agentos/auth';
import { emit } from '@agentos/events';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { applySpend, canonicalMandate, depthOfAgent, evaluate, reverseSpend, type MandateRow } from '@agentos/mandate';
import { getPolicySigningKey } from './key.js';

const TOKEN_TTL_SECONDS = 30;
const ZERO = '0';

const createMandateSchema = z.object({
  agent_id: z.string().uuid(),
  budget_per_window: z.string().min(1),
  window_seconds: z.number().int().positive(),
  lifetime_cap: z.string().min(1),
  per_purchase_limit: z.string().min(1),
  per_seller_limit_bps: z.number().int().min(0).max(10000),
  max_depth: z.number().int().min(0),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  chain: z.string().default('sepolia'),
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

const spendCommitSchema = z.object({
  mandate_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  amount: z.string().min(1),
  seller: z.string().nullable().optional(),
  vault_available: z.string().optional(),
  now: z.number().optional(),
});

const reverseSchema = z.object({
  mandate_id: z.string().uuid(),
  amount: z.string().min(1),
  seller: z.string().nullable().optional(),
});

const spawnSchema = z.object({
  parent_agent_id: z.string().uuid(),
  display_name: z.string().min(1),
  share_bps: z.number().int().min(1).max(10000),
  capabilities: z.array(z.string()).optional(),
});

const resolveSchema = z.object({
  ref: z.string().min(1),
});

const refusalsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  scope: z.enum(['all', 'standing', 'released']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function operatorAddressFor(agentId: string): string {
  return `0x${createHash('sha256').update(`bagseven:operator:${agentId}`).digest('hex').slice(0, 40)}`;
}

async function getAgent(db: ServiceDeps['db'], agentId: string) {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
  return agent;
}

/** Walk to the tree root and load its active mandate. */
async function getMandateForAgent(db: ServiceDeps['db'], agentId: string): Promise<MandateRow | null> {
  const { rootAgentId } = await depthOfAgent(db, agentId);
  return db.query.mandates.findFirst({
    where: and(eq(mandates.agentId, rootAgentId), eq(mandates.status, 'active')),
  }) as Promise<MandateRow | null>;
}

async function getVault(db: ServiceDeps['db'], mandateId: string) {
  return db.query.vaults.findFirst({ where: eq(vaults.mandateId, mandateId) });
}

async function vaultAvailable(db: ServiceDeps["db"], vaultId: string): Promise<string> {
  const vault = await db.query.vaults.findFirst({ where: eq(vaults.id, vaultId) });
  if (!vault) return ZERO;
  const bal = await db.query.balances.findFirst({
    where: and(eq(balances.walletId, vault.walletId), eq(balances.token, 'USDC')),
  });
  if (!bal) return ZERO;
  return sub(bal.amount, bal.reservedAmount);
}

async function writeAudit(
  db: ServiceDeps['db'],
  input: { agentId: string; action: unknown; decision: 'allow' | 'deny'; reason?: string; decisionId: string },
): Promise<void> {
  await db.insert(policyChecks).values({
    agentId: input.agentId,
    policyVersion: 0,
    requestedAction: input.action,
    decision: input.decision,
    reason: input.reason,
    decisionId: input.decisionId,
  });
}

async function recordRefusal(
  db: ServiceDeps['db'],
  input: { mandateId: string; agentId: string; amount: string; seller: string | null; category: string; chain: string; depth: number; bound: string; reason?: string },
): Promise<string> {
  const [row] = await db
    .insert(refusals)
    .values({
      mandateId: input.mandateId,
      agentId: input.agentId,
      amount: input.amount,
      seller: input.seller,
      category: input.category,
      chain: input.chain,
      depth: input.depth,
      violatedBound: input.bound as never,
      reason: input.reason,
    })
    .returning({ id: refusals.id });
  if (!row) throw new ApiError(500, 'REFUSAL_FAILED', 'refusal insert returned no row');
  return row.id;
}

export function buildPolicyRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  // Create + sign a mandate for a root agent. The operator signs the canonical
  // bounds once; a new mandate supersedes the previous (never edited).
  app.post('/v1/mandates', async (req) => {
    const body = createMandateSchema.parse(req.body);
    const agent = await getAgent(db, body.agent_id);
    if (agent.parentAgentId) throw new ApiError(400, 'NOT_ROOT_AGENT', 'only a root agent (no parent) can hold a mandate');
    if (agent.status !== 'active') throw new ApiError(400, 'AGENT_NOT_ACTIVE', `agent is ${agent.status}`);

    const wallet = await db.query.wallets.findFirst({
      where: and(eq(wallets.agentId, body.agent_id), eq(wallets.chain, body.chain)),
    });
    if (!wallet) throw new ApiError(409, 'NO_WALLET', `agent has no wallet on ${body.chain} — provision one first`);

    const operatorAddress = body.operator_address ?? operatorAddressFor(body.agent_id);
    const canonical = canonicalMandate({
      agent_id: body.agent_id,
      operator_address: operatorAddress,
      budget_per_window: body.budget_per_window,
      window_seconds: body.window_seconds,
      lifetime_cap: body.lifetime_cap,
      per_purchase_limit: body.per_purchase_limit,
      per_seller_limit_bps: body.per_seller_limit_bps,
      max_depth: body.max_depth,
      chain: body.chain,
    });
    const { privateKeyPem } = getPolicySigningKey(config);
    const signature = signBytes(Buffer.from(canonical, 'utf8'), privateKeyPem);

    let mandateId: string | undefined;
    await db.transaction(async (tx) => {
      await tx.update(mandates).set({ status: 'superseded', supersededAt: new Date() }).where(and(eq(mandates.agentId, body.agent_id), eq(mandates.status, 'active')));
      const [created] = await tx
        .insert(mandates)
        .values({
          agentId: body.agent_id,
          operatorAddress,
          budgetPerWindow: body.budget_per_window,
          windowSeconds: body.window_seconds,
          lifetimeCap: body.lifetime_cap,
          perPurchaseLimit: body.per_purchase_limit,
          perSellerLimitBps: body.per_seller_limit_bps,
          maxDepth: body.max_depth,
          chain: body.chain,
          signature,
          status: 'active',
          createdBy: body.created_by,
        })
        .returning({ id: mandates.id });
      if (!created) throw new ApiError(500, 'MANDATE_CREATE_FAILED', 'mandate insert returned no row');
      mandateId = created.id;

      const existingVault = await tx.query.vaults.findFirst({ where: eq(vaults.rootAgentId, body.agent_id) });
      if (existingVault) {
        await tx.update(vaults).set({ mandateId: created.id }).where(eq(vaults.id, existingVault.id));
      } else {
        await tx.insert(vaults).values({ mandateId: created.id, rootAgentId: body.agent_id, walletId: wallet.id, chain: body.chain });
      }
      await tx.update(agents).set({ mandateId: created.id }).where(eq(agents.id, body.agent_id));
      await emit(tx, 'mandate.signed', body.agent_id, { mandate_id: created.id, agent_id: body.agent_id });
    });
    if (!mandateId) throw new ApiError(500, 'MANDATE_CREATE_FAILED', 'mandate missing after transaction');

    return { mandate_id: mandateId, agent_id: body.agent_id, operator_address: operatorAddress, signature, status: 'active' };
  });

  app.get('/v1/mandates/:agentId/active', async (req) => {
    const { agentId } = req.params as { agentId: string };
    const mandate = await getMandateForAgent(db, agentId);
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'no active mandate for agent');
    return { mandate };
  });

  // The hot path: bounds evaluation. No Allow/Deny configuration — only bounds.
  app.post('/v1/spend-intents', async (req) => {
    const body = spendIntentSchema.parse(req.body);
    const chain = body.chain ?? config.DEFAULT_CHAIN ?? 'sepolia';
    const agent = await getAgent(db, body.agent_id);
    const now = Date.now();

    const failClosed = async (reason: string) => {
      const decisionId = randomUUID();
      await writeAudit(db, { agentId: body.agent_id, action: body, decision: 'deny', reason, decisionId });
      return { decision: 'refused' as const, decision_id: decisionId, refusal_id: null, violated_bound: null, reason };
    };

    if (agent.status !== 'active') return failClosed(`agent not active (${agent.status})`);
    const mandate = await getMandateForAgent(db, body.agent_id);
    if (!mandate) return failClosed('no active mandate for agent');

    const { depth, rootAgentId } = await depthOfAgent(db, body.agent_id);
    const vault = await getVault(db, mandate.id);
    const available = vault ? await vaultAvailable(db, vault.id) : ZERO;
    const seller = body.counterparty_id ?? null;

    const result = evaluate({ mandate, amount: body.amount, seller, depth, now, vaultAvailable: available });

    if (!result.ok) {
      const decisionId = randomUUID();
      const refusalId = await recordRefusal(db, { mandateId: mandate.id, agentId: body.agent_id, amount: body.amount, seller, category: body.category, chain, depth, bound: result.bound ?? 'vault', reason: result.reason });
      await writeAudit(db, { agentId: body.agent_id, action: body, decision: 'deny', reason: result.reason, decisionId });
      await emit(db, 'mandate.refusal.recorded', body.agent_id, { refusal_id: refusalId, decision_id: decisionId, violated_bound: result.bound });
      return { decision: 'refused' as const, decision_id: decisionId, refusal_id: refusalId, violated_bound: result.bound, reason: result.reason, remaining_window: result.remainingWindow, remaining_lifetime: result.remainingLifetime };
    }

    const decisionId = randomUUID();
    const claims = {
      v: 1 as const,
      decision_id: decisionId,
      agent_id: body.agent_id,
      amount: body.amount,
      currency: body.currency,
      chain,
      category: body.category,
      counterparty_id: seller,
      mandate_id: mandate.id,
      depth,
      iat: new Date(now).toISOString(),
      exp: new Date(now + TOKEN_TTL_SECONDS * 1000).toISOString(),
      jti: newJti(),
    };
    const spendToken = signSpendToken(claims, getPolicySigningKey(config).privateKeyPem);
    await writeAudit(db, { agentId: body.agent_id, action: body, decision: 'allow', decisionId });
    await emit(db, 'mandate.spend.authorized', body.agent_id, { decision_id: decisionId, amount: body.amount, bound_ok: true });

    return {
      decision: 'allow' as const,
      decision_id: decisionId,
      spend_token: spendToken,
      mandate_id: mandate.id,
      remaining_window: result.remainingWindow,
      remaining_lifetime: result.remainingLifetime,
      remaining_vault: result.remainingVault,
      can_draw: result.canDraw,
      root_agent_id: rootAgentId,
    };
  });

  // Treasury calls this at commit: atomic counter increment, mirroring the
  // on-chain attemptAndCommit. Re-checks every bound against current state.
  app.post('/v1/spend-commits', async (req) => {
    const body = spendCommitSchema.parse(req.body);
    const result = await applySpend(db, body.mandate_id, {
      amount: body.amount,
      seller: body.seller ?? null,
      now: body.now ?? Date.now(),
      vaultAvailable: body.vault_available ?? ZERO,
    });
    if (!result.ok) {
      const mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, body.mandate_id) });
      await recordRefusal(db, { mandateId: body.mandate_id, agentId: body.agent_id, amount: body.amount, seller: body.seller ?? null, category: 'general', chain: 'sepolia', depth: 0, bound: result.bound ?? 'vault', reason: result.reason });
      if (mandate) await emit(db, 'mandate.refusal.recorded', body.agent_id, { refusal_id: null, violated_bound: result.bound });
    }
    return { ok: result.ok, bound: result.bound, reason: result.reason, window_spent: result.windowSpent, lifetime_spent: result.lifetimeSpent, remaining_window: result.remainingWindow, remaining_lifetime: result.remainingLifetime };
  });

  app.post('/v1/spend-reversals', async (req) => {
    const body = reverseSchema.parse(req.body);
    await reverseSpend(db, body.mandate_id, body.amount, body.seller ?? null);
    return { ok: true };
  });

  app.get('/v1/refusals', async (req) => {
    const query = refusalsQuery.parse(req.query);
    const where = query.agent_id ? eq(refusals.agentId, query.agent_id) : undefined;
    const rows = await db.query.refusals.findMany({
      where,
      orderBy: desc(refusals.requestedAt),
      limit: query.limit,
    });
    const out = [];
    for (const row of rows) {
      let status: 'standing' | 'released' = 'standing';
      const mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, row.mandateId) });
      const vault = await getVault(db, row.mandateId);
      const available = vault ? await vaultAvailable(db, vault.id) : ZERO;
      if (mandate) {
        const nowCheck = evaluate({ mandate, amount: row.amount, seller: row.seller, depth: row.depth, now: Date.now(), vaultAvailable: available });
        if (nowCheck.ok) status = 'released';
      }
      out.push({ ...row, status });
    }
    const scoped = query.scope === 'all' ? out : out.filter((r) => r.status === query.scope);
    return { refusals: scoped, scope: query.scope };
  });

  // Resolve an agent by id, address, or name → mandate + remaining spend.
  app.get('/v1/resolve', async (req) => {
    const { ref } = resolveSchema.parse(req.query);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    let agent = isUuid ? await db.query.agents.findFirst({ where: eq(agents.id, ref) }) : undefined;
    if (!agent) {
      const wallet = await db.query.wallets.findFirst({ where: eq(wallets.address, ref.toLowerCase()) });
      if (wallet) agent = await db.query.agents.findFirst({ where: eq(agents.id, wallet.agentId) });
    }
    if (!agent) {
      agent = await db.query.agents.findFirst({ where: eq(agents.displayName, ref), orderBy: desc(agents.createdAt) });
    }
    if (!agent) throw new ApiError(404, 'NOT_FOUND', `no agent found for ref ${ref}`);

    const { depth, rootAgentId } = await depthOfAgent(db, agent.id);
    const mandate = await getMandateForAgent(db, agent.id);
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'no active mandate for this agent');
    const vault = await getVault(db, mandate.id);
    const available = vault ? await vaultAvailable(db, vault.id) : ZERO;
    const check = evaluate({ mandate, amount: '0', seller: null, depth, now: Date.now(), vaultAvailable: available });

    return {
      agent: { id: agent.id, display_name: agent.displayName, status: agent.status },
      depth,
      root_agent_id: rootAgentId,
      vault: vault ? { id: vault.id, contract_address: vault.contractAddress } : null,
      mandate: {
        id: mandate.id,
        contract_address: mandate.contractAddress,
        budget_per_window: mandate.budgetPerWindow,
        lifetime_cap: mandate.lifetimeCap,
        per_purchase_limit: mandate.perPurchaseLimit,
        per_seller_limit_bps: mandate.perSellerLimitBps,
        max_depth: mandate.maxDepth,
        operator_address: mandate.operatorAddress,
      },
      remaining: { can_draw: check.canDraw, remaining_window: check.remainingWindow, remaining_lifetime: check.remainingLifetime, vault_available: available },
    };
  });

  // Spawn a child agent under a mandate tree. Child ≤ Parent: share ≤ 100% and
  // the child's depth must not exceed the mandate's max depth.
  app.post('/v1/mandates/:id/spawn-agent', async (req) => {
    const { id } = req.params as { id: string };
    const body = spawnSchema.parse(req.body);
    const mandate = await db.query.mandates.findFirst({ where: and(eq(mandates.id, id), eq(mandates.status, 'active')) });
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'active mandate not found');
    const parent = await getAgent(db, body.parent_agent_id);
    const { rootAgentId, depth } = await depthOfAgent(db, body.parent_agent_id);
    if (rootAgentId !== mandate.agentId) throw new ApiError(400, 'NOT_IN_TREE', 'parent is not in this mandate tree');
    if (depth + 1 > mandate.maxDepth) throw new ApiError(400, 'EXCEEDS_MAX_DEPTH', `child depth ${depth + 1} exceeds max depth ${mandate.maxDepth}`);

    const [child] = await db
      .insert(agents)
      .values({
        ownerOrgId: parent.ownerOrgId,
        guardianId: parent.guardianId,
        parentAgentId: parent.id,
        mandateId: mandate.id,
        shareOfParentBps: String(body.share_bps),
        displayName: body.display_name,
        status: 'active',
        apiKeyHash: `child-${randomUUID()}`,
        publicKeyPem: 'not-applicable',
      })
      .returning();
    if (!child) throw new ApiError(500, 'SPAWN_FAILED', 'child insert returned no row');
    await emit(db, 'mandate.agent.spawned', child.id, { mandate_id: id, parent_agent_id: parent.id, share_bps: body.share_bps });

    return { agent_id: child.id, parent_agent_id: parent.id, mandate_id: id, depth: depth + 1, share_bps: body.share_bps, status: child.status };
  });

  // Overview: spent this window / total / can be drawn / agents / refusals / terms.
  app.get('/v1/mandates/:id/overview', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, id) });
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'mandate not found');

    const vault = await getVault(db, id);
    const available = vault ? await vaultAvailable(db, vault.id) : ZERO;
    const now = Date.now();
    const check = evaluate({ mandate, amount: '0', seller: null, depth: 0, now, vaultAvailable: available });

    const tree = await db.query.agents.findMany({ where: eq(agents.mandateId, id) });
    const treeWithDepth = [];
    for (const agent of tree) {
      const { depth } = await depthOfAgent(db, agent.id);
      treeWithDepth.push({ id: agent.id, display_name: agent.displayName, parent_agent_id: agent.parentAgentId, share_bps: agent.shareOfParentBps, depth, status: agent.status });
    }
    const recentRefusals = await db.query.refusals.findMany({
      where: eq(refusals.mandateId, id),
      orderBy: desc(refusals.requestedAt),
      limit: 5,
    });

    // Agents to watch: recently refused, or at/near their share limit or max depth.
    const agentsToWatch = [];
    for (const agent of tree) {
      const { depth } = await depthOfAgent(db, agent.id);
      if (depth >= mandate.maxDepth && mandate.maxDepth > 0) agentsToWatch.push({ id: agent.id, display_name: agent.displayName, reason: 'at max depth' });
    }
    for (const r of recentRefusals) {
      if (!agentsToWatch.some((a) => a.id === r.agentId)) {
        const agent = tree.find((a) => a.id === r.agentId);
        if (agent) agentsToWatch.push({ id: agent.id, display_name: agent.displayName, reason: `recently refused (${r.violatedBound})` });
      }
    }

    return {
      mandate_id: id,
      root_agent_id: mandate.agentId,
      contract_address: mandate.contractAddress,
      spent_this_window: check.currentWindowSpent,
      budget_per_window: mandate.budgetPerWindow,
      spent_total: mandate.lifetimeSpent,
      lifetime_cap: mandate.lifetimeCap,
      can_be_drawn_now: check.canDraw,
      vault_available: available,
      agents: treeWithDepth,
      agents_to_watch: agentsToWatch,
      recent_refusals: recentRefusals,
      terms: {
        operator_address: mandate.operatorAddress,
        window_seconds: mandate.windowSeconds,
        per_purchase_limit: mandate.perPurchaseLimit,
        per_seller_limit_bps: mandate.perSellerLimitBps,
        max_depth: mandate.maxDepth,
        signed: mandate.signature.length > 0,
      },
    };
  });

  app.get('/v1/policy-checks/:decisionId', async (req) => {
    const { decisionId } = req.params as { decisionId: string };
    const check = await db.query.policyChecks.findFirst({ where: eq(policyChecks.decisionId, decisionId) });
    if (!check) throw new ApiError(404, 'NOT_FOUND', 'decision not found');
    return { policy_check: check };
  });

  app.get('/v1/agents/:id/spend-summary', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandateForAgent(db, id);
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'no active mandate for agent');
    const vault = await getVault(db, mandate.id);
    const available = vault ? await vaultAvailable(db, vault.id) : ZERO;
    const check = evaluate({ mandate, amount: '0', seller: null, depth: 0, now: Date.now(), vaultAvailable: available });
    return {
      agent_id: id,
      mandate_id: mandate.id,
      window_budget: mandate.budgetPerWindow,
      window_spent: check.currentWindowSpent,
      lifetime_cap: mandate.lifetimeCap,
      lifetime_spent: mandate.lifetimeSpent,
      can_draw: check.canDraw,
    };
  });
}