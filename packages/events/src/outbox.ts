import { randomUUID } from 'node:crypto';
import type { Database } from '@agentos/db';
import { outboxEvents } from '@agentos/db';
import type { Topic } from './topics.js';

/**
 * A database that can insert rows — the transaction pool or a drizzle transaction,
 * so events can be written atomically with the state change they describe.
 */
type DbLike = Pick<Database, 'insert'>;

/**
 * Writes a domain event to the transactional outbox. Call this inside the same
 * database transaction as the state change it describes. The event is later
 * drained to the bus by a worker; publishing is a projection, never a
 * correctness dependency.
 */
export async function emit(
  db: DbLike,
  topic: Topic,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(outboxEvents).values({
    topic,
    key,
    payload,
    id: randomUUID(),
  });
}

export { outboxEvents };