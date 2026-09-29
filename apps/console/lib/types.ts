export type StepKey = 'bootstrap' | 'wallet' | 'policy' | 'spend' | 'settle' | 'marketplace';

export interface Balance {
  token: string;
  amount: string;
  reservedAmount: string;
}

export interface MandateSummary {
  mandate_id: string;
  operator_address?: string;
  budget_per_window: string;
  window_seconds: number;
  lifetime_cap: string;
  per_purchase_limit: string;
  per_seller_limit_bps: number;
  max_depth: number;
  contract_address?: string | null;
  signature?: string;
}

export interface VaultSummary {
  vault_id: string;
  wallet_id?: string;
  contract_address?: string | null;
  address?: string;
}

export interface PolicySummary {
  policy_id: string;
  version: number;
  daily_budget?: string;
  max_transaction?: string;
  category_limits?: Record<string, { max_per_tx?: string; daily_budget?: string }>;
  human_approval_threshold?: string | null;
}

export interface SpendDecision {
  decision: 'allow' | 'deny' | 'pending_approval' | 'refused';
  reason?: string;
  decision_id: string;
  spend_token?: string;
  remaining_daily_budget?: string;
  remaining_window?: string;
  remaining_lifetime?: string;
  remaining_vault?: string;
  can_draw?: string;
  violated_bound?: string;
  refusal_id?: string | null;
  requires_human_approval?: boolean;
}

export interface SpendRecord {
  at: string;
  amount: string;
  category: string;
  chain: string;
  counterparty_id: string;
  decision: string;
  reason?: string;
  decision_id: string;
  idemKey: string;
  remaining?: string;
}

export interface Session {
  orgId: string;
  orgName: string;
  guardianId: string;
  guardianToken: string;
  agentId: string;
  agentName: string;
  apiKey: string;
  signingKeyPem: string;
  agentStatus: string;
  walletId?: string;
  walletAddress?: string;
  balances: Balance[];
  mandate?: MandateSummary;
  vault?: VaultSummary;
  policy?: PolicySummary;
  lastDecision?: SpendRecord & { spend_token?: string };
  spendHistory: SpendRecord[];
  reservationId?: string;
  txHash?: string;
  receiptId?: string;
  toolExecutions?: number;
  lastToolExecution?: { id: string; name: string; price: string; txHash?: string; output?: string };
  payeeAgent?: { id: string; address: string };
  userWallet?: string;
  spendForm?: { amount: string; category: string; counterparty: string };
  fundAmount?: string;
  marketplaceInput?: string;
  tree?: Array<{ id: string; display_name: string; parent_agent_id: string | null; depth: number; share_bps: string | null; status: string }>;
}

export const EMPTY_SESSION: Session = {
  orgId: '',
  orgName: '',
  guardianId: '',
  guardianToken: '',
  agentId: '',
  agentName: '',
  apiKey: '',
  signingKeyPem: '',
  agentStatus: '',
  balances: [],
  spendHistory: [],
  toolExecutions: 0,
};

export interface Toast {
  id: string;
  kind: 'ok' | 'error' | 'info';
  message: string;
}

export type LogKind = 'in' | 'ok' | 'err';
export interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
}