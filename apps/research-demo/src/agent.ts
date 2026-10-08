import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ResearchEvent { type: string; message: string; data?: unknown; at: string }
export interface ResearchRunOptions { question: string; scenario: 'approved' | 'blocked'; emit: (event: ResearchEvent) => void; config?: NodeJS.ProcessEnv }

interface Resource { id: string; title: string; provider: string; category: string; price: string; free: boolean; summary: string }

function event(type: string, message: string, data?: unknown): ResearchEvent { return { type, message, ...(data === undefined ? {} : { data }), at: new Date().toISOString() }; }

function parseToolResult(value: unknown): unknown {
  const content = (value as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;
  if (!text) return value;
  try { return JSON.parse(text); } catch { return text; }
}

async function summarize(question: string, research: unknown, config: NodeJS.ProcessEnv): Promise<string> {
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) {
    const result = research as { resource?: { title?: string; summary?: string }; refusal?: string };
    if (result.refusal) return result.refusal;
    return `Research answer for “${question}”: ${result.resource?.title ?? 'the requested resource'} reports ${result.resource?.summary ?? 'the available market findings.'}`;
  }
  const base = config.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: config.OPENAI_MODEL ?? 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: 'You are a careful research analyst. Summarize only the supplied research and mention when a purchase was refused.' }, { role: 'user', content: `Question: ${question}\nResearch: ${JSON.stringify(research)}` }] }) });
  if (!response.ok) throw new Error(`LLM summary failed (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? 'The model returned no summary.';
}

async function chooseResource(question: string, resources: Resource[], scenario: 'approved' | 'blocked', config: NodeJS.ProcessEnv): Promise<Resource> {
  const fallback = scenario === 'blocked' ? resources.find((item) => item.id === 'ev-premium-outlook') : resources.find((item) => item.id === 'ev-battery-pricing');
  if (!fallback) throw new Error('demo research resource is not available');
  if (scenario === 'blocked' || !config.OPENAI_API_KEY) return fallback;
  const base = config.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${config.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: config.OPENAI_MODEL ?? 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Choose exactly one research resource. Return JSON: {"resource_id":"..."}. Never choose a resource that is not in the catalog.' }, { role: 'user', content: `Question: ${question}\nCatalog: ${JSON.stringify(resources)}` }] }) });
  if (!response.ok) throw new Error(`LLM resource selection failed (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const selected = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}') as { resource_id?: string };
  return resources.find((item) => item.id === selected.resource_id) ?? fallback;
}

export async function runResearch({ question, scenario, emit, config = process.env }: ResearchRunOptions): Promise<{ summary: string; result: unknown; status: 'completed' | 'refused' }> {
  const providerUrl = config.RESEARCH_PROVIDER_URL ?? 'http://127.0.0.1:4010';
  const mcpUrl = config.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
  emit(event('request_received', 'Research request received', { question, scenario }));
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: config.MCP_AUTH_TOKEN ? { headers: { authorization: `Bearer ${config.MCP_AUTH_TOKEN}` } } : undefined });
  const client = new Client({ name: 'bagseven-research-agent', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    emit(event('mcp_connected', 'Research agent connected to worker-bound MCP', { tools: tools.tools.map((tool) => tool.name) }));
    const status = parseToolResult(await client.callTool({ name: 'bagseven_status', arguments: {} }));
    emit(event('mandate_checked', 'Worker mandate and vault status loaded', status));
    emit(event('provider_search', 'Searching research providers through Bagseven MCP'));
    const search = parseToolResult(await client.callTool({ name: 'bagseven_search', arguments: { query: question } })) as { resources?: Resource[] };
    const allResources = search.resources ?? [];
    const resource = await chooseResource(question, allResources, scenario, config);
    emit(event('resource_selected', `Selected ${resource.title}`, { price: resource.price, provider: resource.provider }));
    const result = parseToolResult(await client.callTool({ name: 'bagseven_fetch', arguments: { url: `${providerUrl}/v1/resources/${resource.id}`, reason: `Research task: ${question}` } }));
    const typed = result as { decision?: string; provider?: { status?: number; body?: unknown }; reason?: string };
    if (typed.decision === 'refused' || typed.provider?.status === 402) {
      const refusal = typed.reason ?? 'Bagseven refused this purchase under the active mandate.';
      emit(event('payment_refused', refusal, result));
      const summary = await summarize(question, { refusal }, config);
      emit(event('summary_ready', 'Research summary explains the refusal', { summary }));
      return { summary, result, status: 'refused' };
    }
    emit(event('payment_approved', 'Bagseven approved and settled the research purchase', result));
    const body = typed.provider?.body ?? result;
    const summary = await summarize(question, body, config);
    emit(event('summary_ready', 'Research summary generated', { summary }));
    return { summary, result, status: 'completed' };
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
