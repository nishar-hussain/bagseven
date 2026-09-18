import { validateMoney, gte } from '@agentos/money';

/**
 * Static policy evaluation (D3, D4). Budget counters are checked ATOMICALLY in
 * Redis (counters.ts) — this pure function handles the non-counter rules so they
 * are trivially unit-testable. Never returns ALLOW without the Redis gate.
 */

export interface PolicyAction {
  amount: string;
  currency: string;
  category: string;
  chain?: string;
  tool_id?: string;
  data_offer_id?: string;
  counterparty_id?: string;
}

export interface CategoryLimit {
  max_per_tx?: string;
  daily_budget?: string;
}

export interface PolicyModel {
  id: string;
  agent_id: string;
  version: number;
  daily_budget: string;
  monthly_budget: string | null;
  max_transaction: string;
  allowed_chains: string[];
  allowed_tools: string[];
  allowed_categories: string[];
  category_limits: Record<string, CategoryLimit>;
  human_approval_threshold: string | null;
}

export type DecisionOutcome = 'allow' | 'deny' | 'pending_approval';

export interface PolicyEvaluation {
  outcome: DecisionOutcome;
  reason?: string;
  matched_rule?: string;
}

export function normalizeAction(raw: Record<string, unknown>): PolicyAction {
  const amount = validateMoney(String(raw.amount));
  const category = String(raw.category ?? 'general');
  return {
    amount,
    currency: String(raw.currency ?? 'USDC'),
    category,
    chain: raw.chain === undefined ? undefined : String(raw.chain),
    tool_id: raw.tool_id === undefined ? undefined : String(raw.tool_id),
    data_offer_id: raw.data_offer_id === undefined ? undefined : String(raw.data_offer_id),
    counterparty_id: raw.counterparty_id === undefined ? undefined : String(raw.counterparty_id),
  };
}

export function evaluatePolicy(policy: PolicyModel, action: PolicyAction): PolicyEvaluation {
  if (gte(action.amount, '0') && gte(action.amount, policy.max_transaction)) {
    return { outcome: 'deny', reason: `exceeds max_transaction: requested ${action.amount} > limit ${policy.max_transaction}`, matched_rule: 'max_transaction' };
  }

  if (policy.allowed_chains.length > 0 && action.chain && !policy.allowed_chains.includes(action.chain)) {
    return { outcome: 'deny', reason: `chain not allowed: ${action.chain}`, matched_rule: 'allowed_chains' };
  }

  if (policy.allowed_tools.length > 0 && action.tool_id && !policy.allowed_tools.includes(action.tool_id)) {
    return { outcome: 'deny', reason: `tool not allowed: ${action.tool_id}`, matched_rule: 'allowed_tools' };
  }

  if (policy.allowed_categories.length > 0 && !policy.allowed_categories.includes(action.category)) {
    return { outcome: 'deny', reason: `category not allowed: ${action.category}`, matched_rule: 'allowed_categories' };
  }

  const catLimit = policy.category_limits[action.category];
  if (catLimit?.max_per_tx && gte(action.amount, catLimit.max_per_tx)) {
    return {
      outcome: 'deny',
      reason: `exceeds category max_per_tx for ${action.category}: requested ${action.amount} > limit ${catLimit.max_per_tx}`,
      matched_rule: `category:${action.category} max_per_tx`,
    };
  }

  if (policy.human_approval_threshold && gte(action.amount, policy.human_approval_threshold)) {
    return {
      outcome: 'pending_approval',
      reason: `amount ${action.amount} exceeds human approval threshold ${policy.human_approval_threshold}`,
      matched_rule: 'human_approval_threshold',
    };
  }

  return { outcome: 'allow' };
}