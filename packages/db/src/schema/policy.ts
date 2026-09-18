import { pgTable, uuid, text, timestamp, numeric, jsonb, integer, index, uniqueIndex, primaryKey, pgEnum } from 'drizzle-orm/pg-core';
import { agents } from './identity.js';

export const policyDecision = pgEnum('policy_decision', ['allow', 'deny', 'pending_approval']);
export const periodType = pgEnum('period_type', ['daily', 'monthly']);

export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    version: integer('version').notNull(),
    dailyBudget: numeric('daily_budget', { precision: 38, scale: 18 }).notNull(),
    monthlyBudget: numeric('monthly_budget', { precision: 38, scale: 18 }),
    maxTransaction: numeric('max_transaction', { precision: 38, scale: 18 }).notNull(),
    allowedChains: jsonb('allowed_chains').notNull().default([]),
    allowedTools: jsonb('allowed_tools').notNull().default([]),
    allowedDataOffers: jsonb('allowed_data_offers').notNull().default([]),
    allowedCategories: jsonb('allowed_categories').notNull().default([]),
    categoryLimits: jsonb('category_limits').notNull().default({}),
    humanApprovalThreshold: numeric('human_approval_threshold', { precision: 38, scale: 18 }),
    delegationRules: jsonb('delegation_rules'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
  },
  (t) => [uniqueIndex('uq_policy_agent_version').on(t.agentId, t.version)],
);

export const spendCounters = pgTable(
  'spend_counters',
  {
    agentId: uuid('agent_id').notNull(),
    periodKey: text('period_key').notNull(),
    periodType: periodType('period_type').notNull(),
    category: text('category'),
    spentAmount: numeric('spent_amount', { precision: 38, scale: 18 }).notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.periodKey, t.periodType, t.category] })],
);

export const policyChecks = pgTable(
  'policy_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull(),
    policyVersion: integer('policy_version').notNull(),
    requestedAction: jsonb('requested_action').notNull(),
    decision: policyDecision('decision').notNull(),
    reason: text('reason'),
    decisionId: uuid('decision_id').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_policy_checks_agent_created').on(t.agentId, t.createdAt)],
);