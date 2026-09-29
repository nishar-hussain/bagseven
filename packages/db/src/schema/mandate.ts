import { pgTable, uuid, text, timestamp, numeric, jsonb, integer, index, bigint, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { agents } from './identity.js';
import { wallets } from './treasury.js';

export const mandateStatus = pgEnum('mandate_status', ['active', 'superseded']);

/**
 * A mandate is the signed, immutable spending contract for an agent tree.
 * The operator signs the canonical bounds once; a new mandate supersedes the
 * previous one (append-only, never edited). Counters below are the off-chain
 * mirror of the on-chain BagMandate contract state, used for fast evaluation.
 */
export const mandates = pgTable(
  'mandates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    operatorAddress: text('operator_address').notNull(),
    budgetPerWindow: numeric('budget_per_window', { precision: 38, scale: 18 }).notNull(),
    windowSeconds: bigint('window_seconds', { mode: 'number' }).notNull(),
    lifetimeCap: numeric('lifetime_cap', { precision: 38, scale: 18 }).notNull(),
    perPurchaseLimit: numeric('per_purchase_limit', { precision: 38, scale: 18 }).notNull(),
    perSellerLimitBps: integer('per_seller_limit_bps').notNull(),
    maxDepth: integer('max_depth').notNull(),
    chain: text('chain').notNull().default('sepolia'),
    contractAddress: text('contract_address'),
    signature: text('signature').notNull(),
    status: mandateStatus('status').notNull().default('active'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    windowOpenedAt: timestamp('window_opened_at', { withTimezone: true }).notNull().defaultNow(),
    windowSpent: numeric('window_spent', { precision: 38, scale: 18 }).notNull().default('0'),
    lifetimeSpent: numeric('lifetime_spent', { precision: 38, scale: 18 }).notNull().default('0'),
    sellerSpent: jsonb('seller_spent').notNull().default({}),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_mandates_agent').on(t.agentId),
    index('idx_mandates_status').on(t.status),
    uniqueIndex('uq_mandate_agent_active').on(t.agentId, t.status),
  ],
);

/** One vault per mandate tree. The vault's wallet holds the tree's USDC. */
export const vaults = pgTable(
  'vaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    rootAgentId: uuid('root_agent_id')
      .notNull()
      .references(() => agents.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    contractAddress: text('contract_address'),
    chain: text('chain').notNull().default('sepolia'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_vault_mandate').on(t.mandateId)],
);

export const refusalBound = pgEnum('refusal_bound', ['window', 'lifetime', 'per_purchase', 'per_seller', 'depth', 'vault']);

/**
 * A refusal records a purchase attempt that violated a mandate bound. A refusal
 * is "standing" while the same attempt would still be refused, and "released"
 * once the bound no longer blocks it (e.g. the window rolled over).
 */
export const refusals = pgTable(
  'refusals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mandateId: uuid('mandate_id')
      .notNull()
      .references(() => mandates.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    seller: text('seller'),
    category: text('category'),
    chain: text('chain').notNull().default('sepolia'),
    depth: integer('depth').notNull().default(0),
    violatedBound: refusalBound('violated_bound').notNull(),
    reason: text('reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_refusals_agent_created').on(t.agentId, t.requestedAt),
    index('idx_refusals_mandate').on(t.mandateId),
  ],
);