import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { receipts } from '@agentos/db';
import { ApiError, type ServiceDeps } from '@agentos/server';

const createReceiptSchema = z.object({
  actor_agent_id: z.string().uuid(),
  counterparty_id: z.string().uuid().nullable().optional(),
  counterparty_type: z.enum(['tool_provider', 'data_provider', 'agent', 'guardian']).nullable().optional(),
  action_type: z.enum(['tool_execution', 'data_purchase', 'agent_payment', 'wallet_sweep']),
  amount: z.string().optional(),
  token: z.string().optional(),
  tx_hash: z.string().optional(),
});

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildVerificationRoutes(app: FastifyInstance, { db }: ServiceDeps): void {
  app.post('/v1/receipts', async (req) => {
    const body = createReceiptSchema.parse(req.body);

    const last = await db.query.receipts.findFirst({ orderBy: desc(receipts.createdAt) });
    const prevHash = last?.proofHash ?? '0'.repeat(64);

    const receiptInput = {
      actor_agent_id: body.actor_agent_id,
      counterparty_id: body.counterparty_id ?? null,
      counterparty_type: body.counterparty_type ?? null,
      action_type: body.action_type,
      amount: body.amount ?? null,
      token: body.token ?? null,
      tx_hash: body.tx_hash ?? null,
      prev_hash: prevHash,
    };
    const proofHash = hashPayload(receiptInput);

    const [receipt] = await db
      .insert(receipts)
      .values({
        actorAgentId: body.actor_agent_id,
        counterpartyId: body.counterparty_id ?? null,
        counterpartyType: body.counterparty_type ?? null,
        actionType: body.action_type,
        amount: body.amount ?? null,
        token: body.token ?? null,
        txHash: body.tx_hash ?? null,
        proofRef: `s3://receipts/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.json`,
        proofHash,
        prevHash,
      })
      .returning();

    return { receipt };
  });

  app.get('/v1/receipts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const receipt = await db.query.receipts.findFirst({ where: eq(receipts.id, id) });
    if (!receipt) throw new ApiError(404, 'NOT_FOUND', 'receipt not found');
    return { receipt };
  });

  app.get('/v1/agents/:id/receipts', async (req) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(receipts)
      .where(eq(receipts.actorAgentId, id))
      .orderBy(desc(receipts.createdAt))
      .limit(100);
    return { receipts: rows };
  });
}