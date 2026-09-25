import type { Redis } from 'ioredis';
import { toMicroUnits } from '@agentos/money';
import { dayKey, monthKey } from './counters.js';

/**
 * D1 compensation: when a settlement fails or a reservation is released, the
 * spend counters that were incremented at token issuance are decremented, so a
 * failed execution doesn't silently consume the agent's budget.
 *
 * Idempotent per decision_id: a compensation runs at most once (Redis SETNX),
 * so retries and duplicate refund events can't double-credit a budget.
 */

const COMPENSATE_LUA = `
local amount = tonumber(ARGV[1])
redis.call('DECRBY', KEYS[1], amount)
local idx = 2
while idx <= #KEYS do
  redis.call('DECRBY', KEYS[idx], amount)
  idx = idx + 1
end
return {1, 'ok'}
`;

export interface CompensateInput {
  decisionId: string;
  agentId: string;
  amount: string;
  category: string;
  includeMonthly: boolean;
  ancestors: string[];
}

export async function compensate(
  redis: Redis,
  input: CompensateInput,
): Promise<{ applied: boolean }> {
  const d = dayKey();
  const m = monthKey();
  const idempotencyKey = `compensated:${input.decisionId}`;
  const claimed = await redis.set(idempotencyKey, '1', 'EX', 7 * 86_400, 'NX');
  if (claimed !== 'OK') return { applied: false }; // already compensated

  const keys = [
    `spend:d:${input.agentId}:${d}`,
    `spend:c:${input.agentId}:${d}:${input.category}`,
  ];
  if (input.includeMonthly) keys.push(`spend:m:${input.agentId}:${m}`);
  for (const anc of input.ancestors) keys.push(`spend:child:${anc}:${d}`);

  await redis.eval(COMPENSATE_LUA, keys.length, ...keys, toMicroUnits(input.amount));
  return { applied: true };
}

export async function compensatedAlready(redis: Redis, decisionId: string): Promise<boolean> {
  return (await redis.get(`compensated:${decisionId}`)) !== null;
}