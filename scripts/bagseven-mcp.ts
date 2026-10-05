/**
 * Bagseven MCP server — gives any MCP client (Claude, Cursor, an agent runtime)
 * the platform's capabilities as tools: read the mandate/agents/refusals/resolve,
 * create + sign a mandate, spawn child agents, and spend (EIP-712).
 *
 * Transport: stdio by default (spawned by the MCP client). Set MCP_HTTP_PORT to
 * also serve streamable HTTP at http://localhost:<port>/v1/mcp.
 *
 * Run (stdio):  pnpm mcp
 * Run (HTTP):   MCP_HTTP_PORT=4009 pnpm mcp
 *
 * It signs with the configured dev keys (OWNER_DEV_KEY / OPERATOR_DEV_KEY) and
 * calls the gateway (GATEWAY_URL, default http://localhost:4000).
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { canonicalMandate, canonicalSpawn, spendIntentDomain, spendIntentTypes } from '@agentos/onchain';

// tsx does not load .env — read it ourselves.
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && process.env[line.slice(0, i)] === undefined) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch { /* .env optional */ }

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4000';
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111);

const ownerKey = process.env.OWNER_DEV_KEY as `0x${string}` | undefined;
const operatorKey = process.env.OPERATOR_DEV_KEY as `0x${string}` | undefined;
const owner: PrivateKeyAccount | null = ownerKey ? privateKeyToAccount(ownerKey) : null;
const operator: PrivateKeyAccount | null = operatorKey ? privateKeyToAccount(operatorKey) : null;

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textBody = await res.text();
  const json = textBody ? JSON.parse(textBody) : undefined;
  if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  return json;
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

function buildServer(): McpServer {
  const server = new McpServer({ name: 'bagseven', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.registerTool(
    'bagseven_overview',
    { title: 'Mandate overview', description: 'Spent this window/total, can-be-drawn, agents, recent refusals, terms.', inputSchema: { mandate_id: z.string() } },
    async ({ mandate_id }) => text(await api('GET', `/v1/mandates/${mandate_id}/overview`)),
  );

  server.registerTool(
    'bagseven_agents',
    { title: 'List agents', description: 'Every agent in the mandate tree with node id, operator, share, depth.', inputSchema: { mandate_id: z.string() } },
    async ({ mandate_id }) => {
      const o = (await api('GET', `/v1/mandates/${mandate_id}/overview`)) as { agents?: unknown };
      return text(o.agents ?? []);
    },
  );

  server.registerTool(
    'bagseven_resolve',
    { title: 'Resolve an agent', description: 'Look up an agent by id or operator address → mandate + remaining spend.', inputSchema: { ref: z.string() } },
    async ({ ref }) => text(await api('GET', `/v1/resolve?ref=${encodeURIComponent(ref)}`)),
  );

  server.registerTool(
    'bagseven_refusals',
    { title: 'List refusals', description: 'Refused purchase attempts (all/standing/released).', inputSchema: { agent_id: z.string().optional(), scope: z.enum(['all', 'standing', 'released']).optional() } },
    async ({ agent_id, scope }) => {
      const q = new URLSearchParams();
      if (agent_id) q.set('agent_id', agent_id);
      if (scope) q.set('scope', scope);
      return text(await api('GET', `/v1/refusals${q.size ? `?${q.toString()}` : ''}`));
    },
  );

  server.registerTool(
    'bagseven_create_mandate',
    {
      title: 'Create a mandate (owner-signed)',
      description: 'Sign and deploy a BagMandate on-chain. Returns mandate_id + root_agent_id + contract_address.',
      inputSchema: {
        budget_per_window: z.string().describe('e.g. "20"'),
        window_seconds: z.number().describe('e.g. 86400'),
        lifetime_cap: z.string().describe('e.g. "100"'),
        per_purchase_cap: z.string().describe('e.g. "1"'),
        per_seller_pct: z.number().describe('basis points, e.g. 3500 = 35%'),
        max_depth: z.number().describe('e.g. 3'),
        operator_address: z.string().optional().describe('agent hot key; defaults to OPERATOR_DEV_KEY'),
      },
    },
    async ({ budget_per_window, window_seconds, lifetime_cap, per_purchase_cap, per_seller_pct, max_depth, operator_address }) => {
      if (!owner) throw new Error('OWNER_DEV_KEY not configured');
      const opAddr = (operator_address ?? operator?.address) as string | undefined;
      if (!opAddr) throw new Error('no operator address (pass operator_address or set OPERATOR_DEV_KEY)');
      const canonical = canonicalMandate({ owner: owner.address.toLowerCase() as `0x${string}`, operator: opAddr.toLowerCase() as `0x${string}`, budgetPerWindow: budget_per_window, windowSeconds: window_seconds, lifetimeCap: lifetime_cap, perPurchaseCap: per_purchase_cap, perSellerPct: per_seller_pct, maxDepth: max_depth, chainId: CHAIN_ID });
      const signature = await owner.signMessage({ message: canonical });
      return text(await api('POST', '/v1/mandates', { owner_address: owner.address, operator_address: opAddr, budget_per_window, window_seconds, lifetime_cap, per_purchase_cap, per_seller_pct, max_depth, chain_id: CHAIN_ID, signature }));
    },
  );

  server.registerTool(
    'bagseven_spawn_agent',
    {
      title: 'Spawn a child agent (owner-signed)',
      description: 'Create a child under a parent. Child ≤ parent (share ≤ 100), depth ≤ max depth.',
      inputSchema: { mandate_id: z.string(), parent_agent_id: z.string(), operator_address: z.string(), share_percent: z.number().describe('e.g. 50') },
    },
    async ({ mandate_id, parent_agent_id, operator_address, share_percent }) => {
      if (!owner) throw new Error('OWNER_DEV_KEY not configured');
      const canonical = canonicalSpawn({ mandateId: mandate_id, parentAgentId: parent_agent_id, operator: operator_address.toLowerCase() as `0x${string}`, sharePercent: share_percent, chainId: CHAIN_ID });
      const signature = await owner.signMessage({ message: canonical });
      return text(await api('POST', `/v1/mandates/${mandate_id}/spawn-agent`, { parent_agent_id, operator_address, share_percent, chain_id: CHAIN_ID, signature }));
    },
  );

  server.registerTool(
    'bagseven_spend',
    {
      title: 'Spend (operator-signed, contract-enforced)',
      description: 'Submit an EIP-712 spend intent for an agent. The contract allows it or refuses it (named bound).',
      inputSchema: { agent_id: z.string(), amount: z.string().describe('USDC, e.g. "0.50"'), recipient: z.string().describe('0x payee') },
    },
    async ({ agent_id, amount, recipient }) => {
      if (!operator) throw new Error('OPERATOR_DEV_KEY not configured');
      const nonce = Math.floor(Date.now() / 1000);
      const signature = await operator.signTypedData({
        domain: spendIntentDomain(CHAIN_ID),
        types: spendIntentTypes,
        primaryType: 'SpendIntent',
        message: { agentId: agent_id, amount, recipient: recipient as `0x${string}`, nonce: BigInt(nonce), timestamp: BigInt(nonce), chainId: BigInt(CHAIN_ID) },
      });
      return text(await api('POST', '/v1/spend-intents', { agent_id, amount, recipient, nonce, timestamp: nonce, chain_id: CHAIN_ID, signature }));
    },
  );

  return server;
}

async function main(): Promise<void> {
  const httpPort = process.env.MCP_HTTP_PORT;
  if (httpPort) {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
    app.post('/v1/mcp', async (req, res) => {
      const sessionId = (req.headers['mcp-session-id'] as string) ?? crypto.randomUUID();
      let transport = transports.get(sessionId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, onsessioninitialized: () => undefined });
        transports.set(sessionId, transport);
        await buildServer().connect(transport); // fresh server per session
      }
      await transport.handleRequest(req, res, req.body);
    });
    app.listen(Number(httpPort), () => console.error(`[bagseven-mcp] HTTP listening on http://localhost:${httpPort}/v1/mcp`));
  } else {
    await buildServer().connect(new StdioServerTransport());
    console.error('[bagseven-mcp] stdio server ready');
  }
}

main().catch((err) => {
  console.error('[bagseven-mcp] fatal', err);
  process.exit(1);
});