/**
 * Bagseven MCP — the agent-facing protocol adapter.
 *
 * MCP deliberately contains no wallet or policy logic. It forwards requests
 * to the Bagseven daemon, which identifies the worker, signs the request and
 * calls the policy/mandate services.
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && process.env[line.slice(0, i)] === undefined) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch {
  /* .env is optional in deployed environments. */
}

const DAEMON = process.env.DAEMON_URL ?? 'http://localhost:4001';
const WORKER = process.env.BAGSEVEN_MCP_WORKER;
const RESEARCH_PROVIDER = process.env.RESEARCH_PROVIDER_URL ?? 'http://127.0.0.1:4010';

async function daemon(method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (process.env.DAEMON_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.DAEMON_AUTH_TOKEN}`;
  const response = await fetch(`${DAEMON}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : undefined;
  if (!response.ok) {
    const error = (payload as { error?: { message?: string } } | undefined)?.error?.message;
    throw new Error(error ?? `Bagseven daemon request failed (${response.status})`);
  }
  return payload;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

function buildServer(): McpServer {
  if (!WORKER) throw new Error('BAGSEVEN_MCP_WORKER must bind this MCP instance to one worker');
  const server = new McpServer({ name: 'bagseven-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.registerTool(
    'bagseven_status',
    {
      title: 'Bagseven worker status',
      description: 'Read the worker identity, mandate limits and live remaining vault capacity.',
      inputSchema: {},
    },
    async () => text(await daemon('POST', `/internal/workers/${encodeURIComponent(WORKER)}/status`)),
  );

  server.registerTool(
    'bagseven_search',
    {
      title: 'Bagseven research search',
      description: 'Search research providers available to this Bagseven agent.',
      inputSchema: { query: z.string().min(1).max(500) },
    },
    async ({ query }) => {
      const response = await fetch(`${RESEARCH_PROVIDER}/v1/providers`);
      if (!response.ok) throw new Error(`research provider search failed (${response.status})`);
      const catalog = await response.json() as { providers?: Array<{ resources?: Array<{ id: string; title: string; category: string; price: string; provider: string; free: boolean; summary: string }> }> };
      const resources = (catalog.providers ?? []).flatMap((provider) => provider.resources ?? []).filter((resource) => `${resource.title} ${resource.category} ${resource.summary}`.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes('electric vehicle'));
      return text({ query, resources });
    },
  );

  server.registerTool(
    'bagseven_fetch',
    {
      title: 'Bagseven controlled payment',
      description: 'Request a direct payment or fetch a paid HTTP resource. The Bagseven daemon handles the payment challenge, policy evaluation and mandate settlement.',
      inputSchema: {
        url: z.string().url().optional().describe('paid HTTP resource; the daemon will handle a 402 payment challenge'),
        amount: z.string().min(1).optional().describe('direct USDC amount, for example 0.10'),
        recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe('direct recipient wallet address'),
        reason: z.string().max(500).optional().describe('audit reason'),
      },
    },
    async ({ url, amount, recipient, reason }) => text(await daemon('POST', `/internal/workers/${encodeURIComponent(WORKER)}/fetch`, { url, amount, recipient, reason })),
  );

  server.registerTool(
    'bagseven_spawn',
    {
      title: 'Bagseven child worker',
      description: 'Create a child worker under an existing Bagseven mandate.',
      inputSchema: {
        mandate_id: z.string().uuid(),
        parent_agent_id: z.string().uuid(),
        operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        share_percent: z.number().int().min(1).max(100),
      },
    },
    async ({ mandate_id, parent_agent_id, operator_address, share_percent }) => text(await daemon('POST', `/internal/workers/${encodeURIComponent(WORKER)}/spawn`, { mandate_id, parent_agent_id, operator_address, share_percent })),
  );

  return server;
}

async function main(): Promise<void> {
  if (!WORKER) throw new Error('BAGSEVEN_MCP_WORKER is required');
  const httpPort = process.env.BAGSEVEN_MCP_PORT ?? process.env.MCP_HTTP_PORT;
  if (httpPort) {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
    app.get('/v1/mcp', (_req, res) => res.json({ ok: true, service: 'bagseven-mcp', worker: WORKER }));
    app.post('/v1/mcp', async (req, res) => {
      if (process.env.MCP_AUTH_TOKEN && req.headers.authorization !== `Bearer ${process.env.MCP_AUTH_TOKEN}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const sessionId = (req.headers['mcp-session-id'] as string) ?? crypto.randomUUID();
      let transport = transports.get(sessionId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, onsessioninitialized: () => undefined });
        transports.set(sessionId, transport);
        await buildServer().connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    });
    app.listen(Number(httpPort), '127.0.0.1', () => console.error(`[bagseven-mcp] HTTP listening on http://127.0.0.1:${httpPort}/v1/mcp`));
  } else {
    await buildServer().connect(new StdioServerTransport());
    console.error('[bagseven-mcp] stdio server ready');
  }
}

main().catch((err) => {
  console.error('[bagseven-mcp] fatal', err);
  process.exit(1);
});
