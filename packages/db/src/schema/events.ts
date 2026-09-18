import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Transactional outbox. Services write domain events here in the SAME database
 * transaction as the business change (no dual-write inconsistency). A background
 * worker drains to the event bus; correctness never depends on the bus being up.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    key: text('key').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [index('idx_outbox_unpublished').on(t.publishedAt, t.createdAt)],
);