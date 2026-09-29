import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { agents, balances, createDb, guardians, mandates, organizations, refusals, vaults, wallets } from '@agentos/db';
import { createAgentKeyPair, hashApiKey } from '@agentos/auth';
import { errorResponse } from '@agentos/server';
import { buildPolicyRoutes } from './routes.js';

// vitest does not load .env; make the test use the same database the services do.
for (const line of readFileSync(resolve(process.cwd(), '../../.env'), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i > 0 && process.env[line.slice(0, i)] === undefined) process.env[line.slice(0, i)] = line.slice(i + 1);
}

/**
 * Slice 1.8 — fail-closed mandate behavior (D4).
 * Spend intents must NEVER produce an allow + spend_token without an active
 * mandate, and must refuse whenever a bound is violated. Requires Postgres;
 * skipped when unavailable.
 */
const dbUrl = process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos';
console.log('DEBUG DATABASE_URL =', dbUrl.replace(/:([^@]+)@/, ':***@'));
const db = createDb({ connectionString: dbUrl, max: 2 });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 0 });

async function makeApp() {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = errorResponse(err);
    reply.code(status).send(body);
  });
  await buildPolicyRoutes(app, { db, redis, config: {} });
  return app;
}

describe('fail-closed mandate (slice 1.8)', () => {
  it.runIf(process.env.CI !== 'true')('refuses without a mandate or on bound violation; allows within bounds', async () => {
    try {
      await db.execute(sql`select 1`);
    } catch {
      return; // postgres unavailable — skip
    }

    const [org] = await db.insert(organizations).values({ legalName: 'Mandate Org' }).returning();
    const keyPair = createAgentKeyPair();
    const [guardian] = await db
      .insert(guardians)
      .values({ type: 'human', orgId: org.id, guardianTokenHash: hashApiKey('grd-mandate') })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        ownerOrgId: org.id,
        guardianId: guardian.id,
        displayName: 'Mandate Agent',
        status: 'active',
        apiKeyHash: keyPair.apiKeyHash,
        publicKeyPem: keyPair.publicKeyPem,
      })
      .returning();

    let walletId: string | undefined;
    let mandateId: string | undefined;

    try {
      const app = await makeApp();
      const post = (agentId: string, amount: string, label: string) =>
        app.inject({
          method: 'POST',
          url: '/v1/spend-intents',
          headers: { 'content-type': 'application/json', 'idempotency-key': `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}` },
          payload: { agent_id: agentId, amount, currency: 'USDC', category: 'general', chain: 'sepolia' },
        });

      // 1. No active mandate → refused, no token.
      const noMandate = await post(agent.id, '5.00', 'm-no-mandate');
      expect(noMandate.statusCode).toBe(200);
      expect(noMandate.json().decision).toBe('refused');
      expect(noMandate.json().spend_token).toBeUndefined();

      // Create mandate: $100/window, $1 per-purchase, no seller limit.
      const [wallet] = await db
        .insert(wallets)
        .values({ agentId: agent.id, chain: 'sepolia', address: `0x${'1'.repeat(40)}`, custodyType: 'dev' })
        .returning();
      await db.insert(balances).values({ walletId: wallet.id, token: 'USDC', amount: '100', reservedAmount: '0' });
      const [mandate] = await db
        .insert(mandates)
        .values({
          agentId: agent.id,
          operatorAddress: `0x${'2'.repeat(40)}`,
          budgetPerWindow: '100',
          windowSeconds: 86400,
          lifetimeCap: '100',
          perPurchaseLimit: '1.00',
          perSellerLimitBps: 0,
          maxDepth: 2,
          signature: 'signed',
          status: 'active',
          createdBy: 'test',
        })
        .returning();
      await db.insert(vaults).values({ mandateId: mandate.id, rootAgentId: agent.id, walletId: wallet.id, chain: 'sepolia' });
      walletId = wallet.id;
      mandateId = mandate.id;

      // 2. Per-purchase bound violation → refused (no allow, no token).
      const big = await post(agent.id, '5.00', 'm-per-purchase');
      const bigBody = big.json();
      expect(bigBody.decision).toBe('refused');
      expect(bigBody.violated_bound).toBe('per_purchase');

      // 3. Within bounds → allow + token.
      const ok = await post(agent.id, '0.50', 'm-ok');
      const okBody = ok.json();
      expect(ok.statusCode).toBe(200);
      expect(okBody.decision).toBe('allow');
      expect(okBody.spend_token).toBeTruthy();
      expect(okBody.mandate_id).toBe(mandate.id);

      // 4. Vault exhausted → refused.
      await db.update(balances).set({ amount: '0.20' }).where(and(eq(balances.walletId, wallet.id), eq(balances.token, 'USDC')));
      const vaultRefusal = await post(agent.id, '0.50', 'm-vault');
      expect(vaultRefusal.json().decision).toBe('refused');
      expect(vaultRefusal.json().violated_bound).toBe('vault');
    } finally {
      if (mandateId) {
        await db.delete(refusals).where(eq(refusals.mandateId, mandateId));
        await db.delete(vaults).where(eq(vaults.mandateId, mandateId));
      }
      await db.delete(mandates).where(eq(mandates.agentId, agent.id));
      if (walletId) {
        await db.delete(balances).where(eq(balances.walletId, walletId));
        await db.delete(wallets).where(eq(wallets.id, walletId));
      }
      await db.delete(agents).where(eq(agents.id, agent.id));
      await db.delete(guardians).where(eq(guardians.id, guardian.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });
});