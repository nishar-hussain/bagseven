export interface MandateSession {
  mandate_id: string;
  root_agent_id: string;
  contract_address: string;
  owner_address: string;
  operator_address: string;
  budget_per_window: string;
  window_seconds: number;
  lifetime_cap: string;
  per_purchase_cap: string;
  per_seller_pct: number;
  max_depth: number;
}

export interface AgentRow {
  id: string;
  operator_address: string;
  share_percent: string;
  depth: number;
  status: string;
}

export interface Session {
  ownerAddress?: string;
  operatorAddress?: string;
  mandate?: MandateSession;
  tree?: AgentRow[];
  vaultBalance?: string;
}

export const EMPTY_SESSION: Session = {};

export interface Toast {
  id: string;
  kind: 'ok' | 'error' | 'info';
  message: string;
}