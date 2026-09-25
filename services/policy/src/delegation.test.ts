import { describe, expect, it } from 'vitest';
import { validateDelegationSubset, type ChildPolicyLimits } from './delegation.js';
import type { PolicyModel } from './policy.js';

const parent: PolicyModel = {
  id: 'pol_parent',
  agent_id: 'agt_parent',
  version: 1,
  daily_budget: '100.00',
  monthly_budget: '2000.00',
  max_transaction: '20.00',
  allowed_chains: ['sepolia'],
  allowed_tools: [],
  allowed_categories: ['trading', 'data-purchase'],
  category_limits: {},
  human_approval_threshold: null,
};

const child: ChildPolicyLimits = {
  daily_budget: '50.00',
  max_transaction: '10.00',
  allowed_chains: ['sepolia'],
  allowed_categories: ['trading'],
};

describe('validateDelegationSubset', () => {
  it('accepts a strict subset', () => {
    expect(validateDelegationSubset(parent, child, '80.00')).toEqual([]);
  });

  it('rejects a child budget equal to or above the parent nominal', () => {
    expect(validateDelegationSubset(parent, { ...child, daily_budget: '100.00' }, '80.00').join(';')).toContain('strictly less');
  });

  it('rejects a child budget that exceeds the parent remaining budget', () => {
    const errors = validateDelegationSubset(parent, { ...child, daily_budget: '60.00' }, '50.00');
    expect(errors.join(';')).toContain('remaining');
  });

  it('rejects a max_transaction at or above the parent limit', () => {
    const errors = validateDelegationSubset(parent, { ...child, max_transaction: '20.00' }, '80.00');
    expect(errors.join(';')).toContain('max_transaction');
  });

  it('rejects chains/categories the parent does not allow', () => {
    const errors = validateDelegationSubset(parent, { ...child, allowed_chains: ['sepolia', 'solana'], allowed_categories: ['gambling'] }, '80.00');
    expect(errors.join(';')).toContain('solana');
    expect(errors.join(';')).toContain('gambling');
  });
});