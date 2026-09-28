export type StepKey = 'bootstrap' | 'wallet' | 'policy' | 'spend' | 'settle' | 'marketplace';

export interface Balance {
  token: string;
  amount: string;
  reservedAmount: string;
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
  decision: 'allow' | 'deny' | 'pending_approval';
  reason?: string;
  decision_id: string;
  spend_token?: string;
  remaining_daily_budget?: string;
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