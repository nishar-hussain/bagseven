import { hashBody, newNonce, signEnvelope, type Envelope } from '@agentos/auth';

export interface ClientOptions {
  baseUrl: string;
  agentId?: string;
  privateKeyPem?: string;
  fetchImpl?: typeof fetch;
}

export class AgentosError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface SpendIntent {
  amount: string;
  currency: string;
  category: string;
  counterparty?: string;
  chain?: string;
  toolId?: string;
  dataOfferId?: string;
}

export interface SpendDecision {
  decision: 'allow' | 'deny' | 'pending_approval' | 'refused';
  reason?: string;
  remaining_daily_budget?: string;
  matched_policy_rule?: string;
  requires_human_approval: boolean;
  spend_token?: string;
  decision_id: string;
  violated_bound?: string;
  refusal_id?: string | null;
  mandate_id?: string;
  remaining_window?: string;
  remaining_lifetime?: string;
  remaining_vault?: string;
  can_draw?: string;
}

export interface AgentRecord {
  id: string;
  owner_org_id: string;
  guardian_id: string;
  display_name: string;
  status: string;
  reputation_score: string;
  created_at: string;
}

export class Client {
  private readonly baseUrl: string;
  private readonly agentId?: string;
  private readonly privateKeyPem?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.agentId = opts.agentId;
    this.privateKeyPem = opts.privateKeyPem;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { idempotencyKey?: string; headers?: Record<string, string> } = {},
  ): Promise<unknown> {
    const bodyHash = hashBody(body ?? null);
    const hasBody = body !== undefined;
    const headers: Record<string, string> = { ...opts.headers };
    if (hasBody) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    if (this.agentId && this.privateKeyPem) {
      const env: Omit<Envelope, 'signature'> = {
        agent_id: this.agentId,
        method,
        path,
        body_hash: bodyHash,
        nonce: newNonce(),
        timestamp: new Date().toISOString(),
      };
      const signed = signEnvelope(env, this.privateKeyPem);
      headers['x-agent-envelope'] = JSON.stringify(signed);
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new AgentosError(
        res.status,
        (parsed as { error?: { code?: string } })?.error?.code ?? 'error',
        (parsed as { error?: { message?: string } })?.error?.message ?? res.statusText,
        parsed,
      );
    }
    return parsed;
  }

  // Identity
  createOrganization(input: { legal_name: string }): Promise<{ organization: { id: string } }> {
    return this.request('POST', '/v1/organizations', input) as Promise<{ organization: { id: string } }>;
  }

  createGuardian(input: {
    type: 'human' | 'organization';
    org_id?: string;
    contact_email?: string;
  }): Promise<{ guardian: { id: string }; guardian_token: string }> {
    return this.request('POST', '/v1/guardians', input) as Promise<{
      guardian: { id: string };
      guardian_token: string;
    }>;
  }

  createAgent(input: {
    owner_org_id: string;
    guardian_id: string;
    display_name: string;
    capabilities?: string[];
  }): Promise<{
    agent_id: string;
    api_key: string;
    signing_private_key_pem: string;
    status: string;
  }> {
    return this.request('POST', '/v1/agents', input) as Promise<{
      agent_id: string;
      api_key: string;
      signing_private_key_pem: string;
      status: string;
    }>;
  }

  getAgent(id: string): Promise<AgentRecord> {
    return this.request('GET', `/v1/agents/${id}`) as Promise<AgentRecord>;
  }

  confirmAgent(id: string, guardianToken: string): Promise<AgentRecord> {
    return this.request('POST', `/v1/agents/${id}/confirm`, undefined, {
      headers: { 'x-guardian-token': guardianToken },
    }).then((r) => (r as { agent: AgentRecord }).agent) as Promise<AgentRecord>;
  }

  suspendAgent(id: string, guardianToken: string): Promise<AgentRecord> {
    return this.request('POST', `/v1/agents/${id}/suspend`, undefined, {
      headers: { 'x-guardian-token': guardianToken },
    }).then((r) => (r as { agent: AgentRecord }).agent) as Promise<AgentRecord>;
  }

  delegateAgent(
    parentId: string,
    input: { display_name: string; capabilities?: string[]; delegation_rules?: { max_daily_budget: string; max_transaction: string; allowed_chains?: string[]; allowed_categories?: string[] } },
    guardianToken: string,
  ): Promise<{ agent_id: string; api_key: string; signing_private_key_pem: string; status: string; parent_agent_id: string; policy?: { policy_id: string; version: number } }> {
    return this.request('POST', `/v1/agents/${parentId}/delegate`, input, {
      headers: { 'x-guardian-token': guardianToken },
    }) as Promise<{
      agent_id: string;
      api_key: string;
      signing_private_key_pem: string;
      status: string;
      parent_agent_id: string;
      policy?: { policy_id: string; version: number };
    }>;
  }

  retireAgent(id: string, guardianToken: string): Promise<AgentRecord> {
    return this.request('POST', `/v1/agents/${id}/retire`, undefined, {
      headers: { 'x-guardian-token': guardianToken },
    }).then((r) => (r as { agent: AgentRecord }).agent) as Promise<AgentRecord>;
  }

  respondApproval(id: string, status: 'approved' | 'rejected', guardianToken: string): Promise<{
    status: string;
    decision: string;
    decision_id?: string;
    spend_token?: string;
    reason?: string;
  }> {
    return this.request('POST', `/v1/guardian-approvals/${id}/respond`, { status }, {
      headers: { 'x-guardian-token': guardianToken },
    }) as Promise<{
      status: string;
      decision: string;
      decision_id?: string;
      spend_token?: string;
      reason?: string;
    }>;
  }

  spendSummary(agentId: string): Promise<{
    agent_id: string;
    policy_version: number;
    daily_budget: string;
    daily_spent: string;
    monthly_budget: string | null;
    monthly_spent: string;
    children_spent: string;
    categories: Record<string, { limit?: { max_per_tx?: string; daily_budget?: string }; spent: string }>;
  }> {
    return this.request('GET', `/v1/agents/${agentId}/spend-summary`) as Promise<{
      agent_id: string;
      policy_version: number;
      daily_budget: string;
      daily_spent: string;
      monthly_budget: string | null;
      monthly_spent: string;
      children_spent: string;
      categories: Record<string, { limit?: { max_per_tx?: string; daily_budget?: string }; spent: string }>;
    }>;
  }

  sweepWallet(walletId: string, toAddress: string): Promise<{ wallet_id: string; status: string; usdcTxHash?: string; ethTxHash?: string }> {
    return this.request('POST', `/v1/wallets/${walletId}/sweep`, { to_address: toAddress }) as Promise<{
      wallet_id: string;
      status: string;
      usdcTxHash?: string;
      ethTxHash?: string;
    }>;
  }

  reconcileWallet(walletId: string): Promise<{ wallet_id: string; balances: Array<{ token: string; amount: string; reservedAmount: string }> }> {
    return this.request('POST', `/v1/wallets/${walletId}/reconcile`) as Promise<{
      wallet_id: string;
      balances: Array<{ token: string; amount: string; reservedAmount: string }>;
    }>;
  }

  compensate(input: { decision_id: string; agent_id: string; amount: string; category: string; include_monthly?: boolean }): Promise<{ applied: boolean }> {
    return this.request('POST', '/v1/compensations', { include_monthly: true, ...input }) as Promise<{ applied: boolean }>;
  }

  // Marketplace — tools
  registerProvider(input: {
    name: string;
    contact_email?: string;
    payout_wallet_address: string;
    payout_chain?: string;
  }): Promise<{ provider_id: string; provider_token: string; status: string }> {
    return this.request('POST', '/v1/tool-providers', input) as Promise<{
      provider_id: string;
      provider_token: string;
      status: string;
    }>;
  }

  approveProvider(id: string): Promise<{ provider_id: string; status: string }> {
    return this.request('POST', `/v1/tool-providers/${id}/approve`, undefined) as Promise<{
      provider_id: string;
      status: string;
    }>;
  }

  createTool(providerToken: string, input: {
    provider_id: string;
    name: string;
    description?: string;
    category?: string;
    price: string;
    price_token?: string;
    endpoint_url: string;
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
  }): Promise<{ tool: { id: string } }> {
    return this.request('POST', '/v1/tools', input, {
      headers: { 'x-provider-token': providerToken },
    }) as Promise<{ tool: { id: string } }>;
  }

  listTools(query: { category?: string; max_price?: string } = {}): Promise<{ tools: Array<{ id: string; name: string; description: string | null; category: string; price: string; priceToken: string; endpointUrl: string; provider: { id: string; name: string } }> }> {
    const q = new URLSearchParams();
    if (query.category) q.set('category', query.category);
    if (query.max_price) q.set('max_price', query.max_price);
    return this.request('GET', `/v1/tools${q.size ? `?${q.toString()}` : ''}`, undefined) as Promise<{
      tools: Array<{ id: string; name: string; description: string | null; category: string; price: string; priceToken: string; endpointUrl: string; provider: { id: string; name: string } }>;
    }>;
  }

  executeTool(agentId: string, toolId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<{
    execution_id: string;
    status: string;
    output: unknown;
    price_paid: string;
    tx_hash?: string;
    reservation_id?: string;
  }> {
    return this.request('POST', `/v1/tools/${toolId}/execute`, { agent_id: agentId, input }, { idempotencyKey }) as Promise<{
      execution_id: string;
      status: string;
      output: unknown;
      price_paid: string;
      tx_hash?: string;
      reservation_id?: string;
    }>;
  }

  getExecution(id: string): Promise<{ execution: { id: string; status: string; pricePaid: string | null; txHash: string | null } }> {
    return this.request('GET', `/v1/tool-executions/${id}`) as Promise<{
      execution: { id: string; status: string; pricePaid: string | null; txHash: string | null };
    }>;
  }

  // Policy
  createPolicy(input: Record<string, unknown>): Promise<{ policy_id: string; version: number }> {
    return this.request('POST', '/v1/policies', input) as Promise<{
      policy_id: string;
      version: number;
    }>;
  }

  proposeSpend(agentId: string, input: SpendIntent, idempotencyKey: string): Promise<SpendDecision> {
    return this.request('POST', '/v1/spend-intents', {
      agent_id: agentId,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      chain: input.chain,
      counterparty_id: input.counterparty,
      tool_id: input.toolId,
      data_offer_id: input.dataOfferId,
    }, {
      idempotencyKey,
    }) as Promise<SpendDecision>;
  }

  // Treasury
  provisionWallet(input: { agent_id: string; chain: string }): Promise<{ wallet: { id: string; address: string } }> {
    return this.request('POST', '/v1/wallets', input) as Promise<{ wallet: { id: string; address: string } }>;
  }

  creditWallet(walletId: string, input: { token: string; amount: string }): Promise<{ balance: { amount: string } }> {
    return this.request('POST', `/v1/wallets/${walletId}/credit`, input) as Promise<{
      balance: { amount: string };
    }>;
  }

  // Mandate
  createMandate(input: {
    agent_id: string;
    budget_per_window: string;
    window_seconds: number;
    lifetime_cap: string;
    per_purchase_limit: string;
    per_seller_limit_bps: number;
    max_depth: number;
    chain?: string;
  }): Promise<{ mandate_id: string; agent_id: string; operator_address: string; signature: string; status: string }> {
    return this.request('POST', '/v1/mandates', input) as Promise<{ mandate_id: string; agent_id: string; operator_address: string; signature: string; status: string }>;
  }

  getActiveMandate(agentId: string): Promise<{ mandate: Record<string, unknown> }> {
    return this.request('GET', `/v1/mandates/${agentId}/active`) as Promise<{ mandate: Record<string, unknown> }>;
  }

  mandateOverview(mandateId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/v1/mandates/${mandateId}/overview`) as Promise<Record<string, unknown>>;
  }

  listRefusals(input: { agent_id?: string; scope?: 'all' | 'standing' | 'released' } = {}): Promise<{ refusals: Array<Record<string, unknown>>; scope: string }> {
    const q = new URLSearchParams();
    if (input.agent_id) q.set('agent_id', input.agent_id);
    if (input.scope) q.set('scope', input.scope);
    return this.request('GET', `/v1/refusals${q.size ? `?${q.toString()}` : ''}`, undefined) as Promise<{ refusals: Array<Record<string, unknown>>; scope: string }>;
  }

  resolveAgent(ref: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/v1/resolve?ref=${encodeURIComponent(ref)}`) as Promise<Record<string, unknown>>;
  }

  spawnAgent(mandateId: string, input: { parent_agent_id: string; display_name: string; share_bps: number; capabilities?: string[] }): Promise<Record<string, unknown>> {
    return this.request('POST', `/v1/mandates/${mandateId}/spawn-agent`, input) as Promise<Record<string, unknown>>;
  }

  withdrawVault(vaultId: string, input: { amount: string; to_address?: string }): Promise<Record<string, unknown>> {
    return this.request('POST', `/v1/vaults/${vaultId}/withdraw`, input) as Promise<Record<string, unknown>>;
  }

  getWallets(agentId: string): Promise<{ wallets: Array<{ wallet: { id: string; chain: string; address: string }; balances: Array<{ token: string; amount: string; reservedAmount: string }> }> }> {
    return this.request('GET', `/v1/wallets/${agentId}`) as Promise<{
      wallets: Array<{
        wallet: { id: string; chain: string; address: string };
        balances: Array<{ token: string; amount: string; reservedAmount: string }>;
      }>;
    }>;
  }

  reserve(input: {
    wallet_id: string;
    token: string;
    amount: string;
    spend_token: string;
    counterparty_id?: string;
    counterparty_type?: 'tool_provider' | 'data_provider' | 'agent' | 'guardian';
  }, idempotencyKey: string): Promise<{ reservation_id: string; status: string; policy_decision_id: string }> {
    return this.request('POST', '/v1/reservations', input, { idempotencyKey }) as Promise<{
      reservation_id: string;
      status: string;
      policy_decision_id: string;
    }>;
  }

  commitReservation(id: string): Promise<{ reservation_id: string; status: string; tx_hash: string }> {
    return this.request('POST', `/v1/reservations/${id}/commit`) as Promise<{
      reservation_id: string;
      status: string;
      tx_hash: string;
    }>;
  }

  releaseReservation(id: string): Promise<{ reservation_id: string; status: string }> {
    return this.request('POST', `/v1/reservations/${id}/release`) as Promise<{ reservation_id: string; status: string }>;
  }

  // Verification
  getReceipt(id: string): Promise<{ receipt: { id: string; proofHash: string; prevHash: string; actorAgentId: string } }> {
    return this.request('GET', `/v1/receipts/${id}`) as Promise<{
      receipt: { id: string; proofHash: string; prevHash: string; actorAgentId: string };
    }>;
  }

  getAgentReceipts(agentId: string): Promise<{ receipts: Array<{ id: string; proofHash: string; prevHash: string }> }> {
    return this.request('GET', `/v1/agents/${agentId}/receipts`) as Promise<{
      receipts: Array<{ id: string; proofHash: string; prevHash: string }>;
    }>;
  }
}