import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { spendIntentDomain, spendIntentTypes, canonicalSpawn } from '@bagseven/onchain';
import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { ApiError, createService, type ServiceDeps } from '@bagseven/server';
import type { FastifyInstance } from 'fastify';

const fetchSchema = z.object({
  worker: z.string().min(1),
  url: z.string().url().optional(),
  amount: z.string().min(1).optional(),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  reason: z.string().max(500).optional(),
}).superRefine((value, ctx) => {
  if (!value.url && (!value.amount || !value.recipient)) {
    ctx.addIssue({ code: 'custom', message: 'provide url or both amount and recipient', path: ['url'] });
  }
  if (value.amount && !value.recipient) ctx.addIssue({ code: 'custom', message: 'recipient is required with amount', path: ['recipient'] });
  if (value.recipient && !value.amount) ctx.addIssue({ code: 'custom', message: 'amount is required with recipient', path: ['amount'] });
});

const paymentChallengeSchema = z.object({
  amount: z.string().min(1),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  chain: z.union([z.string(), z.number()]).optional(),
  token: z.string().optional(),
  nonce: z.string().optional(),
});

const spawnSchema = z.object({
  mandate_id: z.string().uuid(),
  parent_agent_id: z.string().uuid(),
  operator_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  share_percent: z.number().int().min(1).max(100),
});

interface WorkerRecord {
  id: string;
  operator_address: string;
  status: string;
}

interface ResolvedWorker {
  agent: WorkerRecord;
  mandate: { id: string; owner_address: string; operator_address: string; status: string };
}

interface SpendResult {
  decision: 'allow' | 'refused';
  tx_hash?: string;
  reservation_id?: string;
  bound?: string;
  reason?: string;
  remaining_window?: string;
  remaining_lifetime?: string;
}

function accountFromEnv(config: NodeJS.ProcessEnv): PrivateKeyAccount {
  const key = config.DAEMON_OPERATOR_KEY ?? config.OPERATOR_DEV_KEY;
  if (!key) throw new ApiError(503, 'DAEMON_OPERATOR_UNCONFIGURED', 'DAEMON_OPERATOR_KEY is not configured');
  return privateKeyToAccount(key as `0x${string}`);
}

function ownerFromEnv(config: NodeJS.ProcessEnv): PrivateKeyAccount {
  const key = config.DAEMON_OWNER_KEY ?? config.OWNER_DEV_KEY;
  if (!key) throw new ApiError(503, 'DAEMON_OWNER_UNCONFIGURED', 'DAEMON_OWNER_KEY is not configured');
  return privateKeyToAccount(key as `0x${string}`);
}

async function daemonApi(config: NodeJS.ProcessEnv, method: string, path: string, body?: unknown): Promise<unknown> {
  const base = config.POLICY_URL ?? 'http://localhost:4003';
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(response.status, error?.code ?? 'POLICY_REQUEST_FAILED', error?.message ?? response.statusText);
  }
  return payload;
}

async function resolveWorker(config: NodeJS.ProcessEnv, worker: string): Promise<ResolvedWorker> {
  return daemonApi(config, 'GET', `/v1/resolve?ref=${encodeURIComponent(worker)}`) as Promise<ResolvedWorker>;
}

function validateProviderUrl(config: NodeJS.ProcessEnv, rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new ApiError(400, 'PROVIDER_URL_UNSUPPORTED', 'provider URL must use HTTP or HTTPS');
  const allowlist = (config.BAGSEVEN_ALLOWED_PROVIDER_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (config.BAGSEVEN_REQUIRE_PROVIDER_ALLOWLIST === 'true' && !allowlist.includes(url.hostname)) {
    throw new ApiError(403, 'PROVIDER_NOT_ALLOWED', 'provider host is not registered with Bagseven');
  }
  if (allowlist.length > 0 && !allowlist.includes(url.hostname)) throw new ApiError(403, 'PROVIDER_NOT_ALLOWED', 'provider host is not registered with Bagseven');
  return url;
}

async function executeSpend(config: NodeJS.ProcessEnv, resolved: ResolvedWorker, amount: string, recipient: string, reason?: string): Promise<SpendResult> {
  const signer = accountFromEnv(config);
  if (signer.address.toLowerCase() !== resolved.agent.operator_address.toLowerCase()) {
    throw new ApiError(403, 'DAEMON_OPERATOR_MISMATCH', 'daemon signer is not the worker operator');
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = Number(`${now}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`);
  const chainId = Number(config.CHAIN_ID ?? 11155111);
  const signature = await signer.signTypedData({
    domain: spendIntentDomain(chainId),
    types: spendIntentTypes,
    primaryType: 'SpendIntent',
    message: { agentId: resolved.agent.id, amount, recipient: recipient as `0x${string}`, nonce: BigInt(nonce), timestamp: BigInt(now), chainId: BigInt(chainId) },
  });
  return daemonApi(config, 'POST', '/v1/spend-intents', {
    agent_id: resolved.agent.id,
    amount,
    recipient,
    nonce,
    timestamp: now,
    chain_id: chainId,
    signature,
    reason,
    request_id: randomUUID(),
  }) as Promise<SpendResult>;
}

function buildRoutes(app: FastifyInstance, { config }: ServiceDeps): void {
  app.addHook('preHandler', async (req, reply) => {
    const token = config.DAEMON_AUTH_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'daemon authentication required' } });
    }
  });
  app.post('/internal/workers/:worker/status', async (req) => {
    const { worker } = req.params as { worker: string };
    return resolveWorker(config, worker);
  });

  app.post('/internal/workers/:worker/fetch', async (req) => {
    const { worker } = req.params as { worker: string };
    const body = fetchSchema.parse({ ...(req.body as object), worker });
    const resolved = await resolveWorker(config, worker);
    if (resolved.agent.status !== 'active' || resolved.mandate.status !== 'active') {
      throw new ApiError(403, 'WORKER_INACTIVE', 'worker or mandate is not active');
    }

    let amount = body.amount;
    let recipient = body.recipient;
    let provider: { status: number; body: unknown } | undefined;
    let challenge: z.infer<typeof paymentChallengeSchema> | undefined;

    if (body.url) {
      const providerUrl = validateProviderUrl(config, body.url);
      const initial = await fetch(providerUrl);
      if (initial.status !== 402) {
        return { decision: 'NO_PAYMENT_REQUIRED', executed: false, provider: { status: initial.status, body: (await initial.text()).slice(0, 10000) } };
      }
      const challengeHeader = initial.headers.get('payment-required');
      const challengeBody = await initial.text();
      let parsed: unknown;
      if (challengeHeader) {
        let decoded = challengeHeader;
        try { decoded = Buffer.from(challengeHeader, 'base64').toString('utf8'); } catch { /* use the raw JSON header */ }
        try { parsed = JSON.parse(decoded); } catch { throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'provider returned an unreadable payment challenge'); }
      } else {
        try { parsed = JSON.parse(challengeBody); } catch { throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'provider returned an unreadable payment challenge'); }
      }
      challenge = paymentChallengeSchema.parse(parsed);
      amount = challenge.amount;
      recipient = challenge.payTo ?? challenge.recipient;
      if (!recipient) throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'payment challenge has no recipient');
    }

    if (!amount || !recipient) throw new ApiError(400, 'PAYMENT_INPUT_REQUIRED', 'amount and recipient are required');
    const result = await executeSpend(config, resolved, amount, recipient, body.reason);
    if (body.url && result.decision === 'allow') {
      const providerUrl = validateProviderUrl(config, body.url);
      const payment = JSON.stringify({ tx_hash: result.tx_hash, amount, recipient, chain_id: Number(config.CHAIN_ID ?? 11155111), nonce: challenge?.nonce ?? null });
      const retry = await fetch(providerUrl, { headers: { 'x-payment': payment, 'x-payment-response': payment } });
      provider = { status: retry.status, body: (await retry.text()).slice(0, 10000) };
    }
    return { ...result, worker: resolved.agent, mandate: resolved.mandate, provider };
  });

  app.post('/internal/workers/:worker/spawn', async (req) => {
    const body = spawnSchema.parse(req.body);
    const resolved = await resolveWorker(config, body.parent_agent_id);
    const owner = ownerFromEnv(config);
    if (owner.address.toLowerCase() !== resolved.mandate.owner_address.toLowerCase()) {
      throw new ApiError(403, 'DAEMON_OWNER_MISMATCH', 'daemon owner signer is not authorized for this mandate');
    }
    const canonical = canonicalSpawn({
      mandateId: body.mandate_id,
      parentAgentId: body.parent_agent_id,
      operator: body.operator_address.toLowerCase() as `0x${string}`,
      sharePercent: body.share_percent,
      chainId: Number(config.CHAIN_ID ?? 11155111),
    });
    const signature = await owner.signMessage({ message: canonical });
    return daemonApi(config, 'POST', `/v1/mandates/${body.mandate_id}/spawn-agent`, { ...body, chain_id: Number(config.CHAIN_ID ?? 11155111), signature });
  });
}

async function main(): Promise<void> {
  const db = createDb({ connectionString: process.env.DATABASE_URL ?? 'postgres://bagseven:bagseven@localhost:5432/bagseven' });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await createService({
    name: 'bagseven-daemon',
    port: Number(process.env.DAEMON_PORT ?? 4001),
    db,
    redis,
    buildRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
