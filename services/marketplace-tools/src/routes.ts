import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { toolProviders, tools, toolExecutions, wallets } from '@agentos/db';
import { hashApiKey } from '@agentos/auth';
import { eq as eqMoney, validateMoney } from '@agentos/money';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';

const registerProviderSchema = z.object({
  name: z.string().min(1),
  contact_email: z.string().email().optional(),
  payout_wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  payout_chain: z.string().default('sepolia'),
});

const listToolSchema = z.object({
  provider_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default('general'),
  price: z.string().min(1),
  price_token: z.string().default('USDC'),
  endpoint_url: z.string().url(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
});

const executeSchema = z.object({
  agent_id: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).default({}),
});

const DISCOVERY_QUERY = z.object({
  category: z.string().optional(),
  max_price: z.string().optional(),
});

async function getActiveProvider(db: ServiceDeps['db'], providerId: string) {
  const provider = await db.query.toolProviders.findFirst({ where: eq(toolProviders.id, providerId) });
  if (!provider) throw new ApiError(404, 'NOT_FOUND', 'provider not found');
  if (provider.status !== 'active') throw new ApiError(403, 'PROVIDER_INACTIVE', `provider is ${provider.status}`);
  return provider;
}

export function buildMarketplaceRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  // --- Registry (2.1, 2.5) ---
  app.post('/v1/tool-providers', async (req) => {
    const body = registerProviderSchema.parse(req.body);
    const providerToken = `sk_prv_${randomUUID().replaceAll('-', '')}`;
    const [provider] = await db
      .insert(toolProviders)
      .values({
        name: body.name,
        contactEmail: body.contact_email,
        payoutWalletAddress: body.payout_wallet_address,
        payoutChain: body.payout_chain,
        providerTokenHash: hashApiKey(providerToken),
        status: 'pending',
      })
      .returning();
    if (!provider) throw new ApiError(500, 'PROVIDER_CREATE_FAILED', 'provider insert returned no row');
    return { provider_id: provider.id, provider_token: providerToken, status: 'pending' };
  });

  app.post('/v1/tool-providers/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const [provider] = await db
      .update(toolProviders)
      .set({ status: 'active' })
      .where(and(eq(toolProviders.id, id), eq(toolProviders.status, 'pending')))
      .returning();
    if (!provider) throw new ApiError(409, 'INVALID_STATUS', 'provider not pending');
    return { provider_id: id, status: 'active' };
  });

  app.post('/v1/tools', async (req) => {
    const body = listToolSchema.parse(req.body);
    const token = (req.headers['x-provider-token'] as string | undefined) ?? '';
    const provider = await db.query.toolProviders.findFirst({ where: eq(toolProviders.id, body.provider_id) });
    if (!provider) throw new ApiError(404, 'NOT_FOUND', 'provider not found');
    if (hashApiKey(token) !== provider.providerTokenHash) throw new ApiError(403, 'FORBIDDEN', 'invalid provider token');
    if (provider.status !== 'active') throw new ApiError(403, 'PROVIDER_INACTIVE', `provider is ${provider.status}`);

    validateMoney(body.price);
    const [tool] = await db
      .insert(tools)
      .values({
        providerId: body.provider_id,
        name: body.name,
        description: body.description,
        category: body.category,
        price: body.price,
        priceToken: body.price_token,
        endpointUrl: body.endpoint_url,
        inputSchema: body.input_schema ?? {},
        outputSchema: body.output_schema,
      })
      .returning();
    return { tool };
  });

  app.get('/v1/tools', async (req) => {
    const query = DISCOVERY_QUERY.parse(req.query);
    const rows = await db.select().from(tools).where(eq(tools.status, 'active')).orderBy(desc(tools.createdAt)).limit(100);
    const out = [];
    for (const tool of rows) {
      const provider = await db.query.toolProviders.findFirst({ where: eq(toolProviders.id, tool.providerId) });
      if (!provider || provider.status !== 'active') continue;
      if (query.category && tool.category !== query.category) continue;
      if (query.max_price && !eqMoney(tool.price, query.max_price) && Number(tool.price) > Number(query.max_price)) continue;
      out.push({ ...tool, provider: { id: provider.id, name: provider.name } });
    }
    return { tools: out };
  });

  // --- Execution (2.2, 2.3) ---
  app.post('/v1/tools/:id/execute', async (req) => {
    const { id } = req.params as { id: string };
    const body = executeSchema.parse(req.body);
    const tool = await db.query.tools.findFirst({ where: eq(tools.id, id) });
    if (!tool) throw new ApiError(404, 'NOT_FOUND', 'tool not found');
    if (tool.status !== 'active') throw new ApiError(403, 'TOOL_INACTIVE', `tool is ${tool.status}`);
    const provider = await getActiveProvider(db, tool.providerId);
    if (tool.pricingModel !== 'per_call') throw new ApiError(400, 'UNSUPPORTED_PRICING', 'metered pricing not supported in v1');

    const chain = provider.payoutChain;
    const startedAt = Date.now();

    // Free tools: no payment, direct call.
    if (Number(tool.price) === 0) {
      const res = await fetch(tool.endpointUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.input),
      });
      const result = await res.text();
      const [execution] = await db
        .insert(toolExecutions)
        .values({
          agentId: body.agent_id,
          toolId: tool.id,
          policyDecisionId: '00000000-0000-4000-8000-000000000000',
          reservationId: '00000000-0000-4000-8000-000000000000',
          requestPayload: body.input,
          responsePayload: JSON.parse(result),
          pricePaid: '0',
          status: res.ok ? 'succeeded' : 'failed',
          latencyMs: String(Date.now() - startedAt),
          completedAt: new Date(),
        })
        .returning();
      if (!execution) throw new ApiError(500, 'EXECUTION_RECORD_FAILED', 'execution insert returned no row');
      return { execution_id: execution.id, status: execution.status, output: JSON.parse(result), price_paid: '0' };
    }

    // Paid tool: policy → reserve → x402 → settle.
    const wallet = await db.query.wallets.findFirst({
      where: and(eq(wallets.agentId, body.agent_id), eq(wallets.chain, chain)),
    });
    if (!wallet) throw new ApiError(409, 'NO_WALLET', `agent has no wallet on chain ${chain}`);

    const policyUrl = config.POLICY_URL;
    const treasuryUrl = config.TREASURY_URL;
    const paymentsUrl = config.PAYMENTS_URL;
    if (!policyUrl || !treasuryUrl || !paymentsUrl) throw new ApiError(503, 'UPSTREAM_UNCONFIGURED', 'policy/treasury/payments upstreams not configured');

    const decisionRes = await fetch(`${policyUrl}/v1/spend-intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_id: body.agent_id,
        amount: tool.price,
        currency: tool.priceToken,
        category: tool.category,
        chain,
        tool_id: tool.id,
        counterparty_id: provider.id,
      }),
    });
    const decision = (await decisionRes.json()) as { decision: string; spend_token?: string; decision_id?: string; reason?: string };
    if (decision.decision !== 'allow' || !decision.spend_token) {
      throw new ApiError(403, 'POLICY_DENIED', decision.reason ?? decision.decision);
    }

    const reserveRes = await fetch(`${treasuryUrl}/v1/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet_id: wallet.id,
        token: tool.priceToken,
        amount: tool.price,
        spend_token: decision.spend_token,
        counterparty_id: provider.id,
        counterparty_type: 'tool_provider',
      }),
    });
    const reserve = (await reserveRes.json()) as { reservation_id?: string; error?: { message?: string } };
    if (!reserveRes.ok || !reserve.reservation_id) {
      throw new ApiError(409, 'RESERVE_FAILED', reserve?.error?.message ?? 'reservation failed');
    }

    const x402Res = await fetch(`${paymentsUrl}/v1/x402/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reservation_id: reserve.reservation_id,
        provider_endpoint: tool.endpointUrl,
        expected: { amount: tool.price, token: tool.priceToken, chain, payee_address: provider.payoutWalletAddress },
        payload: body.input,
      }),
    });
    const x402 = (await x402Res.json()) as { result?: unknown; tx_hash?: string; error?: { message?: string; code?: string } };
    if (!x402Res.ok || x402.result === undefined) {
      // execution failed — record it; the reservation is released by the payments service.
      const innerCode = x402?.error?.code ?? 'X402_FAILED';
      const innerStatus = innerCode === 'X402_CHALLENGE_MISMATCH' ? 403 : 402;
      await db.insert(toolExecutions).values({
        agentId: body.agent_id,
        toolId: tool.id,
        policyDecisionId: decision.decision_id ?? '00000000-0000-4000-8000-000000000000',
        reservationId: reserve.reservation_id,
        requestPayload: body.input,
        responsePayload: { error: x402?.error?.message },
        status: 'failed',
        latencyMs: String(Date.now() - startedAt),
        completedAt: new Date(),
      });
      throw new ApiError(innerStatus, innerCode, x402?.error?.message ?? 'x402 execution failed');
    }

    const [execution] = await db
      .insert(toolExecutions)
      .values({
        agentId: body.agent_id,
        toolId: tool.id,
        policyDecisionId: decision.decision_id ?? '00000000-0000-4000-8000-000000000000',
        reservationId: reserve.reservation_id,
        requestPayload: body.input,
        responsePayload: x402.result,
        pricePaid: tool.price,
        txHash: x402.tx_hash,
        status: 'succeeded',
        latencyMs: String(Date.now() - startedAt),
        completedAt: new Date(),
      })
      .returning();
    if (!execution) throw new ApiError(500, 'EXECUTION_RECORD_FAILED', 'execution insert returned no row');

    return {
      execution_id: execution.id,
      status: 'succeeded',
      output: x402.result,
      price_paid: tool.price,
      tx_hash: x402.tx_hash,
      reservation_id: reserve.reservation_id,
    };
  });

  app.get('/v1/tool-executions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const execution = await db.query.toolExecutions.findFirst({ where: eq(toolExecutions.id, id) });
    if (!execution) throw new ApiError(404, 'NOT_FOUND', 'execution not found');
    return { execution };
  });
}