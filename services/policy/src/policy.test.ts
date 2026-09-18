import { describe, expect, it } from 'vitest';
import { evaluatePolicy, type PolicyModel } from './policy.js';

const basePolicy: PolicyModel = {
  id: 'pol_1',
  agent_id: 'agt_1',
  version: 1,
  daily_budget: '100.00',
  monthly_budget: '2000.00',
  max_transaction: '20.00',
  allowed_chains: ['base'],
  allowed_tools: [],
  allowed_categories: ['data-purchase', 'trading'],
  category_limits: { 'data-purchase': { max_per_tx: '5.00', daily_budget: '10.00' } },
  human_approval_threshold: '15.00',
};

const action = (over: Partial<{ amount: string; category: string; chain: string; tool_id: string }> = {}) => ({
  amount: '3.00',
  currency: 'USDC',
  category: 'data-purchase',
  chain: 'base',
  ...over,
});

describe('evaluatePolicy', () => {
  it('allows an in-limit action', () => {
    expect(evaluatePolicy(basePolicy, action()).outcome).toBe('allow');
  });

  it('denies above max_transaction', () => {
    const d = evaluatePolicy(basePolicy, action({ amount: '500.00' }));
    expect(d.outcome).toBe('deny');
    expect(d.matched_rule).toBe('max_transaction');
  });

  it('denies a disallowed chain', () => {
    const d = evaluatePolicy(basePolicy, action({ chain: 'solana' }));
    expect(d.outcome).toBe('deny');
    expect(d.matched_rule).toBe('allowed_chains');
  });

  it('denies a disallowed category', () => {
    const d = evaluatePolicy(basePolicy, action({ category: 'gambling' }));
    expect(d.outcome).toBe('deny');
    expect(d.matched_rule).toBe('allowed_categories');
  });

  it('denies above a category max_per_tx', () => {
    const d = evaluatePolicy(basePolicy, action({ amount: '6.00', category: 'data-purchase' }));
    expect(d.outcome).toBe('deny');
    expect(d.matched_rule).toBe('category:data-purchase max_per_tx');
  });

  it('returns pending_approval above the human threshold', () => {
    const d = evaluatePolicy(basePolicy, action({ amount: '16.00', category: 'trading' }));
    expect(d.outcome).toBe('pending_approval');
    expect(d.matched_rule).toBe('human_approval_threshold');
  });

  it('empty allowed lists mean open (opt-in model)', () => {
    const open: PolicyModel = { ...basePolicy, allowed_chains: [], allowed_tools: [], allowed_categories: [] };
    expect(evaluatePolicy(open, action({ chain: 'anywhere', category: 'anything' })).outcome).toBe('allow');
  });
});