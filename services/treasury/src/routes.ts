import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { agents, balances, ledgerEntries, reservations, settlements, wallets } from '@agentos/db';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { verifySpendToken } from '@agentos/auth';
import { emit } from '@agentos/events';
import { getSigner } from './signer.js';

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
    // Dev-only faucet for testnet manual testing (slice 1.3 manual test).
    if (config.DEV_MODE !== 'true') throw new ApiError(404, 'NOT_FOUND', 'not found');
    const { id } = req.params as { id: string };
    const body = creditSchema.parse(req.body);
    const [updated] = await db
      .update(balances)
      .set({ amount: sql`amount + ${body.amount}::numeric` })
      .where(and(eq(balances.walletId, id), eq(balances.token, body.token)))
      .returning();
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'wallet token balance not found');
    return { balance: updated };
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
      throw new ApiError(403, 'INVALID_SPEND_TOKEN', (err as Error).message);
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
    const payment = await signer.signAndSubmit({
      agentId: wallet.agentId,
      to: reservation.counterpartyId ?? '0x0000000000000000000000000000000000000000',
      amount: reservation.amount,
      token: reservation.token,
    });

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

    await db.transaction(async (tx) => {
      await tx.update(reservations).set({ status: 'released' }).where(eq(reservations.id, id));
      await tx
        .update(balances)
        .set({ reservedAmount: sql`reserved_amount - ${reservation.amount}::numeric` })
        .where(and(eq(balances.walletId, reservation.walletId), eq(balances.token, reservation.token)));
    });

    await emit(db, 'treasury.reservation.released', reservation.id, { reservation_id: id, reason: 'released_by_caller' });
    return { reservation_id: id, status: 'released' };
  });
}