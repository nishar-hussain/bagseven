import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { agents, balances, ledgerEntries, policyChecks, reservations, settlements, toolProviders, wallets } from '@agentos/db';
import { toMicroUnits } from '@agentos/money';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { peekSpendTokenClaims, verifySpendToken } from '@agentos/auth';
import { emit } from '@agentos/events';
import { getSigner, type Signer } from './signer.js';

const CAP_CHECK_AND_INCR_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
if cap >= 0 and current + amount > cap then return {0, current} end
redis.call('INCRBY', KEYS[1], amount)
return {1, current + amount}
`;

interface RealSignerWithFund extends Signer {
  fund: (to: string, token: string, amount: string) => Promise<{ txHash: string; gasTxHash?: string }>;
}

function isRealSigner(s: Signer): s is RealSignerWithFund {
  return 'fund' in s;
}

const provisionWalletSchema = z.object({
  agent_id: z.string().uuid(),
  chain: z.string().min(1),
});

const reserveSchema = z.object({
  wallet_id: z.string().uuid(),
  token: z.string().min(1),
  amount: z.string().min(1),
  spend_token: z.string().min(1),
  counterparty_id: z.string().uuid().nullable().optional(),
  counterparty_type: z.enum(['tool_provider', 'data_provider', 'agent', 'guardian']).nullable().optional(),
});

const creditSchema = z.object({
  token: z.string().min(1),
  amount: z.string().min(1),
});

const COUNTERPARTY_TO_LEDGER_ACCOUNT: Record<string, 'provider' | 'agent' | 'guardian'> = {
  tool_provider: 'provider',
  data_provider: 'provider',
  agent: 'agent',
  guardian: 'guardian',
};

async function resolvePayee(
  db: ServiceDeps['db'],
  counterpartyType: string | null | undefined,
  counterpartyId: string | null | undefined,
  chain: string,
): Promise<string> {
  if (!counterpartyId) throw new ApiError(409, 'UNRESOLVABLE_PAYEE', 'reservation has no counterparty to pay');
  if (counterpartyType === 'agent') {
    const payee = await db.query.wallets.findFirst({
      where: and(eq(wallets.agentId, counterpartyId), eq(wallets.chain, chain)),
    });
    if (payee) return payee.address;
    throw new ApiError(409, 'UNRESOLVABLE_PAYEE', `no wallet found for agent ${counterpartyId} on chain ${chain}`);
  }
  if (counterpartyType === 'tool_provider') {
    // Phase 2: settlement goes to the provider's REGISTERED payout address —
    // the payTo-binding enforcement point. Never to an address supplied by the request.
    const provider = await db.query.toolProviders.findFirst({ where: eq(toolProviders.id, counterpartyId) });
    if (provider && provider.payoutChain === chain) return provider.payoutWalletAddress;
    throw new ApiError(409, 'UNRESOLVABLE_PAYEE', `no registered payout for provider ${counterpartyId} on chain ${chain}`);
  }
  // data providers (Phase 3) will resolve here.
  throw new ApiError(409, 'UNRESOLVABLE_PAYEE', `unsupported counterparty type ${counterpartyType ?? 'none'}`);
}

export function buildTreasuryRoutes(app: FastifyInstance, { db, redis, config }: ServiceDeps): void {
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  const policyPublicKey = config.POLICY_SIGNING_PUBLIC_KEY_PEM?.replaceAll('\\n', '\n');
  if (!policyPublicKey) {
    app.log.warn('POLICY_SIGNING_PUBLIC_KEY_PEM not set — treasury will reject all spend tokens');
  }

  app.post('/v1/wallets', async (req) => {
    const body = provisionWalletSchema.parse(req.body);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, body.agent_id) });
    if (!agent) throw new ApiError(404, 'NOT_FOUND', 'agent not found');

    const signer = getSigner(body.chain);
    const address = await signer.deriveAddress(body.agent_id);

    let wallet: typeof wallets.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(wallets)
        .values({
          agentId: body.agent_id,
          chain: body.chain,
          address,
          custodyType: signer.custodyType,
        })
        .returning();
      if (!created) throw new ApiError(500, 'WALLET_PROVISION_FAILED', 'wallet insert returned no row');
      wallet = created;
      await tx.insert(balances).values([
        { walletId: created.id, token: 'USDC', amount: '0', reservedAmount: '0' },
        { walletId: created.id, token: 'ETH', amount: '0', reservedAmount: '0' },
      ]);
    });
    return { wallet };
  });

  app.post('/v1/wallets/:id/credit', async (req) => {
    // Dev faucet. With a real signer this moves actual tokens on-chain from the
    // master account; with the dev signer it is a pure ledger credit.
    if (config.DEV_MODE !== 'true') throw new ApiError(404, 'NOT_FOUND', 'not found');
    const { id } = req.params as { id: string };
    const body = creditSchema.parse(req.body);
    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.id, id) });
    if (!wallet) throw new ApiError(404, 'NOT_FOUND', 'wallet not found');

    const signer = getSigner(wallet.chain);
    let txHash: string | undefined;
    if (isRealSigner(signer)) {
      try {
        const funding = await signer.fund(wallet.address, body.token, body.amount);
        txHash = funding.txHash;
      } catch (err) {
        // On-chain funding failures (e.g. empty master balance) are a client-side
        // resource problem, not a server fault — surface a clear 4xx, not a 500.
        throw new ApiError(402, 'FUNDING_FAILED', `funding failed on-chain: ${(err as Error).message}`);
      }
    }

    const [updated] = await db
      .update(balances)
      .set({ amount: sql`amount + ${body.amount}::numeric` })
      .where(and(eq(balances.walletId, id), eq(balances.token, body.token)))
      .returning();
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'wallet token balance not found');
    return { balance: updated, tx_hash: txHash };
  });

  app.get('/v1/wallets/:agentId', async (req) => {
    const { agentId } = req.params as { agentId: string };
    const agentWallets = await db.select().from(wallets).where(eq(wallets.agentId, agentId));
    const rows = await Promise.all(
      agentWallets.map(async (w) => ({
        wallet: w,
        balances: await db.select().from(balances).where(eq(balances.walletId, w.id)),
      })),
    );
    return { wallets: rows };
  });

  // D1: reserve funds only after a valid spend_token. Fail-closed on any mismatch.
  app.post('/v1/reservations', async (req) => {
    const body = reserveSchema.parse(req.body);
    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.id, body.wallet_id) });
    if (!wallet) throw new ApiError(404, 'NOT_FOUND', 'wallet not found');
    if (wallet.status !== 'active') throw new ApiError(403, 'WALLET_FROZEN', 'wallet is not active');

    const agent = await db.query.agents.findFirst({ where: eq(agents.id, wallet.agentId) });
    if (!agent) throw new ApiError(403, 'AGENT_UNKNOWN', 'agent not found');
    if (agent.status !== 'active') throw new ApiError(403, 'AGENT_NOT_ACTIVE', 'agent is not active');

    if (!policyPublicKey) throw new ApiError(503, 'POLICY_KEY_MISSING', 'policy verification key not configured');

    let claims;
    try {
      claims = verifySpendToken(body.spend_token, policyPublicKey);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'token expired') {
        // Release the abandoned decision's budget so a re-proposed spend isn't
        // double-counted, and tell the client to mint a fresh token.
        try {
          const peeked = peekSpendTokenClaims(body.spend_token);
          const policyUrl = config.POLICY_URL;
          if (policyUrl) {
            await fetch(`${policyUrl}/v1/compensations`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                decision_id: peeked.decision_id,
                agent_id: peeked.agent_id,
                amount: peeked.amount,
                category: peeked.category,
              }),
            });
          }
        } catch (compErr) {
          app.log.warn({ err: compErr }, 'expired-token compensation failed (idempotent — safe to retry)');
        }
        throw new ApiError(403, 'SPEND_TOKEN_EXPIRED', 'spend token expired — create a fresh spend intent');
      }
      throw new ApiError(403, 'INVALID_SPEND_TOKEN', msg);
    }

    if (claims.agent_id !== wallet.agentId) throw new ApiError(403, 'TOKEN_AGENT_MISMATCH', 'token agent does not match wallet');
    if (claims.chain !== wallet.chain) throw new ApiError(403, 'TOKEN_CHAIN_MISMATCH', 'token chain does not match wallet');
    if (claims.currency !== body.token) throw new ApiError(403, 'TOKEN_CURRENCY_MISMATCH', 'token currency does not match');
    if (claims.amount !== body.amount) throw new ApiError(403, 'TOKEN_AMOUNT_MISMATCH', 'token amount does not match');
    const tokenCounterparty = claims.counterparty_id ?? null;
    if (tokenCounterparty !== (body.counterparty_id ?? null)) {
      throw new ApiError(403, 'TOKEN_COUNTERPARTY_MISMATCH', 'token counterparty does not match');
    }

    // Single-use enforcement.
    const used = await redis.set(`spendtoken:used:${claims.jti}`, '1', 'EX', 300, 'NX');
    if (used !== 'OK') throw new ApiError(403, 'TOKEN_REUSED', 'spend token already used');

    // Atomic reserve: insert + conditional balance update in one transaction.
    const expiresAt = new Date(Date.now() + 60_000);
    let reservation: typeof reservations.$inferSelect | undefined;
    try {
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(reservations)
          .values({
            walletId: wallet.id,
            token: body.token,
            amount: body.amount,
            policyDecisionId: claims.decision_id,
            counterpartyId: body.counterparty_id ?? null,
            counterpartyType: body.counterparty_type ?? null,
            status: 'held',
            expiresAt,
          })
          .returning();
        if (!created) throw new ApiError(500, 'RESERVE_FAILED', 'reservation insert returned no row');
        reservation = created;
        const updated = await tx
          .update(balances)
          .set({ reservedAmount: sql`reserved_amount + ${body.amount}::numeric` })
          .where(
            and(
              eq(balances.walletId, wallet.id),
              eq(balances.token, body.token),
              sql`(amount - reserved_amount) >= ${body.amount}::numeric`,
            ),
          )
          .returning();
        if (updated.length === 0) throw new ApiError(409, 'INSUFFICIENT_FUNDS', 'insufficient available balance');
      });
    } catch (err) {
      await redis.del(`spendtoken:used:${claims.jti}`);
      throw err;
    }
    if (!reservation) throw new ApiError(500, 'RESERVE_FAILED', 'reservation missing after transaction');

    await emit(db, 'treasury.reservation.held', wallet.agentId, {
      reservation_id: reservation.id,
      wallet_id: wallet.id,
      amount: body.amount,
      token: body.token,
    });

    return {
      reservation_id: reservation.id,
      status: 'held',
      expires_at: expiresAt.toISOString(),
      policy_decision_id: claims.decision_id,
    };
  });

  app.post('/v1/reservations/:id/commit', async (req) => {
    const { id } = req.params as { id: string };
    const reservation = await db.query.reservations.findFirst({ where: eq(reservations.id, id) });
    if (!reservation) throw new ApiError(404, 'NOT_FOUND', 'reservation not found');
    if (reservation.status !== 'held') throw new ApiError(409, 'INVALID_STATE', `reservation is ${reservation.status}`);

    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.id, reservation.walletId) });
    if (!wallet) throw new ApiError(404, 'NOT_FOUND', 'wallet not found');

    const signer = getSigner(wallet.chain);
    const payee = await resolvePayee(db, reservation.counterpartyType, reservation.counterpartyId, wallet.chain);

    // Slice 1.6: hard platform-level spending cap (guarded signing). Atomic
    // check-and-increment so concurrent commits can't jointly exceed it.
    const capStr = config.PLATFORM_MAX_TOTAL_SPEND;
    let capExceeded = false;
    if (capStr) {
      const [ok] = (await redis.eval(
        CAP_CHECK_AND_INCR_LUA,
        1,
        'platform:committed_spend',
        toMicroUnits(reservation.amount),
        toMicroUnits(capStr),
      )) as [number, number];
      capExceeded = ok !== 1;
    }
    if (capExceeded) {
      throw new ApiError(403, 'PLATFORM_CAP_EXCEEDED', `platform total-spend cap ${capStr} exceeded`);
    }

    let payment;
    try {
      payment = await signer.signAndSubmit({
        agentId: wallet.agentId,
        to: payee,
        amount: reservation.amount,
        token: reservation.token,
      });
    } catch (err) {
      // Roll back the platform-cap counter — the settlement did not happen.
      if (capStr) await redis.decrby('platform:committed_spend', Number(toMicroUnits(reservation.amount)));
      throw new ApiError(402, 'SETTLEMENT_FAILED', `settlement failed on-chain: ${(err as Error).message}`);
    }

    let settlementId: string | undefined;
    await db.transaction(async (tx) => {
      await tx
        .update(reservations)
        .set({ status: 'committed' })
        .where(eq(reservations.id, id));
      await tx
        .update(balances)
        .set({
          amount: sql`amount - ${reservation.amount}::numeric`,
          reservedAmount: sql`reserved_amount - ${reservation.amount}::numeric`,
        })
        .where(and(eq(balances.walletId, wallet.id), eq(balances.token, reservation.token)));
      const [settlement] = await tx
        .insert(settlements)
        .values({
          reservationId: id,
          txHash: payment.txHash,
          chain: wallet.chain,
          status: payment.confirmed ? 'confirmed' : 'pending',
          confirmedAt: payment.confirmed ? new Date() : null,
        })
        .returning();
      if (!settlement) throw new ApiError(500, 'SETTLEMENT_FAILED', 'settlement insert returned no row');
      settlementId = settlement.id;

      // Double-entry (D8): debit payer, credit payee.
      const creditAccount = reservation.counterpartyId;
      const creditType = reservation.counterpartyType
        ? (COUNTERPARTY_TO_LEDGER_ACCOUNT[reservation.counterpartyType] ?? 'provider')
        : 'platform';
      await tx.insert(ledgerEntries).values([
        {
          txId: settlement.id,
          accountType: 'agent',
          accountId: wallet.agentId,
          side: 'debit',
          amount: reservation.amount,
          token: reservation.token,
          chain: wallet.chain,
        },
        {
          txId: settlement.id,
          accountType: creditType,
          accountId: creditAccount ?? wallet.agentId,
          side: 'credit',
          amount: reservation.amount,
          token: reservation.token,
          chain: wallet.chain,
        },
      ]);
    });
    if (!settlementId) throw new ApiError(500, 'SETTLEMENT_FAILED', 'settlement id missing after commit');

    await emit(db, 'treasury.reservation.committed', wallet.agentId, { reservation_id: id, tx_hash: payment.txHash });
    await emit(db, 'treasury.settlement.confirmed', wallet.agentId, { settlement_id: settlementId, tx_hash: payment.txHash, chain: wallet.chain });

    // Best-effort receipt (slice 1.9). The outbox event is the durable backfill path.
    const verificationUrl = config.VERIFICATION_URL;
    if (verificationUrl) {
      try {
        const actionType =
          reservation.counterpartyType === 'agent'
            ? 'agent_payment'
            : reservation.counterpartyType === 'tool_provider'
              ? 'tool_execution'
              : reservation.counterpartyType === 'data_provider'
                ? 'data_purchase'
                : 'wallet_sweep';
        await fetch(`${verificationUrl}/v1/receipts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actor_agent_id: wallet.agentId,
            counterparty_id: reservation.counterpartyId,
            counterparty_type: reservation.counterpartyType,
            action_type: actionType,
            amount: reservation.amount,
            token: reservation.token,
            tx_hash: payment.txHash,
          }),
        });
      } catch (err) {
        app.log.warn({ err }, 'receipt write failed (will backfill from outbox)');
      }
    }

    return {
      reservation_id: id,
      status: 'committed',
      tx_hash: payment.txHash,
      settlement_id: settlementId,
    };
  });

  app.post('/v1/reservations/:id/release', async (req) => {
    const { id } = req.params as { id: string };
    const reservation = await db.query.reservations.findFirst({ where: eq(reservations.id, id) });
    if (!reservation) throw new ApiError(404, 'NOT_FOUND', 'reservation not found');
    if (reservation.status !== 'held') throw new ApiError(409, 'INVALID_STATE', `reservation is ${reservation.status}`);

    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.id, reservation.walletId) });

    await db.transaction(async (tx) => {
      await tx.update(reservations).set({ status: 'released' }).where(eq(reservations.id, id));
      await tx
        .update(balances)
        .set({ reservedAmount: sql`reserved_amount - ${reservation.amount}::numeric` })
        .where(and(eq(balances.walletId, reservation.walletId), eq(balances.token, reservation.token)));
    });

    await emit(db, 'treasury.reservation.released', reservation.id, { reservation_id: id, reason: 'released_by_caller' });

    // D1: the budget counter was incremented at token issuance — release compensates it.
    const policyUrl = config.POLICY_URL;
    if (policyUrl && wallet) {
      try {
        const pc = await db.query.policyChecks.findFirst({ where: eq(policyChecks.decisionId, reservation.policyDecisionId) });
        const action = pc?.requestedAction as { category?: string } | undefined;
        await fetch(`${policyUrl}/v1/compensations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            decision_id: reservation.policyDecisionId,
            agent_id: wallet.agentId,
            amount: reservation.amount,
            category: action?.category ?? 'general',
          }),
        });
      } catch (err) {
        app.log.warn({ err }, 'budget compensation call failed (idempotent — safe to retry)');
      }
    }

    return { reservation_id: id, status: 'released' };
  });

  // Lifecycle: sweep an agent's full on-chain balance to a target address (used on retire).
  app.post('/v1/wallets/:id/sweep', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ to_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).parse(req.body);
    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.id, id) });
    if (!wallet) throw new ApiError(404, 'NOT_FOUND', 'wallet not found');
    if (wallet.status === 'swept') throw new ApiError(409, 'INVALID_STATE', 'wallet already swept');

    const signer = getSigner(wallet.chain);
    const result = await signer.sweep(wallet.agentId, body.to_address);

    await db.transaction(async (tx) => {
      await tx.update(wallets).set({ status: 'swept' }).where(eq(wallets.id, id));
      await tx
        .update(balances)
        .set({ amount: '0', reservedAmount: '0' })
        .where(eq(balances.walletId, id));
    });

    await emit(db, 'treasury.reservation.released', wallet.agentId, { wallet_id: id, reason: 'wallet_swept' });
    return { wallet_id: id, status: 'swept', ...result };
  });
}