import { pgTable, uuid, text, timestamp, numeric, index, uniqueIndex, jsonb, pgEnum, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const agentStatus = pgEnum('agent_status', ['pending', 'active', 'suspended', 'retired']);
export const guardianType = pgEnum('guardian_type', ['human', 'organization']);
export const kybStatus = pgEnum('kyb_status', ['pending', 'verified', 'rejected']);
export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  kybStatus: kybStatus('kyb_status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guardians = pgTable('guardians', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: guardianType('type').notNull(),
  orgId: uuid('org_id').references(() => organizations.id),
  contactEmailEncrypted: text('contact_email_encrypted'),
  approvalWebhookUrl: text('approval_webhook_url'),
  approvalChannel: text('approval_channel').notNull().default('webhook'),
  guardianTokenHash: text('guardian_token_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerOrgId: uuid('owner_org_id')
      .notNull()
      .references(() => organizations.id),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id),
    parentAgentId: uuid('parent_agent_id').references((): AnyPgColumn => agents.id),
    displayName: text('display_name').notNull(),
    status: agentStatus('status').notNull().default('pending'),
    currentVersionId: uuid('current_version_id'),
    reputationScore: numeric('reputation_score', { precision: 6, scale: 2 })
      .notNull()
      .default('50.00'),
    apiKeyHash: text('api_key_hash').notNull(),
    publicKeyPem: text('public_key_pem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agents_owner_org').on(t.ownerOrgId),
    index('idx_agents_parent').on(t.parentAgentId),
    index('idx_agents_status').on(t.status),
  ],
);

export const agentCapabilities = pgTable(
  'agent_capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_agent_capability').on(t.agentId, t.capability)],
);

export const guardianApprovals = pgTable(
  'guardian_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    requestedAction: jsonb('requested_action').notNull(),
    status: approvalStatus('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idx_guardian_approvals_agent_status').on(t.agentId, t.status)],
);