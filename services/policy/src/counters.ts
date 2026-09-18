import type { Redis } from 'ioredis';

/**
 * Atomic budget check-and-increment (D2, D3). The Lua script re-checks every
 * counter and increments in one step, so concurrent requests from the same agent
 * (or across a delegated chain) cannot both pass a budget check before either
 * increments — the exact race that would allow double-spend under load.
 *
 * Agent counters:   spend:d:{agent}:{YYYY-MM-DD}   (daily)
 *                   spend:m:{agent}:{YYYY-MM}      (monthly)
 *                   spend:c:{agent}:{YYYY-MM-DD}:{category}
 * Ancestor counters: spend:d:{anc}:{YYYY-MM-DD}    (ancestor own spend)
 *                    spend:child:{anc}:{YYYY-MM-DD} (aggregate descendant spend)
 */

const CHECK_AND_INCREMENT_LUA = `
local amount = tonumber(ARGV[1])
local dailyBudget = tonumber(ARGV[2])
local monthlyBudget = tonumber(ARGV[3])
local catLimit = tonumber(ARGV[4])

local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
if dailyBudget >= 0 and daily + amount > dailyBudget then
  return {0, 'exceeds daily budget'}
end

local monthly = tonumber(redis.call('GET', KEYS[2]) or '0')
if monthlyBudget >= 0 and monthly + amount > monthlyBudget then
  return {0, 'exceeds monthly budget'}
end

local cat = tonumber(redis.call('GET', KEYS[3]) or '0')
if catLimit >= 0 and cat + amount > catLimit then
  return {0, 'exceeds category budget'}
end

-- Ancestors: KEYS[4..] are [ancDaily, ancChildren] pairs; ARGV[5..] are their budgets.
local ancIdx = 4
local ancArgIdx = 5
while ancIdx <= #KEYS do
  local ancDaily = tonumber(redis.call('GET', KEYS[ancIdx]) or '0')
  local ancChildren = tonumber(redis.call('GET', KEYS[ancIdx + 1]) or '0')
  local ancBudget = tonumber(ARGV[ancArgIdx])
  local remaining = ancBudget - ancDaily - ancChildren
  if amount > remaining then
    return {0, 'exceeds parent remaining budget'}
  end
  ancIdx = ancIdx + 2
  ancArgIdx = ancArgIdx + 1
end

redis.call('INCRBY', KEYS[1], amount)
if monthlyBudget >= 0 then redis.call('INCRBY', KEYS[2], amount) end
if catLimit >= 0 then redis.call('INCRBY', KEYS[3], amount) end

ancIdx = 4
while ancIdx <= #KEYS do
  redis.call('INCRBY', KEYS[ancIdx + 1], amount)
  ancIdx = ancIdx + 2
end
return {1, 'ok'}
`;

export function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export interface BudgetInput {
  amount: string;
  dailyBudget: string | null;
  monthlyBudget: string | null;
  categoryDailyLimit: string | null;
  category: string;
  ancestors: Array<{ agentId: string; dailyBudget: string }>;
  agentId: string;
}

export interface BudgetResult {
  allowed: boolean;
  reason?: string;
  newDailySpent: string;
}

const num = (v: string | null): string => (v === null || v === undefined ? '-1' : v);

export async function checkAndIncrement(redis: Redis, input: BudgetInput): Promise<BudgetResult> {
  const d = dayKey();
  const m = monthKey();
  const keys = [
    `spend:d:${input.agentId}:${d}`,
    `spend:m:${input.agentId}:${m}`,
    `spend:c:${input.agentId}:${d}:${input.category}`,
  ];
  for (const anc of input.ancestors) {
    keys.push(`spend:d:${anc.agentId}:${d}`, `spend:child:${anc.agentId}:${d}`);
  }

  const argv = [
    input.amount,
    num(input.dailyBudget),
    num(input.monthlyBudget),
    num(input.categoryDailyLimit),
    ...input.ancestors.map((a) => a.dailyBudget),
  ];

  const [allowed, reason] = (await redis.eval(CHECK_AND_INCREMENT_LUA, keys.length, ...keys, ...argv)) as [number, string];

  const dailyKey = keys[0];
  if (!dailyKey) throw new Error('daily counter key missing');
  const newDailySpent = (await redis.get(dailyKey)) ?? '0';
  return { allowed: allowed === 1, reason: allowed === 1 ? undefined : reason, newDailySpent };
}

export async function currentSpend(redis: Redis, agentId: string, category: string): Promise<{ daily: string; category: string }> {
  const d = dayKey();
  const daily = (await redis.get(`spend:d:${agentId}:${d}`)) ?? '0';
  const cat = (await redis.get(`spend:c:${agentId}:${d}:${category}`)) ?? '0';
  return { daily, category: cat };
}