import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { spendIntentDomain, spendIntentTypes, canonicalSpawn, MandateClient } from '@bagseven/onchain';
import { createDb } from '@bagseven/db';
import { Redis } from 'ioredis';
import { ApiError, createService, type ServiceDeps } from '@bagseven/server';
import { recoverEip191 } from '@bagseven/onchain';
import type { FastifyInstance } from 'fastify';
import { parseUnits } from 'viem';

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
  provider: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  expires_at: z.number().int().positive(),
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
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(config.POLICY_INTERNAL_TOKEN ? { authorization: `Bearer ${config.POLICY_INTERNAL_TOKEN}` } : {}) },
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

function providerRegistry(config: NodeJS.ProcessEnv): Record<string, string> {
  try { return JSON.parse(config.BAGSEVEN_PROVIDER_KEYS ?? '{}') as Record<string, string>; }
  catch { throw new ApiError(503, 'PROVIDER_REGISTRY_INVALID', 'BAGSEVEN_PROVIDER_KEYS must be valid JSON'); }
}

async function registeredProviderAddress(config: NodeJS.ProcessEnv, hostname: string): Promise<string> {
  const configured = providerRegistry(config)[hostname];
  if (configured) return configured.toLowerCase();
  const registered = await daemonApi(config, 'GET', `/v1/providers/${encodeURIComponent(hostname)}`).catch(() => undefined) as { address?: string } | undefined;
  if (!registered?.address) throw new ApiError(403, 'PROVIDER_NOT_REGISTERED', 'provider is not registered with Bagseven');
  return registered.address.toLowerCase();
}

async function verifyChallenge(config: NodeJS.ProcessEnv, url: URL, challenge: z.infer<typeof paymentChallengeSchema>): Promise<void> {
  if (challenge.provider !== url.hostname) throw new ApiError(502, 'PAYMENT_PROVIDER_MISMATCH', 'payment challenge provider does not match the requested host');
  const recipient = challenge.payTo ?? challenge.recipient;
  if (!recipient) throw new ApiError(502, 'INVALID_PAYMENT_CHALLENGE', 'payment challenge has no recipient');
  if (challenge.expires_at < Math.floor(Date.now() / 1000)) throw new ApiError(502, 'PAYMENT_CHALLENGE_EXPIRED', 'provider payment challenge has expired');
  const expectedChain = Number(config.CHAIN_ID ?? 11155111);
  if (challenge.chain !== undefined && Number(challenge.chain) !== expectedChain) throw new ApiError(502, 'PAYMENT_CHAIN_MISMATCH', 'provider challenge chain does not match Bagseven');
  const token = config.USDC_ADDRESS?.toLowerCase();
  if (token && challenge.token && challenge.token.toLowerCase() !== token) throw new ApiError(502, 'PAYMENT_TOKEN_MISMATCH', 'provider challenge token does not match Bagseven');
  const providerAddress = await registeredProviderAddress(config, url.hostname);
  const canonical = ['bagseven-payment-v1', url.hostname, challenge.amount, recipient.toLowerCase(), challenge.chain ?? expectedChain, challenge.token?.toLowerCase() ?? token ?? '', challenge.nonce ?? '', challenge.expires_at].join('|');
  const signer = await recoverEip191(canonical, challenge.signature as `0x${string}`).catch(() => '');
  if (signer.toLowerCase() !== providerAddress) throw new ApiError(502, 'PAYMENT_CHALLENGE_SIGNATURE_INVALID', 'provider payment challenge signature is invalid');
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
  const result = await daemonApi(config, 'POST', '/v1/spend-intents', {
    agent_id: resolved.agent.id,
    amount,
    recipient,
    nonce,
    timestamp: now,
    chain_id: chainId,
    signature,
    reason,
    request_id: randomUUID(),
  }) as SpendResult & { authorization?: { contract_address: string; worker_id: `0x${string}`; amount: string; recipient: `0x${string}` } };
  if (result.decision !== 'allow' || !config.DAEMON_EXECUTOR_KEY || !result.reservation_id || !result.authorization) return result;
  const executor = new MandateClient(config.DAEMON_EXECUTOR_KEY as `0x${string}`, { rpcUrl: config.RPC_URL ?? 'http://localhost:8545', chainId });
  try {
    if (executor.address.toLowerCase() !== (config.DAEMON_EXECUTOR_ADDRESS ?? executor.address).toLowerCase()) throw new ApiError(403, 'DAEMON_EXECUTOR_MISMATCH', 'daemon executor does not match the configured contract enforcer');
    const txHash = await executor.execute(result.authorization.contract_address as `0x${string}`, parseUnits(amount, 6), result.authorization.recipient, result.authorization.worker_id);
    await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/settle`, { tx_hash: txHash, recipient });
    return { ...result, tx_hash: txHash };
  } catch (error) {
    await daemonApi(config, 'POST', `/v1/reservations/${result.reservation_id}/release`, {}).catch(() => undefined);
    throw new ApiError(502, 'PAYMENT_EXECUTION_FAILED', (error as Error).message);
  }
}

function buildRoutes(app: FastifyInstance, { config, redis }: ServiceDeps): void {
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
      await verifyChallenge(config, providerUrl, challenge);
      const challengeKey = `bagseven:payment-challenge:${providerUrl.hostname}:${challenge.nonce ?? challenge.signature}`;
      const fresh = await redis.set(challengeKey, '1', 'EX', Math.max(1, challenge.expires_at - Math.floor(Date.now() / 1000)), 'NX');
      if (fresh !== 'OK') throw new ApiError(409, 'PAYMENT_CHALLENGE_REPLAYED', 'provider payment challenge has already been used');
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
