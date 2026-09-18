/**
 * Kafka/Redpanda topic registry (from the PRD event catalog, Phase-1 subset).
 * All topics: retention 30 days hot, cold-archived to object storage.
 */
export const TOPICS = {
  IDENTITY_AGENT_CREATED: 'identity.agent.created',
  IDENTITY_AGENT_STATUS_CHANGED: 'identity.agent.status_changed',
  IDENTITY_GUARDIAN_APPROVAL_REQUESTED: 'identity.guardian_approval.requested',
  IDENTITY_GUARDIAN_APPROVAL_RESPONDED: 'identity.guardian_approval.responded',
  POLICY_DECISION_MADE: 'policy.decision.made',
  POLICY_VERSION_CREATED: 'policy.version.created',
  TREASURY_RESERVATION_HELD: 'treasury.reservation.held',
  TREASURY_RESERVATION_COMMITTED: 'treasury.reservation.committed',
  TREASURY_RESERVATION_RELEASED: 'treasury.reservation.released',
  TREASURY_SETTLEMENT_CONFIRMED: 'treasury.settlement.confirmed',
  TREASURY_SETTLEMENT_FAILED: 'treasury.settlement.failed',
  MARKETPLACE_TOOL_EXECUTION_COMPLETED: 'marketplace.tool.execution.completed',
  MARKETPLACE_DATA_ESCROW_RESOLVED: 'marketplace.data.escrow.resolved',
  PAYMENTS_INTENT_CONFIRMED: 'payments.intent.confirmed',
  VERIFICATION_RECEIPT_CREATED: 'verification.receipt.created',
  EVOLUTION_CANDIDATE_CREATED: 'evolution.candidate.created',
  EVOLUTION_PROMOTED: 'evolution.promoted',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export interface Envelope<T> {
  id: string;
  topic: Topic;
  key: string;
  payload: T;
  createdAt: string;
}