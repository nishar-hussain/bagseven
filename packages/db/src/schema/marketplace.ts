import { pgTable, uuid, text, timestamp, numeric, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';
import { agents } from './identity.js';

export const providerStatus = pgEnum('provider_status', ['pending', 'active', 'suspended']);
export const toolStatus = pgEnum('tool_status', ['active', 'deprecated', 'disabled']);
export const toolInterface = pgEnum('tool_interface', ['http', 'mcp']);
export const pricingModel = pgEnum('pricing_model', ['per_call', 'metered']);
export const executionStatus = pgEnum('execution_status', ['executing', 'succeeded', 'failed', 'timed_out']);

export const toolProviders = pgTable(
  'tool_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    identityRef: uuid('identity_ref').references(() => agents.id),
    contactEmail: text('contact_email'),
    payoutWalletAddress: text('payout_wallet_address').notNull(),
    payoutChain: text('payout_chain').notNull().default('sepolia'),
    providerTokenHash: text('provider_token_hash').notNull(),
    status: providerStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_providers_status').on(t.status)],
);

export const tools = pgTable(
  'tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => toolProviders.id),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('general'),
    price: numeric('price', { precision: 38, scale: 18 }).notNull().default('0'),
    priceToken: text('price_token').notNull().default('USDC'),
    pricingModel: pricingModel('pricing_model').notNull().default('per_call'),
    interfaceType: toolInterface('interface_type').notNull().default('http'),
    endpointUrl: text('endpoint_url').notNull(),
    inputSchema: jsonb('input_schema').notNull().default({}),
    outputSchema: jsonb('output_schema'),
    status: toolStatus('status').notNull().default('active'),
    successRate: numeric('success_rate', { precision: 5, scale: 2 }),
    avgLatencyMs: numeric('avg_latency_ms', { precision: 20, scale: 0 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_tools_provider').on(t.providerId), index('idx_tools_status_category').on(t.status, t.category)],
);

export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id),
    policyDecisionId: uuid('policy_decision_id').notNull(),
    reservationId: uuid('reservation_id').notNull(),
    requestPayload: jsonb('request_payload').notNull(),
    responsePayload: jsonb('response_payload'),
    pricePaid: numeric('price_paid', { precision: 38, scale: 18 }),
    txHash: text('tx_hash'),
    status: executionStatus('status').notNull().default('executing'),
    latencyMs: numeric('latency_ms', { precision: 20, scale: 0 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('idx_tool_exec_agent').on(t.agentId, t.createdAt)],
);