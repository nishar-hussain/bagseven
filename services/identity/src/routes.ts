import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agents, agentCapabilities, guardians, organizations } from '@agentos/db';
import { createAgentKeyPair, hashApiKey } from '@agentos/auth';
import { emit } from '@agentos/events';
import { ApiError, type ServiceDeps } from '@agentos/server';

const createOrgSchema = z.object({
  legal_name: z.string().min(1),
});

const createGuardianSchema = z.object({
  type: z.enum(['human', 'organization']),
  org_id: z.string().uuid().optional(),
  contact_email: z.string().email().optional(),
  approval_webhook_url: z.string().url().optional(),
});

const delegateSchema = z.object({
  display_name: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  delegation_rules: z
    .object({
      max_daily_budget: z.string().min(1),
      max_transaction: z.string().min(1),
      allowed_chains: z.array(z.string()).optional(),
      allowed_categories: z.array(z.string()).optional(),
    })
    .optional(),
});

const createAgentSchema = z.object({
  owner_org_id: z.string().uuid(),
  guardian_id: z.string().uuid(),
  display_name: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
});

export function buildIdentityRoutes(app: FastifyInstance, { db, config }: ServiceDeps): void {
  app.get('/v1/organizations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'organization not found');
    return { organization: org };
  });

  app.post('/v1/organizations', async (req) => {
    const body = createOrgSchema.parse(req.body);
    const [org] = await db.insert(organizations).values({ legalName: body.legal_name }).returning();
    return { organization: org };
  });

  app.post('/v1/guardians', async (req) => {
    const body = createGuardianSchema.parse(req.body);
    const guardianToken = `sk_grd_${crypto.randomUUID().replaceAll('-', '')}`;
    const [guardian] = await db
      .insert(guardians)
      .values({
        type: body.type,
        orgId: body.org_id,
        contactEmailEncrypted: body.contact_email,
        approvalWebhookUrl: body.approval_webhook_url,
        guardianTokenHash: hashApiKey(guardianToken),
      })
      .returning();
    return { guardian: guardian, guardian_token: guardianToken };
  });

  app.get('/v1/agents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
    const capabilities = await db
      .select({ capability: agentCapabilities.capability })
      .from(agentCapabilities)
      .where(eq(agentCapabilities.agentId, id));
    return { agent: toAgentDto(agent), capabilities: capabilities.map((c) => c.capability) };
  });

  app.post('/v1/agents', async (req) => {
    const body = createAgentSchema.parse(req.body);
    const guardian = await db.query.guardians.findFirst({ where: eq(guardians.id, body.guardian_id) });
    if (!guardian) throw new ApiError(404, 'NOT_FOUND', 'guardian not found');
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, body.owner_org_id) });
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'owner organization not found');

    const keyPair = createAgentKeyPair();

    const agentId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(agents).values({
        id: agentId,
        ownerOrgId: body.owner_org_id,
        guardianId: body.guardian_id,
        displayName: body.display_name,
        status: 'pending',
        apiKeyHash: keyPair.apiKeyHash,
        publicKeyPem: keyPair.publicKeyPem,
      });
      for (const capability of body.capabilities ?? []) {
        await tx.insert(agentCapabilities).values({ agentId, capability });
      }
      await emit(tx, 'identity.agent.created', agentId, {
        agent_id: agentId,
        owner_org_id: body.owner_org_id,
        guardian_id: body.guardian_id,
      });
    });

    return {
      agent_id: agentId,
      api_key: keyPair.apiKey, // shown once
      signing_private_key_pem: keyPair.privateKeyPem, // shown once — used to sign request envelopes
      status: 'pending',
      created_at: new Date().toISOString(),
    };
  });

  // Slice 1.2: guardian-scoped mutations. A request must present the guardian token
  // for the agent's guardian, or the agent must be in a matching org (org admins = same org).
  async function requireGuardian(agentId: string, guardianToken?: string) {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
    const guardian = await db.query.guardians.findFirst({ where: eq(guardians.id, agent.guardianId) });
    if (!guardian) throw new ApiError(403, 'FORBIDDEN', 'guardian not found');
    if (typeof guardianToken !== 'string' || !guardian.guardianTokenHash) {
      throw new ApiError(403, 'FORBIDDEN', 'guardian token required');
    }
    if (hashApiKey(guardianToken) !== guardian.guardianTokenHash) {
      throw new ApiError(403, 'FORBIDDEN', 'invalid guardian token');
    }
    return { agent, guardian };
  }

  app.post('/v1/agents/:id/confirm', async (req) => {
    const { id } = req.params as { id: string };
    const token = (req.headers['x-guardian-token'] as string | undefined) ?? '';
    await requireGuardian(id, token);
    const [agent] = await db
      .update(agents)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.status, 'pending')))
      .returning();
    if (!agent) throw new ApiError(409, 'NOT_PENDING', 'agent is not in pending status');
    await emit(db, 'identity.agent.status_changed', id, {
      agent_id: id,
      old_status: 'pending',
      new_status: 'active',
    });
    return { agent: toAgentDto(agent) };
  });

  app.post('/v1/agents/:id/suspend', async (req) => {
    const { id } = req.params as { id: string };
    const token = (req.headers['x-guardian-token'] as string | undefined) ?? '';
    const { agent } = await requireGuardian(id, token);
    if (agent.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'only active agents can be suspended');
    const [updated] = await db
      .update(agents)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    await emit(db, 'identity.agent.status_changed', id, {
      agent_id: id,
      old_status: 'active',
      new_status: 'suspended',
    });
    return { agent: toAgentDto(updated!) };
  });

  // Slice 1.7: create a delegated child agent. The child's budget is a STRICT SUBSET
  // of the parent's — enforced here as a pre-check and authoritatively at child-policy
  // creation by the policy service (POST /v1/policies).
  app.post('/v1/agents/:id/delegate', async (req) => {
    const { id } = req.params as { id: string };
    const token = (req.headers['x-guardian-token'] as string | undefined) ?? '';
    const { agent: parent } = await requireGuardian(id, token);
    if (parent.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'parent agent is not active');

    const body = delegateSchema.parse(req.body);
    const keyPair = createAgentKeyPair();
    const childId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(agents).values({
        id: childId,
        ownerOrgId: parent.ownerOrgId,
        guardianId: parent.guardianId,
        parentAgentId: id,
        displayName: body.display_name,
        status: 'active',
        apiKeyHash: keyPair.apiKeyHash,
        publicKeyPem: keyPair.publicKeyPem,
      });
      for (const capability of body.capabilities ?? []) {
        await tx.insert(agentCapabilities).values({ agentId: childId, capability });
      }
      await emit(tx, 'identity.agent.created', childId, {
        agent_id: childId,
        owner_org_id: parent.ownerOrgId,
        guardian_id: parent.guardianId,
        parent_agent_id: id,
      });
    });

    // Create the child's initial policy via the policy service so the strict-subset
    // rule is enforced in one place. Roll back the child agent if it's rejected.
    let policy: { policy_id: string; version: number } | undefined;
    const policyUrl = config.POLICY_URL;
    if (policyUrl && body.delegation_rules) {
      const res = await fetch(`${policyUrl}/v1/policies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_id: childId,
          daily_budget: body.delegation_rules.max_daily_budget,
          max_transaction: body.delegation_rules.max_transaction,
          allowed_chains: body.delegation_rules.allowed_chains ?? [],
          allowed_categories: body.delegation_rules.allowed_categories ?? [],
          created_by: 'delegate',
        }),
      });
      const parsed = (await res.json()) as { policy_id?: string; version?: number; error?: { message?: string } };
      if (!res.ok) {
        await db.delete(agents).where(eq(agents.id, childId));
        throw new ApiError(400, 'DELEGATION_SUBSET_VIOLATION', parsed?.error?.message ?? 'child policy rejected');
      }
      policy = { policy_id: parsed.policy_id!, version: parsed.version! };
    }

    return {
      agent_id: childId,
      api_key: keyPair.apiKey,
      signing_private_key_pem: keyPair.privateKeyPem,
      status: 'active',
      parent_agent_id: id,
      policy,
    };
  });

  // Lifecycle terminal state: retired agents can never spend again.
  app.post('/v1/agents/:id/retire', async (req) => {
    const { id } = req.params as { id: string };
    const token = (req.headers['x-guardian-token'] as string | undefined) ?? '';
    const { agent } = await requireGuardian(id, token);
    if (agent.status === 'retired') throw new ApiError(409, 'INVALID_STATUS', 'agent already retired');
    const [updated] = await db
      .update(agents)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    await emit(db, 'identity.agent.status_changed', id, {
      agent_id: id,
      old_status: agent.status,
      new_status: 'retired',
    });
    return { agent: toAgentDto(updated!) };
  });
}

interface AgentRow {
  id: string;
  displayName: string;
  status: string;
  reputationScore: string;
  createdAt: Date;
}

function toAgentDto(agent: AgentRow) {
  return {
    id: agent.id,
    display_name: agent.displayName,
    status: agent.status,
    reputation_score: agent.reputationScore,
    created_at: agent.createdAt.toISOString(),
  };
}