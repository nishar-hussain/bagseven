/**
 * CORDON MCP — the controlled communication layer between an AI agent and the
 * Bagseven (Cordon) authorization system.
 *
 * Instead of giving an agent a wallet or unrestricted payment ability, the agent
 * talks to Cordon through MCP tools. Cordon identifies the worker, loads its
 * mandate, evaluates the requested action against the mandate's policy (budget,
 * per-transaction limit, per-seller limit, lifetime, vault + hierarchy), and
 * ALLOWS (executes) or REJECTS it.
 *
 *   Agent → cordon_fetch / cordon_status / cordon_spawn → worker → mandate →
 *   policy evaluation → ALLOW (execute) | DENY (reject, logged as a refusal)
 *
 * The key principle: the agent can REQUEST an action, but the agent does not
 * decide whether it is permitted — the mandate does.
 *
 * Transport: stdio by default (spawned by the MCP client). Set CORdon_HTTP_PORT
 * (or MCP_HTTP_PORT) to serve streamable HTTP at http://localhost:<port>/v1/mcp.
 *
 * Run (stdio):  pnpm cordon-mcp
 * Run (HTTP):   CORDON_HTTP_PORT=4009 pnpm cordon-mcp
 *
 * It signs with the configured keys (OWNER_DEV_KEY / OPERATOR_DEV_KEY) and calls
 * the gateway (GATEWAY_URL, default http://localhost:4000).
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { canonicalSpawn, spendIntentDomain, spendIntentTypes } from '@agentos/onchain';

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

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

/** Resolve a worker (agent id or operator address) → the agent row. */
async function resolveWorker(worker: string): Promise<Record<string, unknown>> {
  const { status, body } = await api('GET', `/v1/resolve?ref=${encodeURIComponent(worker)}`);
  if (status !== 200) throw new Error((body as { error?: { message?: string } })?.error?.message ?? `worker not found: ${worker}`);
  return body as Record<string, unknown>;
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'cordon-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  // cordon_status — identify a worker, load its mandate, report what it may still spend.
  server.registerTool(
    'cordon_status',
    {
      title: 'Worker status',
      description:
        'Identify a worker (agent id or operator address), load its mandate, and return the remaining budget and limits. Reads the contract, never a copied figure.',
      inputSchema: { worker: z.string().describe('agent id (uuid) or operator address (0x…)') },
    },
    async ({ worker }) => {
      const r = await resolveWorker(worker);
      return text({
        worker: r.agent,
        mandate: r.mandate,
        remaining: r.remaining,
      });
    },
  );

  // cordon_fetch — a paid action requested by the worker; Cordon evaluates + allows/rejects.
  server.registerTool(
    'cordon_fetch',
    {
      title: 'Request a paid action',
      description:
        "Request a paid action for a worker. Cordon checks it against the mandate's budget per window, lifetime cap, per-transaction limit, per-seller limit, depth and vault balance. Within bounds it ALLOWS and executes on-chain; otherwise it REJECTS (logged as a refusal). The agent requests — Cordon decides.",
      inputSchema: {
        worker: z.string().describe('agent id (uuid) or operator address (0x…) making the request'),
        amount: z.string().describe('payment amount in USDC, e.g. "5"'),
        recipient: z.string().describe('0x payee (the seller/API)'),
        reason: z.string().optional().describe('what the agent is paying for (for the audit trail)'),
      },
    },
    async ({ worker, amount, recipient, reason }) => {
      if (!operator) throw new Error('OPERATOR_DEV_KEY not configured — Cordon cannot sign the worker');
      // Identify the worker → its agent id + operator.
      const resolved = await resolveWorker(worker);
      const agentId = (resolved.agent as { id: string }).id;

      const nonce = Math.floor(Date.now() / 1000);
      const signature = await operator.signTypedData({
        domain: spendIntentDomain(CHAIN_ID),
        types: spendIntentTypes,
        primaryType: 'SpendIntent',
        message: { agentId, amount, recipient: recipient as `0x${string}`, nonce: BigInt(nonce), timestamp: BigInt(nonce), chainId: BigInt(CHAIN_ID) },
      });
      const { body } = await api('POST', '/v1/spend-intents', { agent_id: agentId, amount, recipient, nonce, timestamp: nonce, chain_id: CHAIN_ID, signature });
      const d = body as { decision: string; bound?: string; tx_hash?: string; remaining_window?: string; remaining_lifetime?: string };

      if (d.decision === 'allow') {
        return text({ decision: 'ALLOW', executed: true, tx_hash: d.tx_hash, amount, recipient, remaining_window: d.remaining_window, remaining_lifetime: d.remaining_lifetime, reason: reason ?? null });
      }
      return text({ decision: 'DENY', executed: false, bound: d.bound, amount, recipient, reason: reason ?? null });
    },
  );

  // cordon_spawn — spawn a child worker under a mandate (narrower than the parent).
  server.registerTool(
    'cordon_spawn',
    {
      title: 'Spawn a child worker',
      description:
        'Spawn a child worker under a mandate tree. The child can only ever be narrower than its parent, and the contract refuses a wider one whoever asks.',
      inputSchema: {
        mandate_id: z.string().describe('the mandate to spawn under'),
        parent_agent_id: z.string().describe('parent worker (root_agent_id for a root child)'),
        operator_address: z.string().describe('the child worker\'s hot key (0x…)'),
        share_percent: z.number().describe('share of the parent, e.g. 50'),
      },
    },
    async ({ mandate_id, parent_agent_id, operator_address, share_percent }) => {
      if (!owner) throw new Error('OWNER_DEV_KEY not configured — Cordon cannot sign the spawn');
      const canonical = canonicalSpawn({ mandateId: mandate_id, parentAgentId: parent_agent_id, operator: operator_address.toLowerCase() as `0x${string}`, sharePercent: share_percent, chainId: CHAIN_ID });
      const signature = await owner.signMessage({ message: canonical });
      const { body } = await api('POST', `/v1/mandates/${mandate_id}/spawn-agent`, { parent_agent_id, operator_address, share_percent, chain_id: CHAIN_ID, signature });
      return text(body);
    },
  );

  return server;
}

async function main(): Promise<void> {
  const httpPort = process.env.CORDON_HTTP_PORT ?? process.env.MCP_HTTP_PORT;
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
    app.listen(Number(httpPort), () => console.error(`[cordon-mcp] HTTP listening on http://localhost:${httpPort}/v1/mcp`));
  } else {
    await buildServer().connect(new StdioServerTransport());
    console.error('[cordon-mcp] stdio server ready');
  }
}

main().catch((err) => {
  console.error('[cordon-mcp] fatal', err);
  process.exit(1);
});