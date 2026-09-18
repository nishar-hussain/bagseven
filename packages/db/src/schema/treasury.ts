import { pgTable, uuid, text, timestamp, numeric, index, uniqueIndex, primaryKey, pgEnum } from 'drizzle-orm/pg-core';
import { agents } from './identity.js';

export const custodyType = pgEnum('custody_type', ['mpc', 'hsm', 'smart-account', 'dev']);
export const walletStatus = pgEnum('wallet_status', ['active', 'frozen', 'swept']);
export const reservationStatus = pgEnum('reservation_status', ['held', 'committed', 'released', 'expired']);
export const settlementStatus = pgEnum('settlement_status', ['pending', 'confirmed', 'failed']);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    chain: text('chain').notNull(),
    address: text('address').notNull(),
    custodyType: custodyType('custody_type').notNull(),
    smartAccountImplVersion: text('smart_account_impl_version'),
    status: walletStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_wallet_agent_chain').on(t.agentId, t.chain)],
);

export const balances = pgTable(
  'balances',
  {
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    token: text('token').notNull(),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull().default('0'),
    reservedAmount: numeric('reserved_amount', { precision: 38, scale: 18 }).notNull().default('0'),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.walletId, t.token] })],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    token: text('token').notNull(),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    policyDecisionId: uuid('policy_decision_id').notNull(),
    counterpartyId: uuid('counterparty_id'),
    counterpartyType: text('counterparty_type'),
    status: reservationStatus('status').notNull().default('held'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idx_reservations_wallet_status').on(t.walletId, t.status)],
);

export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id),
    txHash: text('tx_hash'),
    chain: text('chain').notNull(),
    status: settlementStatus('status').notNull().default('pending'),
    gasUsed: numeric('gas_used', { precision: 20, scale: 0 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [index('idx_settlements_reservation').on(t.reservationId)],
);