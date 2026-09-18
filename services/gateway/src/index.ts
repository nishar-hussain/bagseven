import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createDb, agents } from '@agentos/db';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ApiError, envelopeAuth, rateLimit, createService } from '@agentos/server';
import cors from '@fastify/cors';

interface Upstream {
  baseUrl: string;
}

function upstreamFor(path: string, cfg: NodeJS.ProcessEnv): Upstream {
  const u = (env: string) => ({ baseUrl: cfg[env] ?? '' });
  if (path.startsWith('/v1/agents') && path.includes('/receipts')) return u('VERIFICATION_URL');
  if (path.startsWith('/v1/agents') || path.startsWith('/v1/organizations') || path.startsWith('/v1/guardians')) return u('IDENTITY_URL');
  if (path.startsWith('/v1/policies') || path.startsWith('/v1/spend-intents') || path.startsWith('/v1/policy-checks')) return u('POLICY_URL');
  if (path.startsWith('/v1/wallets') || path.startsWith('/v1/reservations')) return u('TREASURY_URL');
  if (path.startsWith('/v1/receipts')) return u('VERIFICATION_URL');
  throw new ApiError(404, 'NOT_FOUND', `no upstream for ${path}`);
}

async function proxy(req: FastifyRequest, reply: FastifyReply, cfg: NodeJS.ProcessEnv): Promise<unknown> {
  const upstream = upstreamFor(req.url.split('?')[0]!, cfg);
  if (!upstream.baseUrl) throw new ApiError(503, 'UPSTREAM_UNCONFIGURED', `no upstream configured for ${req.url}`);

  const body = req.body === undefined ? undefined : JSON.stringify(req.body);
  const headers: Record<string, string> = {
    'x-trace-id': (req.headers['x-trace-id'] as string) ?? randomUUID(),
  };
  if (typeof req.headers['content-type'] === 'string') headers['content-type'] = req.headers['content-type'];
  if (typeof req.headers['idempotency-key'] === 'string') {
    // Scope idempotency keys per agent so two agents never collide on the same key.
    const agentId = (req as FastifyRequest & { agent?: { id: string } }).agent?.id;
    headers['idempotency-key'] = agentId ? `${agentId}:${req.headers['idempotency-key']}` : req.headers['idempotency-key'];
  }
  if (typeof req.headers['x-guardian-token'] === 'string') headers['x-guardian-token'] = req.headers['x-guardian-token'];

  const res = await fetch(`${upstream.baseUrl}${req.url}`, {
    method: req.method,
    headers,
    body,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : undefined;
  reply.code(res.status);
  return payload;
}

const BOOTSTRAP_PREFIXES = ['/healthz', '/v1/organizations', '/v1/guardians', '/v1/agents'];

export function buildGatewayRoutes(app: FastifyInstance, { db, redis, config }: { db: ReturnType<typeof createDb>; redis: Redis; config: NodeJS.ProcessEnv }): void {
  void app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : (config.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.addHook('preHandler', rateLimit(redis, { limit: Number(config.RATE_LIMIT_PER_AGENT ?? 50), windowSeconds: 1 }));

  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    const isBootstrap = BOOTSTRAP_PREFIXES.some((p) => path.startsWith(p));
    if (isBootstrap) return;
    await envelopeAuth({
      getPublicKey: async (agentId) => {
        const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
        if (!agent) return undefined;
        if (agent.status !== 'active') return undefined;
        return agent.publicKeyPem;
      },
    })(req, reply);
  });

  app.all('/v1/*', async (req, reply) => proxy(req, reply, config));
}

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  await createService({
    name: 'gateway',
    port: Number(process.env.GATEWAY_PORT ?? 4000),
    db,
    redis,
    buildRoutes: (app, deps) => buildGatewayRoutes(app, { db, redis, config: deps.config }),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}