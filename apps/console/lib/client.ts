'use client';

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

export class Client {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

  createMandate(input: Record<string, unknown>) {
    return this.request<{ mandate_id: string; root_agent_id: string; contract_address: string; status: string }>('POST', '/v1/mandates', input);
  }
  getMandate(id: string) {
    return this.request<Record<string, unknown>>('GET', `/v1/mandates/${id}`);
  }
  mandateOverview(id: string) {
    return this.request<Record<string, unknown>>('GET', `/v1/mandates/${id}/overview`);
  }
  spawnAgent(mandateId: string, input: Record<string, unknown>) {
    return this.request<{ agent_id: string; depth: number; share_percent: number }>('POST', `/v1/mandates/${mandateId}/spawn-agent`, input);
  }
  spendIntent(input: Record<string, unknown>) {
    return this.request<{ decision: 'allow' | 'refused'; tx_hash?: string; reservation_id?: string; bound?: string; reason?: string; remaining_window?: string; remaining_lifetime?: string }>('POST', '/v1/spend-intents', input);
  }
  listRefusals(agentId?: string, scope: 'all' | 'standing' | 'released' = 'all') {
    const q = new URLSearchParams();
    if (agentId) q.set('agent_id', agentId);
    q.set('scope', scope);
    return this.request<{ refusals: Array<Record<string, unknown>>; scope: string }>('GET', `/v1/refusals?${q.toString()}`);
  }
  resolveAgent(ref: string) {
    return this.request<Record<string, unknown>>('GET', `/v1/resolve?ref=${encodeURIComponent(ref)}`);
  }
  getVault(mandateId: string) {
    return this.request<{ vault_balance: string }>('GET', `/v1/vaults/${mandateId}`);
  }
  fundVault(mandateId: string, amount: string) {
    return this.request<{ vault_balance: string }>('POST', `/v1/vaults/${mandateId}/fund`, { amount });
  }
  withdrawVault(mandateId: string, input: { amount: string; to_address: string; chain_id: number; signature: string }) {
    return this.request<{ tx_hash: string; vault_balance: string }>('POST', `/v1/vaults/${mandateId}/withdraw`, input);
  }
}