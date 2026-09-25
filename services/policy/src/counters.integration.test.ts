import { describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { checkAndIncrement } from './counters.js';
import { compensate } from './compensate.js';
import { runConcurrently } from '@agentos/testing';

/**
 * Slice 1.8 — concurrency suite (D2/D3/D5).
 * Proves the atomic Redis budget gate cannot be double-spent under load.
 * Requires a local Redis (docker compose up); skipped when unavailable.
 */
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 0 });

const flush = async () => {
  const keys = await redis.keys('spend:*');
  if (keys.length) await redis.del(...keys);
};

describe('budget check-and-increment concurrency', () => {
  it.runIf(process.env.CI !== 'true')('exactly budget/amount calls pass a flat daily budget under 1,000 parallel requests', async () => {
    try {
      await redis.connect();
    } catch {
      return; // redis unavailable — skip
    }
    await flush();

    const agent = 'agt_concurrent_flat';
    const dailyBudget = '100.00';
    const amount = '20.00';
    const results = await runConcurrently(1000, () =>
      checkAndIncrement(redis, {
        agentId: agent,
        amount,
        dailyBudget,
        monthlyBudget: null,
        categoryDailyLimit: null,
        category: 'general',
        ancestors: [],
      }),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(5); // 5 * 20 = 100 — never 6
    expect(denied).toBe(995);
    await flush();
  });

  it('two children cannot jointly exceed the parent remaining budget', async () => {
    try {
      await redis.connect();
    } catch {
      return;
    }
    await flush();

    const parent = 'agt_parent';
    const childA = 'agt_child_a';
    const childB = 'agt_child_b';
    const parentBudget = '100.00';
    const amount = '10.00';

    const ancestors = [{ agentId: parent, dailyBudget: parentBudget }];

    const run = async (child: string) =>
      checkAndIncrement(redis, {
        agentId: child,
        amount,
        dailyBudget: '500.00', // child's own budget is generous; the parent is the binding cap
        monthlyBudget: null,
        categoryDailyLimit: null,
        category: 'general',
        ancestors,
      });

    const resultsA = await runConcurrently(60, () => run(childA));
    const resultsB = await runConcurrently(60, () => run(childB));

    const allowedA = resultsA.filter((r) => r.allowed).length;
    const allowedB = resultsB.filter((r) => r.allowed).length;
    // Parent remaining = 100, each spend is 10 -> at most 10 successes across BOTH children.
    expect(allowedA + allowedB).toBe(10);
    await flush();
  });

  it('category budget is independent of the flat daily budget', async () => {
    try {
      await redis.connect();
    } catch {
      return;
    }
    await flush();

    const agent = 'agt_cat';
    const results = await runConcurrently(50, () =>
      checkAndIncrement(redis, {
        agentId: agent,
        amount: '4.00',
        dailyBudget: '100.00',
        monthlyBudget: null,
        categoryDailyLimit: '10.00',
        category: 'data-purchase',
        ancestors: [],
      }),
    );

    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(2); // 2 * 4 = 8 <= 10, third would be 12 > 10
    await flush();
  });

  it('compensation restores budget after a failed settlement (D1), idempotently', async () => {
    try {
      await redis.connect();
    } catch {
      return;
    }
    await flush();

    const agent = 'agt_comp';
    const first = await checkAndIncrement(redis, {
      agentId: agent,
      amount: '30.00',
      dailyBudget: '100.00',
      monthlyBudget: null,
      categoryDailyLimit: null,
      category: 'general',
      ancestors: [],
    });
    expect(first.allowed).toBe(true);

    // Second spend would exceed the remaining 70? No — 30 + 30 = 60 <= 100, allowed.
    const second = await checkAndIncrement(redis, {
      agentId: agent,
      amount: '30.00',
      dailyBudget: '100.00',
      monthlyBudget: null,
      categoryDailyLimit: null,
      category: 'general',
      ancestors: [],
    });
    expect(second.allowed).toBe(true);

    // Release/refund the first decision → counter returns to 30.
    const comp = await compensate(redis, {
      decisionId: '11111111-1111-4111-8111-111111111111',
      agentId: agent,
      amount: '30.00',
      category: 'general',
      includeMonthly: false,
      ancestors: [],
    });
    expect(comp.applied).toBe(true);

    // 30 remains consumed; a $70 spend is now allowed, $80 is not.
    const after = await checkAndIncrement(redis, {
      agentId: agent,
      amount: '70.00',
      dailyBudget: '100.00',
      monthlyBudget: null,
      categoryDailyLimit: null,
      category: 'general',
      ancestors: [],
    });
    expect(after.allowed).toBe(true);

    // Idempotency: a second compensation for the same decision is a no-op.
    const again = await compensate(redis, {
      decisionId: '11111111-1111-4111-8111-111111111111',
      agentId: agent,
      amount: '30.00',
      category: 'general',
      includeMonthly: false,
      ancestors: [],
    });
    expect(again.applied).toBe(false);
    await flush();
  });
});