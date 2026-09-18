import { pgTable, uuid, text, timestamp, numeric, index, pgEnum } from 'drizzle-orm/pg-core';

export const counterpartyType = pgEnum('counterparty_type', ['tool_provider', 'data_provider', 'agent', 'guardian']);
export const actionType = pgEnum('action_type', ['tool_execution', 'data_purchase', 'agent_payment', 'wallet_sweep']);

/**
 * Append-only receipts. Rows are INSERT-only (no UPDATE grants in production);
 * each receipt carries prevHash forming a hash chain that makes post-hoc
 * tampering detectable without on-chain anchoring.
 */
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorAgentId: uuid('actor_agent_id').notNull(),
    counterpartyId: uuid('counterparty_id'),
    counterpartyType: counterpartyType('counterparty_type'),
    actionType: actionType('action_type').notNull(),
    amount: numeric('amount', { precision: 38, scale: 18 }),
    token: text('token'),
    txHash: text('tx_hash'),
    proofRef: text('proof_ref').notNull(),
    proofHash: text('proof_hash').notNull(),
    prevHash: text('prev_hash').notNull().default('0'.repeat(64)),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_receipts_actor_created').on(t.actorAgentId, t.createdAt)],
);