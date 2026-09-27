import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '@agentos/db';
import { eq } from 'drizzle-orm';
import { tools, toolProviders } from '@agentos/db';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const MCP_PORT = Number(process.env.MCP_PORT ?? 4008);
const transports = new Map<string, StreamableHTTPServerTransport>();

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * MCP discovery endpoint (slice 2.4). Any MCP-compatible agent framework can
 * connect to http://localhost:4008/mcp, list the marketplace tools, and call one
 * on behalf of an agent (agent_id is supplied as a tool argument).
 */
export async function startMcpServer({ db, config }: { db: Database; config: NodeJS.ProcessEnv }): Promise<void> {
  const marketplaceUrl = config.MARKETPLACE_URL ?? 'http://localhost:4005';
  const server = new McpServer({ name: 'agentos-marketplace', version: '0.1.0' }, { capabilities: { tools: {} } });
  const registered = new Set<string>();

  const refreshTools = async () => {
    const rows = await db.select().from(tools).where(eq(tools.status, 'active'));
    for (const tool of rows) {
      const provider = await db.query.toolProviders.findFirst({ where: eq(toolProviders.id, tool.providerId) });
      if (!provider || provider.status !== 'active') continue;
      const name = sanitizeName(tool.name);
      if (registered.has(name)) continue;
      const inputSchema = (tool.inputSchema as Record<string, unknown>) ?? {};
      const extraProps = Object.fromEntries(Object.entries(inputSchema).map(([key]) => [key, z.any()]));
      server.registerTool(
        name,
        {
          title: tool.name,
          description: `${tool.description ?? ''} Price ${tool.price} ${tool.priceToken}, category ${tool.category}. Provider: ${provider.name}. Supply agent_id of the paying AgentOS agent.`,
          inputSchema: z.object({
            agent_id: z.string().describe('AgentOS agent id that pays for and owns this call'),
            ...extraProps,
          }),
        },
        async (args: Record<string, unknown>) => {
          const agentId = String(args.agent_id);
          const { agent_id: _agentId, ...input } = args;
          const res = await fetch(`${marketplaceUrl}/v1/tools/${tool.id}/execute`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId, input }),
          });
          const body = (await res.json()) as { error?: { message?: string } };
          if (!res.ok) {
            return { content: [{ type: 'text', text: `ERROR: ${body?.error?.message ?? 'execution failed'}` }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(body) }] };
        },
      );
      registered.add(name);
    }
  };

  await refreshTools();
  setInterval(() => {
    refreshTools().catch((err) => console.error('[mcp] refresh failed', err));
  }, 30_000);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/v1/mcp', async (req, res) => {
    const sessionId = (req.headers['mcp-session-id'] as string) ?? randomUUID();
    let transport = transports.get(sessionId);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, onsessioninitialized: () => undefined });
      transports.set(sessionId, transport);
      await server.connect(transport);
    }
    try {
      await transport.handleRequest(req as never, res as never, req.body);
    } catch (err) {
      console.error('[mcp] request error', err);
      res.status(500).send({ error: 'internal error' });
    }
  });

  app.delete('/v1/mcp', async (req, res) => {
    const sessionId = (req.headers['mcp-session-id'] as string) ?? '';
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.close();
      transports.delete(sessionId);
      res.status(204).end();
    } else {
      res.status(404).end();
    }
  });

  app.get('/v1/mcp', (_req, res) => res.status(200).json({ ok: true, service: 'mcp', session_management: 'header' }));

  app.listen(MCP_PORT, () => {
    console.warn(`[marketplace] MCP server listening on http://localhost:${MCP_PORT}/v1/mcp`);
  });
}