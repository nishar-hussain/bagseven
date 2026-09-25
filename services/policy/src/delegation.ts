import { gte, lt } from '@agentos/money';
import type { PolicyModel } from './policy.js';

/**
 * Delegation can only narrow, never widen (D2). A child policy's limits must be a
 * strict subset of the parent's. Enforced at policy-creation time AND re-checked
 * on every spend by the ancestor budget gate in counters.ts.
 */
export interface ChildPolicyLimits {
  daily_budget: string;
  max_transaction: string;
  allowed_chains?: string[];
  allowed_categories?: string[];
}

export function validateDelegationSubset(
  parent: PolicyModel,
  child: ChildPolicyLimits,
  parentRemainingDaily: string,
): string[] {
  const errors: string[] = [];

  if (!lt(child.daily_budget, parent.daily_budget)) {
    errors.push(`child daily_budget must be strictly less than parent's (${parent.daily_budget})`);
  }
  if (gte(child.daily_budget, parentRemainingDaily)) {
    errors.push(`child daily_budget exceeds parent's remaining budget (${parentRemainingDaily})`);
  }
  if (gte(child.max_transaction, parent.max_transaction)) {
    errors.push(`child max_transaction must not exceed parent's (${parent.max_transaction})`);
  }
  if (parent.allowed_chains.length > 0) {
    const childChains = child.allowed_chains ?? [];
    const outside = childChains.filter((c) => !parent.allowed_chains.includes(c));
    if (outside.length > 0) errors.push(`child chains ${outside.join(', ')} not allowed by parent`);
  }
  if (parent.allowed_categories.length > 0) {
    const childCats = child.allowed_categories ?? [];
    const outside = childCats.filter((c) => !parent.allowed_categories.includes(c));
    if (outside.length > 0) errors.push(`child categories ${outside.join(', ')} not allowed by parent`);
  }

  return errors;
}