'use client';

import { importEd25519PrivateKey, signEnvelope, type Envelope } from './crypto';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export class ConsoleClient {
  private readonly baseUrl: string;
  private agentId?: string;
  private privateKeyPromise?: Promise<CryptoKey>;

  get url(): string {
    return this.baseUrl;
  }

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setAgent(agentId: string, privateKeyPem: string): void {
    this.agentId = agentId;
    this.privateKeyPromise = importEd25519PrivateKey(privateKeyPem);
  }

  private async ensureKey(): Promise<CryptoKey> {
    if (!this.privateKeyPromise) throw new Error('agent signing key not loaded — re-create or reload the session');
    return this.privateKeyPromise;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { idempotencyKey?: string; headers?: Record<string, string>; signed?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { ...opts.headers };
    const hasBody = body !== undefined;
    if (hasBody) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    if (opts.signed !== false && this.agentId && this.privateKeyPromise) {
      const env: Envelope = await signEnvelope(this.agentId, method, path, body ?? null, await this.ensureKey());
      headers['x-agent-envelope'] = JSON.stringify(env);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new ApiError(
        res.status,
        (parsed as { error?: { code?: string } })?.error?.code ?? 'error',
        (parsed as { error?: { message?: string } })?.error?.message ?? res.statusText,
        parsed,
      );
    }
    return parsed as T;
  }

  // Bootstrap (unsigned)
  createOrg(legalName: string) {
    return this.request<{ organization: { id: string } }>('POST', '/v1/organizations', { legal_name: legalName }, { signed: false });
  }
  createGuardian(input: { type: 'human'; org_id: string; contact_email?: string }) {
    return this.request<{ guardian: { id: string }; guardian_token: string }>('POST', '/v1/guardians', input, { signed: false });
  }
  createAgent(input: { owner_org_id: string; guardian_id: string; display_name: string; capabilities?: string[] }) {
    return this.request<{ agent_id: string; api_key: string; signing_private_key_pem: string; status: string }>('POST', '/v1/agents', input, { signed: false });
  }
  confirmAgent(id: string, guardianToken: string) {
    return this.request<{ agent: { status: string } }>('POST', `/v1/agents/${id}/confirm`, undefined, {
      signed: false,
      headers: { 'x-guardian-token': guardianToken },
    });
  }

  getAgent(id: string) {
    return this.request<{ agent: { id: string; status: string } }>(`GET`, `/v1/agents/${id}`, undefined, { signed: false });
  }

  // Agent-authenticated
  provisionWallet(agentId: string, chain: string) {
    return this.request<{ wallet: { id: string; address: string } }>('POST', '/v1/wallets', { agent_id: agentId, chain });
  }
  creditWallet(walletId: string, token: string, amount: string) {
    return this.request<{ balance: { amount: string } }>('POST', `/v1/wallets/${walletId}/credit`, { token, amount });
  }
  reconcileWallet(walletId: string) {
    return this.request<{ wallet_id: string; balances: Array<{ token: string; amount: string; reservedAmount: string }> }>('POST', `/v1/wallets/${walletId}/reconcile`);
  }
  getWallet(agentId: string) {
    return this.request<{ wallets: Array<{ wallet: { id: string; chain: string; address: string }; balances: Array<{ token: string; amount: string; reservedAmount: string }> }> }>(`GET`, `/v1/wallets/${agentId}`);
  }
  createPolicy(input: Record<string, unknown>) {
    return this.request<{ policy_id: string; version: number }>('POST', '/v1/policies', input);
  }
  spendIntent(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{
      decision: 'allow' | 'deny' | 'pending_approval';
      reason?: string;
      decision_id: string;
      spend_token?: string;
      remaining_daily_budget?: string;
      requires_human_approval?: boolean;
    }>('POST', '/v1/spend-intents', input, { idempotencyKey });
  }
  reserve(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{ reservation_id: string; status: string; policy_decision_id: string }>('POST', '/v1/reservations', input, { idempotencyKey });
  }
  commitReservation(id: string) {
    return this.request<{ reservation_id: string; status: string; tx_hash: string }>('POST', `/v1/reservations/${id}/commit`);
  }
  getAgentReceipts(agentId: string) {
    return this.request<{ receipts: Array<{ id: string; proofHash: string; prevHash: string }> }>(`GET`, `/v1/agents/${agentId}/receipts`);
  }

  // Marketplace
  registerProvider(input: { name: string; payout_wallet_address: string; payout_chain?: string }) {
    return this.request<{ provider_id: string; provider_token: string; status: string }>('POST', '/v1/tool-providers', input, { signed: false });
  }
  approveProvider(id: string) {
    return this.request<{ provider_id: string; status: string }>('POST', `/v1/tool-providers/${id}/approve`, undefined, { signed: false });
  }
  createTool(providerToken: string, input: Record<string, unknown>) {
    return this.request<{ tool: { id: string } }>('POST', '/v1/tools', input, { headers: { 'x-provider-token': providerToken } });
  }
  listTools(query: { category?: string; max_price?: string } = {}) {
    const q = new URLSearchParams();
    if (query.category) q.set('category', query.category);
    if (query.max_price) q.set('max_price', query.max_price);
    return this.request<{ tools: Array<{ id: string; name: string; description: string | null; category: string; price: string; endpointUrl: string; inputSchema?: Record<string, unknown> | null; provider: { id: string; name: string } }> }>(`GET`, `/v1/tools${q.size ? `?${q.toString()}` : ''}`, undefined, { signed: false });
  }
  executeTool(toolId: string, agentId: string, input: Record<string, unknown>, idemKey: string) {
    return this.request<{ execution_id: string; status: string; output: unknown; price_paid: string; tx_hash?: string }>('POST', `/v1/tools/${toolId}/execute`, { agent_id: agentId, input }, { idempotencyKey: idemKey });
  }
}

export function makeIdempotencyKey(agentId: string, label: string): string {
  return `${agentId.slice(0, 8)}-${label}-${Date.now()}`;
}