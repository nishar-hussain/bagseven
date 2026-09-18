import { pgTable, uuid, text, timestamp, numeric, index, pgEnum } from 'drizzle-orm/pg-core';

export const ledgerSide = pgEnum('ledger_side', ['debit', 'credit']);
export const accountType = pgEnum('account_type', ['agent', 'provider', 'platform', 'guardian']);

/**
 * Double-entry ledger. Every settled transaction produces exactly two balanced
 * entries: a debit to the payer and a credit to the payee. Invariant: for any
 * (chain, token, account), sum(debits) == sum(credits) across all transactions.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    txId: uuid('tx_id').notNull(),
    accountType: accountType('account_type').notNull(),
    accountId: uuid('account_id').notNull(),
    side: ledgerSide('side').notNull(),
    amount: numeric('amount', { precision: 38, scale: 18 }).notNull(),
    token: text('token').notNull(),
    chain: text('chain').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_ledger_tx').on(t.txId), index('idx_ledger_account').on(t.accountId, t.token)],
);