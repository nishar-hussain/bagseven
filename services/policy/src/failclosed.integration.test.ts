import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { agents, createDb, guardians, organizations, policies } from '@agentos/db';
import { createAgentKeyPair, hashApiKey } from '@agentos/auth';
import { errorResponse } from '@agentos/server';
import { buildPolicyRoutes } from './routes.js';

/**
 * Slice 1.8 — fail-closed chaos test (D4).
 * When the Policy Service's budget gate (Redis) is down, spend-intents must
 * return an error and NEVER an allow with a spend_token. Requires Postgres + Redis;
 * skipped when unavailable.
 */
const db = createDb({
  connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  max: 2,
});
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 0 });

async function makeApp(redisImpl: unknown) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = errorResponse(err);
    reply.code(status).send(body);
  });
  await buildPolicyRoutes(app, { db, redis: redisImpl as never, config: {} });
  return app;
}

describe('fail-closed policy (slice 1.8)', () => {
  it.runIf(process.env.CI !== 'true')('never ALLOWs when the budget gate is down, and ALLOWs when it is up', async () => {
    try {
      await redis.connect();
      await db.execute(sql`select 1`);
    } catch {
      return; // postgres/redis unavailable — skip
    }

    const [org] = await db.insert(organizations).values({ legalName: 'Chaos Org' }).returning();
    const keyPair = createAgentKeyPair();
    const [guardian] = await db
      .insert(guardians)
      .values({ type: 'human', orgId: org.id, guardianTokenHash: hashApiKey('grd-chaos') })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        ownerOrgId: org.id,
        guardianId: guardian.id,
        displayName: 'Chaos Agent',
        status: 'active',
        apiKeyHash: keyPair.apiKeyHash,
        publicKeyPem: keyPair.publicKeyPem,
      })
      .returning();
    await db.insert(policies).values({
      agentId: agent.id,
      version: 1,
      dailyBudget: '100.00',
      maxTransaction: '20.00',
      allowedChains: [],
      allowedTools: [],
      allowedCategories: [],
      categoryLimits: {},
      createdBy: 'test',
    });

    try {
      // Broken budget gate: Redis eval throws. Fail-closed means: 5xx, no token.
      const brokenRedis = {
        ...redis,
        eval: async () => {
          throw new Error('simulated redis outage');
        },
      };
      const app = await makeApp(brokenRedis);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/spend-intents',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'chaos-1' },
        payload: { agent_id: agent.id, amount: '5.00', currency: 'USDC', category: 'general', chain: 'sepolia' },
      });
      const body = res.json();
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(body.spend_token).toBeUndefined();
      expect(body.decision).not.toBe('allow');

      // Control: working budget gate → allow + token.
      const okApp = await makeApp(redis);
      const okRes = await okApp.inject({
        method: 'POST',
        url: '/v1/spend-intents',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'chaos-2' },
        payload: { agent_id: agent.id, amount: '5.00', currency: 'USDC', category: 'general', chain: 'sepolia' },
      });
      const okBody = okRes.json();
      expect(okRes.statusCode).toBe(200);
      expect(okBody.decision).toBe('allow');
      expect(okBody.spend_token).toBeTruthy();
    } finally {
      await db.delete(policies).where(eq(policies.agentId, agent.id));
      await db.delete(agents).where(eq(agents.id, agent.id));
      await db.delete(guardians).where(eq(guardians.id, guardian.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });
});