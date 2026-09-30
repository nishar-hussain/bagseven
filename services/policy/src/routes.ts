import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agents, mandates, refusals, reservations, transactions, vaults } from '@agentos/db';
import { validateMoney, sub } from '@agentos/money';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { canonicalMandate, canonicalSpawn, canonicalWithdraw, MandateClient, recoverEip191, recoverSpendIntentSigner } from '@agentos/onchain';
import { recoverMessageAddress, type Address } from 'viem';

const BOUNDS: Record<number, string> = {
  1: 'MandateInactive',
  2: 'PerTxCapExceeded',
  3: 'DailyCapExceeded',
  4: 'LifetimeCapExceeded',
  5: 'PerSellerCapExceeded',
  6: 'DepthExceeded',
  7: 'VaultInsufficient',
};

function toUnits(amount: string): bigint {
  const [int = '0', frac = ''] = amount.split('.');
  return BigInt(int) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
}
function fromUnits(units: bigint): string {
  const n = Number(units) / 1e6;
  return n.toFixed(2);
}

const createMandateSchema = z.object({
  owner_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  budget_per_window: z.string().min(1),
  window_seconds: z.number().int().positive(),
  lifetime_cap: z.string().min(1),
  per_purchase_cap: z.string().min(1),
  per_seller_pct: z.number().int().min(0).max(10000),
  max_depth: z.number().int().min(0),
  chain_id: z.number().int().default(31337),
  signature: z.string().min(1),
});

const spawnSchema = z.object({
  parent_agent_id: z.string().uuid(),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  share_percent: z.number().int().min(1).max(100),
  chain_id: z.number().int().default(31337),
  signature: z.string().min(1),
});

const spendIntentSchema = z.object({
  agent_id: z.string().uuid(),
  amount: z.string().min(1),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  chain_id: z.number().int().default(31337),
  signature: z.string().min(1),
});

const fundSchema = z.object({ amount: z.string().min(1) });

const withdrawSchema = z.object({
  amount: z.string().min(1),
  to_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain_id: z.number().int().default(31337),
  signature: z.string().min(1),
});

const refusalsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  scope: z.enum(['all', 'standing', 'released']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function mandateClient(config: NodeJS.ProcessEnv): MandateClient {
  const key = config.ENFORCER_DEV_KEY;
  if (!key) throw new ApiError(503, 'ENFORCER_UNCONFIGURED', 'ENFORCER_DEV_KEY not set');
  return new MandateClient(key as `0x${string}`, {
    rpcUrl: config.RPC_URL ?? 'http://localhost:8545',
    chainId: Number(config.CHAIN_ID ?? 31337),
  });
}

/** Owner-key client, used for owner-only on-chain actions (withdraw/revoke). */
function ownerClient(config: NodeJS.ProcessEnv): MandateClient {
  const key = config.OWNER_DEV_KEY;
  if (!key) throw new ApiError(503, 'OWNER_KEY_UNCONFIGURED', 'OWNER_DEV_KEY not set');
  return new MandateClient(key as `0x${string}`, {
    rpcUrl: config.RPC_URL ?? 'http://localhost:8545',
    chainId: Number(config.CHAIN_ID ?? 31337),
  });
}

export function buildPolicyRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  const getMandate = async (id: string) => {
    const mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, id) });
    if (!mandate) throw new ApiError(404, 'NOT_FOUND', 'mandate not found');
    return mandate;
  };

  // Create + sign a mandate: owner wallet signs the canonical payload (EIP-191),
  // the backend verifies the signer is the owner, then deploys the BagMandate
  // contract on-chain — the caps become the immutable, enforced guarantee.
  app.post('/v1/mandates', async (req) => {
    const body = createMandateSchema.parse(req.body);
    validateMoney(body.budget_per_window);
    validateMoney(body.lifetime_cap);
    validateMoney(body.per_purchase_cap);

    const canonical = canonicalMandate({
      owner: body.owner_address.toLowerCase() as Address,
      operator: body.operator_address.toLowerCase() as Address,
      budgetPerWindow: body.budget_per_window,
      windowSeconds: body.window_seconds,
      lifetimeCap: body.lifetime_cap,
      perPurchaseCap: body.per_purchase_cap,
      perSellerPct: body.per_seller_pct,
      maxDepth: body.max_depth,
      chainId: body.chain_id,
    });
    const signer = await recoverEip191(canonical, body.signature as `0x${string}`).catch(() => '');
    if (signer.toLowerCase() !== body.owner_address.toLowerCase()) {
      throw new ApiError(403, 'SIGNATURE_MISMATCH', 'mandate signature was not produced by the owner address');
    }

    const client = mandateClient(config);
    const contractAddress = await client.deploy({
      owner: body.owner_address.toLowerCase() as Address,
      operator: body.operator_address.toLowerCase() as Address,
      enforcer: client.address,
      usdc: (config.USDC_ADDRESS ?? '0x') as Address,
      budgetPerWindow: toUnits(body.budget_per_window),
      windowSeconds: body.window_seconds,
      lifetimeCap: toUnits(body.lifetime_cap),
      perPurchaseCap: toUnits(body.per_purchase_cap),
      perSellerPct: body.per_seller_pct,
      maxDepth: body.max_depth,
    });

    const mandateId = randomUUID();
    let rootAgentId: string | undefined;
    await db.transaction(async (tx) => {
      await tx.insert(mandates).values({
        id: mandateId,
        ownerAddress: body.owner_address.toLowerCase(),
        operatorAddress: body.operator_address.toLowerCase(),
        contractAddress,
        budgetPerWindow: body.budget_per_window,
        windowSeconds: body.window_seconds,
        lifetimeCap: body.lifetime_cap,
        perPurchaseCap: body.per_purchase_cap,
        perSellerPct: body.per_seller_pct,
        maxDepth: body.max_depth,
        signature: body.signature,
        status: 'active',
      });
      await tx.insert(vaults).values({ mandateId, contractAddress });
      const [root] = await tx.insert(agents).values({ mandateId, operatorAddress: body.operator_address.toLowerCase(), sharePercent: '100.00', depth: 0, status: 'active' }).returning();
      if (!root) throw new ApiError(500, 'ROOT_AGENT_FAILED', 'root agent insert returned no row');
      rootAgentId = root.id;
    });

    return { mandate_id: mandateId, root_agent_id: rootAgentId, contract_address: contractAddress, status: 'active' };
  });

  app.get('/v1/mandates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandate(id);
    const client = mandateClient(config);
    const tree = await db.query.agents.findMany({ where: eq(agents.mandateId, id) });
    return {
      mandate: {
        id: mandate.id,
        owner_address: mandate.ownerAddress,
        operator_address: mandate.operatorAddress,
        contract_address: mandate.contractAddress,
        budget_per_window: mandate.budgetPerWindow,
        window_seconds: mandate.windowSeconds,
        lifetime_cap: mandate.lifetimeCap,
        per_purchase_cap: mandate.perPurchaseCap,
        per_seller_pct: mandate.perSellerPct,
        max_depth: mandate.maxDepth,
        status: mandate.status,
      },
      vault_balance: mandate.contractAddress ? fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) : '0.00',
      agents: tree,
    };
  });

  app.get('/v1/mandates/:id/overview', async (req) => {
    const { id } = req.params as { id: string };
    const mandate = await getMandate(id);
    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address | null;
    const [vault, windowSpent, lifetimeSpent] = contract
      ? await Promise.all([client.vaultBalance(contract), client.spendState(contract), client.lifetimeSpent(contract)])
      : [0n, 0n, 0n];

    const windowLeft = sub(mandate.budgetPerWindow, fromUnits(windowSpent));
    const lifetimeLeft = sub(mandate.lifetimeCap, fromUnits(lifetimeSpent));
    const canDraw = Math.min(Number(vault), Number(windowLeft), Number(lifetimeLeft)).toFixed(2);

    const tree = await db.query.agents.findMany({ where: eq(agents.mandateId, id) });
    const recentRefusals = await db.query.refusals.findMany({
      where: eq(refusals.mandateId, id),
      orderBy: desc(refusals.requestedAt),
      limit: 5,
    });

    return {
      mandate_id: id,
      spent_this_window: fromUnits(windowSpent),
      budget_per_window: mandate.budgetPerWindow,
      spent_total: fromUnits(lifetimeSpent),
      lifetime_cap: mandate.lifetimeCap,
      vault_available: fromUnits(vault),
      can_be_drawn_now: canDraw,
      agents: tree.map((a) => ({ id: a.id, operator_address: a.operatorAddress, share_percent: a.sharePercent, depth: a.depth, status: a.status, parent_agent_id: a.parentAgentId })),
      recent_refusals: recentRefusals,
      terms: {
        owner_address: mandate.ownerAddress,
        operator_address: mandate.operatorAddress,
        window_seconds: mandate.windowSeconds,
        per_purchase_cap: mandate.perPurchaseCap,
        per_seller_pct: mandate.perSellerPct,
        max_depth: mandate.maxDepth,
        signed: true,
      },
    };
  });

  // Spawn a child agent under the mandate tree. Owner-signed; child can only be
  // narrower than its parent (share ≤ 100) and depth ≤ the mandate's max depth.
  app.post('/v1/mandates/:id/spawn-agent', async (req) => {
    const { id } = req.params as { id: string };
    const body = spawnSchema.parse(req.body);
    const mandate = await getMandate(id);
    const parent = await db.query.agents.findFirst({ where: eq(agents.id, body.parent_agent_id) });
    if (!parent || parent.mandateId !== id) throw new ApiError(404, 'NOT_FOUND', 'parent agent not in this mandate');

    const canonical = canonicalSpawn({ mandateId: id, parentAgentId: body.parent_agent_id, operator: body.operator_address.toLowerCase() as Address, sharePercent: body.share_percent, chainId: body.chain_id });
    const signer = await recoverEip191(canonical, body.signature as `0x${string}`).catch(() => '');
    if (signer.toLowerCase() !== mandate.ownerAddress.toLowerCase()) throw new ApiError(403, 'SIGNATURE_MISMATCH', 'spawn was not signed by the owner');

    const depth = parent.depth + 1;
    if (depth > mandate.maxDepth) throw new ApiError(400, 'EXCEEDS_MAX_DEPTH', `child depth ${depth} exceeds max depth ${mandate.maxDepth}`);
    if (body.share_percent > 100) throw new ApiError(400, 'CHILD_TOO_WIDE', 'a child mandate can only be narrower than its parent (share ≤ 100%)');

    const [agent] = await db.insert(agents).values({ mandateId: id, parentAgentId: body.parent_agent_id, operatorAddress: body.operator_address.toLowerCase(), sharePercent: String(body.share_percent), depth, status: 'active' }).returning();
    if (!agent) throw new ApiError(500, 'SPAWN_FAILED', 'agent insert returned no row');
    return { agent_id: agent.id, depth, share_percent: body.share_percent, parent_agent_id: body.parent_agent_id };
  });

  // The hot path. The OPERATOR key signs an EIP-712 spend intent; the backend
  // verifies the signer is the agent's operator, re-checks the contract, and
  // executes on-chain. Any bound violation → contract revert → refusal record.
  app.post('/v1/spend-intents', async (req) => {
    const body = spendIntentSchema.parse(req.body);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agent_id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');
    const mandate = await getMandate(agent.mandateId);
    if (mandate.status !== 'active') throw new ApiError(403, 'MANDATE_INACTIVE', `mandate is ${mandate.status}`);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'mandate has no deployed contract');

    const intent = { agentId: body.agent_id, amount: body.amount, recipient: body.recipient as Address, nonce: body.nonce, timestamp: body.timestamp, chainId: body.chain_id };
    const signer = await recoverSpendIntentSigner(intent, body.signature as `0x${string}`, body.chain_id).catch(() => '');
    if (signer.toLowerCase() !== agent.operatorAddress.toLowerCase()) throw new ApiError(403, 'OPERATOR_MISMATCH', 'spend intent was not signed by the agent operator');

    const used = await redis.set(`spendnonce:${body.agent_id}:${body.nonce}`, '1', 'EX', 86400, 'NX');
    if (used !== 'OK') throw new ApiError(409, 'NONCE_REUSED', `nonce ${body.nonce} already used`);

    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address;
    const code = await client.check(contract, toUnits(body.amount), body.recipient as Address, agent.depth);
    const refusalId = randomUUID();

    if (code !== 0) {
      const bound = BOUNDS[code] ?? 'Unknown';
      await db.insert(refusals).values({ id: refusalId, mandateId: mandate.id, agentId: agent.id, amount: body.amount, seller: body.recipient, bound, reason: bound });
      return { decision: 'refused', refusal_id: refusalId, bound, reason: bound };
    }

    const [reservation] = await db
      .insert(reservations)
      .values({ mandateId: mandate.id, agentId: agent.id, amount: body.amount, status: 'reserved', expiresAt: new Date(Date.now() + 60_000) })
      .returning();
    if (!reservation) throw new ApiError(500, 'RESERVE_FAILED', 'reservation insert returned no row');

    try {
      const txHash = await client.execute(contract, toUnits(body.amount), body.recipient as Address, agent.depth);
      await db.transaction(async (tx) => {
        await tx.update(reservations).set({ status: 'settled' }).where(eq(reservations.id, reservation.id));
        await tx.insert(transactions).values({ mandateId: mandate.id, agentId: agent.id, txHash, amount: body.amount, type: 'commit' });
        const [w, l, s] = await Promise.all([client.spendState(contract), client.lifetimeSpent(contract), client.sellerSpent(contract, body.recipient as Address)]);
        const sellerSpent = { ...((mandate.sellerSpent as Record<string, string>) ?? {}) };
        sellerSpent[body.recipient.toLowerCase()] = fromUnits(s);
        await tx.update(mandates).set({ windowSpent: fromUnits(w), lifetimeSpent: fromUnits(l), sellerSpent }).where(eq(mandates.id, mandate.id));
      });
      const [w, l] = await Promise.all([client.spendState(contract), client.lifetimeSpent(contract)]);
      return {
        decision: 'allow',
        reservation_id: reservation.id,
        tx_hash: txHash,
        remaining_window: sub(mandate.budgetPerWindow, fromUnits(w)),
        remaining_lifetime: sub(mandate.lifetimeCap, fromUnits(l)),
      };
    } catch (err) {
      const bound = /(MandateInactive|PerTxCapExceeded|DailyCapExceeded|LifetimeCapExceeded|PerSellerCapExceeded|DepthExceeded|VaultInsufficient)/.exec((err as Error).message)?.[1] ?? 'ExecuteFailed';
      await db.transaction(async (tx) => {
        await tx.update(reservations).set({ status: 'released' }).where(eq(reservations.id, reservation.id));
        await tx.insert(refusals).values({ id: refusalId, mandateId: mandate.id, agentId: agent.id, amount: body.amount, seller: body.recipient, bound, reason: bound });
      });
      return { decision: 'refused', refusal_id: refusalId, bound, reason: bound };
    }
  });

  app.get('/v1/refusals', async (req) => {
    const query = refusalsQuery.parse(req.query);
    const where = query.agent_id ? eq(refusals.agentId, query.agent_id) : undefined;
    const rows = await db.query.refusals.findMany({ where, orderBy: desc(refusals.requestedAt), limit: query.limit });
    const out = [];
    for (const row of rows) {
      let status: 'standing' | 'released' = 'standing';
      const mandate = await getMandate(row.mandateId).catch(() => null);
      if (mandate?.contractAddress) {
        try {
          const code = await mandateClient(config).check(mandate.contractAddress as Address, toUnits(row.amount), (row.seller ?? '0x0000000000000000000000000000000000000000') as Address, 0);
          if (code === 0) status = 'released';
        } catch {
          /* keep standing */
        }
      }
      out.push({ ...row, status });
    }
    const scoped = query.scope === 'all' ? out : out.filter((r) => r.status === query.scope);
    return { refusals: scoped, scope: query.scope };
  });

  // Resolve an agent by id or operator address → mandate + remaining budget.
  app.get('/v1/resolve', async (req) => {
    const { ref } = z.object({ ref: z.string().min(1) }).parse(req.query);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const agent = isUuid ? await db.query.agents.findFirst({ where: eq(agents.id, ref) }) : await db.query.agents.findFirst({ where: eq(agents.operatorAddress, ref.toLowerCase()) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', `no agent found for ${ref}`);
    const mandate = await getMandate(agent.mandateId);
    const client = mandateClient(config);
    const contract = mandate.contractAddress as Address | null;
    const [vault, w, l] = contract ? await Promise.all([client.vaultBalance(contract), client.spendState(contract), client.lifetimeSpent(contract)]) : [0n, 0n, 0n];
    return {
      agent: { id: agent.id, operator_address: agent.operatorAddress, depth: agent.depth, share_percent: agent.sharePercent, status: agent.status },
      mandate: { id: mandate.id, owner_address: mandate.ownerAddress, contract_address: mandate.contractAddress, budget_per_window: mandate.budgetPerWindow, lifetime_cap: mandate.lifetimeCap, per_purchase_cap: mandate.perPurchaseCap, per_seller_pct: mandate.perSellerPct, max_depth: mandate.maxDepth },
      remaining: {
        vault_available: fromUnits(vault),
        remaining_window: sub(mandate.budgetPerWindow, fromUnits(w)),
        remaining_lifetime: sub(mandate.lifetimeCap, fromUnits(l)),
        can_draw: Math.min(Number(fromUnits(vault)), Number(sub(mandate.budgetPerWindow, fromUnits(w))), Number(sub(mandate.lifetimeCap, fromUnits(l)))).toFixed(2),
      },
    };
  });

  // Vault: fund (dev faucet = the backend enforcer key) / withdraw (owner-signed).
  app.get('/v1/vaults/:mandateId', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const client = mandateClient(config);
    return { vault_balance: fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) };
  });

  app.post('/v1/vaults/:mandateId/fund', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const body = fundSchema.parse(req.body);
    validateMoney(body.amount);
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const client = mandateClient(config);
    await client.fund(mandate.contractAddress as Address, (config.USDC_ADDRESS ?? '0x') as Address, toUnits(body.amount));
    await db.insert(transactions).values({ mandateId, amount: body.amount, type: 'fund' });
    return { vault_balance: fromUnits(await client.vaultBalance(mandate.contractAddress as Address)) };
  });

  app.post('/v1/vaults/:mandateId/withdraw', async (req) => {
    const { mandateId } = req.params as { mandateId: string };
    const body = withdrawSchema.parse(req.body);
    validateMoney(body.amount);
    const mandate = await getMandate(mandateId);
    if (!mandate.contractAddress) throw new ApiError(503, 'NO_CONTRACT', 'no contract');
    const canonical = canonicalWithdraw({ mandateId, amount: body.amount, to: body.to_address.toLowerCase() as Address, chainId: body.chain_id });
    const signer = await recoverMessageAddress({ message: canonical, signature: body.signature as `0x${string}` }).catch(() => '');
    if (signer.toLowerCase() !== mandate.ownerAddress.toLowerCase()) throw new ApiError(403, 'SIGNATURE_MISMATCH', 'withdraw was not signed by the owner');
    const txHash = await ownerClient(config).withdraw(mandate.contractAddress as Address, toUnits(body.amount), body.to_address.toLowerCase() as Address);
    await db.insert(transactions).values({ mandateId, amount: body.amount, type: 'withdraw' });
    return { tx_hash: txHash, vault_balance: fromUnits(await mandateClient(config).vaultBalance(mandate.contractAddress as Address)) };
  });
}