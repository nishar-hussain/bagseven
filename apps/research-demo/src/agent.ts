import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ResearchEvent { type: string; message: string; data?: unknown; at: string }
export interface ResearchRunOptions { question: string; scenario: 'approved' | 'blocked'; emit: (event: ResearchEvent) => void; config?: NodeJS.ProcessEnv }

function event(type: string, message: string, data?: unknown): ResearchEvent { return { type, message, ...(data === undefined ? {} : { data }), at: new Date().toISOString() }; }

function parseToolResult(value: unknown): unknown {
  const content = (value as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;
  if (!text) return value;
  try { return JSON.parse(text); } catch { return text; }
}

function toolFailure(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (error !== undefined) return JSON.stringify(error);
  }
  return undefined;
}

function toolContentText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { content?: unknown }).content)) return undefined;
  const text = (value as { content: Array<{ type?: string; text?: string }> }).content
    .find((item) => item.type === 'text' && item.text)?.text;
  return text?.slice(0, 1000);
}

interface OpenRouterMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; tool_call_id?: string }
interface ToolDefinition { type: 'function'; function: { name: string; description?: string; parameters: unknown } }

async function callModel(messages: OpenRouterMessage[], tools: ToolDefinition[], config: NodeJS.ProcessEnv): Promise<OpenRouterMessage> {
  const apiKey = config.CLINE_API_KEY ?? config.OPENCODE_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) throw new Error('CLINE_API_KEY is required; mock/fallback mode is disabled');
  const base = config.CLINE_BASE_URL ?? config.OPENCODE_BASE_URL ?? config.OPENAI_BASE_URL ?? 'https://api.cline.bot/api/v1';
  const model = config.CLINE_MODEL ?? config.OPENCODE_MODEL ?? config.OPENAI_MODEL ?? 'minimax/minimax-m2.5';
  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    // Cline supports streaming, but the research loop expects one complete
    // OpenAI-compatible JSON response so it can execute MCP tool calls.
    body: JSON.stringify({ model, temperature: 0.2, messages, tools, tool_choice: 'auto', stream: false }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`LLM request failed (${response.status}): ${raw.slice(0, 500)}`);
  const envelope = JSON.parse(raw) as { choices?: Array<{ message?: OpenRouterMessage }>; data?: { choices?: Array<{ message?: OpenRouterMessage }> } };
  // Cline returns { success, data: { choices } }, while other
  // OpenAI-compatible providers return { choices } directly.
  const payload = envelope.data ?? envelope;
  const message = payload.choices?.[0]?.message;
  if (!message) {
    const keys = Object.keys(envelope).join(', ') || 'none';
    throw new Error(`LLM returned no assistant message (response keys: ${keys}; body: ${raw.slice(0, 300)})`);
  }
  return message;
}

export async function runResearch({ question, scenario, emit, config = process.env }: ResearchRunOptions): Promise<{ summary: string; result: unknown; status: 'completed' | 'refused' }> {
  if (!(config.CLINE_API_KEY ?? config.OPENCODE_API_KEY ?? config.OPENAI_API_KEY)) throw new Error('CLINE_API_KEY is required; configure a real Cline model before running the agent');
  const mcpUrl = config.BAGSEVEN_MCP_URL ?? 'http://127.0.0.1:4009/v1/mcp';
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: config.MCP_AUTH_TOKEN ? { headers: { authorization: `Bearer ${config.MCP_AUTH_TOKEN}` } } : undefined });
  const client = new Client({ name: 'bagseven-research-agent', version: '0.2.0' }, { capabilities: {} });
  const messages: OpenRouterMessage[] = [{ role: 'system', content: ['You are a Bagseven research agent.', 'For payment tasks, call bagseven_status first, then inspect the exact user-supplied endpoint without changing its hostname or URL.', 'Use the provided Bagseven MCP tools to inspect the worker, search live providers, and fetch research.', 'Never invent research, payment results, transaction hashes, or mandate decisions.', 'Only say payment succeeded when bagseven_fetch returns decision allow, provider status 200, and a paid live resource.', 'If any MCP tool returns an error, stop immediately and report that exact error. Never retry a failed bagseven_fetch call.', 'If a purchase is refused or unsupported, stop and report the refusal. Do not try another URL, provider, recipient, or amount.', scenario === 'blocked' ? 'For this test, choose the most expensive available live research resource so mandate refusal can be demonstrated.' : 'Choose the best live resource for the user task and keep spending within the active mandate.', 'After executing the tools, answer the user directly with sources and a concise summary.'].join('\n') }, { role: 'user', content: question }];
  let lastToolResult: unknown;
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools: ToolDefinition[] = listed.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
    emit(event('mcp_connected', 'Real agent connected to worker-bound Bagseven MCP', { tools: tools.map((tool) => tool.function.name) }));
    for (let turn = 0; turn < 8; turn += 1) {
      const assistant = await callModel(messages, tools, config);
      messages.push(assistant);
      const calls = assistant.tool_calls ?? [];
      if (calls.length === 0) {
        if (!assistant.content?.trim()) throw new Error('LLM returned no final answer');
        const refused = typeof lastToolResult === 'object' && lastToolResult !== null && (lastToolResult as { decision?: string }).decision === 'refused';
        emit(event('summary_ready', 'Real LLM response generated', { summary: assistant.content }));
        return { summary: assistant.content, result: lastToolResult, status: refused ? 'refused' : 'completed' };
      }
      for (const call of calls) {
        let args: Record<string, unknown>;
        try { args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>; } catch { throw new Error(`LLM returned invalid arguments for ${call.function.name}`); }
        emit(event('tool_call', `Agent called ${call.function.name}`, args));
        const callResult = await client.callTool({ name: call.function.name, arguments: args }) as { isError?: boolean; content?: unknown };
        const toolResult = parseToolResult(callResult);
        lastToolResult = toolResult;
        const failure = toolFailure(toolResult) ?? (callResult.isError ? toolContentText(callResult) : undefined);
        if (callResult.isError || failure) {
          const message = failure ?? `MCP tool ${call.function.name} failed`;
          emit(event('error', `Bagseven MCP rejected ${call.function.name}: ${message}`, toolResult));
          throw new Error(`Bagseven MCP ${call.function.name} failed: ${message}`);
        }
        if (call.function.name === 'bagseven_status') emit(event('mandate_checked', 'Worker mandate and vault status loaded', toolResult));
        if (call.function.name === 'bagseven_search') emit(event('provider_search', 'Searching live research providers through Bagseven MCP', toolResult));
        if (call.function.name === 'bagseven_fetch') {
          const typed = toolResult as { decision?: string; provider?: { status?: number } };
          if (typed.decision === 'allow' && typed.provider?.status === 200) emit(event('payment_approved', 'Bagseven approved and settled the live research purchase', toolResult));
          else if (typed.decision === 'refused') {
            emit(event('payment_refused', 'Bagseven refused the purchase under the active mandate; no retry was attempted', toolResult));
            return { summary: `Bagseven refused the purchase. Exact result:\n${JSON.stringify(toolResult, null, 2)}`, result: toolResult, status: 'refused' };
          } else {
            emit(event('payment_error', 'Payment or provider execution failed; no retry was attempted', toolResult));
            throw new Error(`Bagseven payment did not succeed: ${JSON.stringify(toolResult)}`);
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
      }
    }
    throw new Error('Agent exceeded the maximum MCP tool-call turns');
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
