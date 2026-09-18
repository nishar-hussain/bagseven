import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyEnvelope, type Envelope } from '@agentos/auth';

export interface EnvelopeAuthOptions {
  getPublicKey: (agentId: string) => Promise<string | undefined>;
  maxSkewSeconds?: number;
}

export interface AuthenticatedRequest {
  agent: { id: string };
}

/**
 * Verifies the x-agent-envelope header on requests the gateway forwards.
 * An invalid/missing envelope is a hard reject (fail-closed).
 */
export function envelopeAuth({ getPublicKey, maxSkewSeconds = 120 }: EnvelopeAuthOptions) {
  return async function preHandler(req: FastifyRequest, reply: FastifyReply): Promise<void | FastifyReply> {
    const header = req.headers['x-agent-envelope'];
    if (typeof header !== 'string') {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'missing agent envelope' } });
    }

    let envelope: Envelope;
    try {
      envelope = JSON.parse(header) as Envelope;
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'malformed envelope' } });
    }

    const publicKeyPem = await getPublicKey(envelope.agent_id);
    if (!publicKeyPem) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'unknown agent' } });
    }

    const now = Date.now();
    const ts = Date.parse(envelope.timestamp);
    if (Number.isNaN(ts) || Math.abs(now - ts) > maxSkewSeconds * 1000) {
      return reply.code(401).send({ error: { code: 'STALE_ENVELOPE', message: 'envelope timestamp out of range' } });
    }

    if (!verifyEnvelope(envelope, publicKeyPem)) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'invalid envelope signature' } });
    }

    (req as FastifyRequest & { agent?: { id: string } }).agent = { id: envelope.agent_id };
  };
}