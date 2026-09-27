import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, idempotencyOnSend, idempotencyPreHandler, type ServiceDeps } from '@agentos/server';
import { validateChallenge, type X402Challenge } from './x402.js';

const x402Schema = z.object({
  reservation_id: z.string().uuid(),
  provider_endpoint: z.string().url(),
  expected: z.object({
    amount: z.string().min(1),
    token: z.string(),
    chain: z.string(),
    payee_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export function buildPaymentsRoutes(app: FastifyInstance, { redis, config }: ServiceDeps): void {
  app.addHook('preHandler', idempotencyPreHandler(redis));
  app.addHook('onSend', idempotencyOnSend(redis));

  const treasuryUrl = config.TREASURY_URL;

  const release = async (reservationId: string) => {
    if (!treasuryUrl) return;
    try {
      await fetch(`${treasuryUrl}/v1/reservations/${reservationId}/release`, { method: 'POST' });
    } catch (err) {
      app.log.warn({ err }, 'release after failed x402 failed');
    }
  };

  // The x402 dance: request → 402 challenge → validate (payTo binding) → pay →
  // retry with payment proof → result.
  app.post('/v1/x402/execute', async (req) => {
    const body = x402Schema.parse(req.body);
    if (!treasuryUrl) throw new ApiError(503, 'UPSTREAM_UNCONFIGURED', 'treasury upstream not configured');

    // 1. Initial request — no payment.
    const first = await fetch(body.provider_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.payload),
    });

    if (first.ok) {
      const result = await first.json();
      await release(body.reservation_id);
      return { result, tx_hash: null };
    }

    if (first.status !== 402) {
      await release(body.reservation_id);
      throw new ApiError(502, 'PROVIDER_ERROR', `provider returned ${first.status}`);
    }

    // 2. Parse + validate the challenge. Abort BEFORE any signature on mismatch.
    const raw = (await first.json().catch(() => ({}))) as { challenge?: X402Challenge } & Record<string, unknown>;
    const challenge: X402Challenge | undefined = raw.challenge ?? (raw as unknown as X402Challenge);
    const errors = validateChallenge(challenge, body.expected);
    if (errors.length > 0) {
      await release(body.reservation_id);
      throw new ApiError(403, 'X402_CHALLENGE_MISMATCH', errors.join('; '));
    }

    // 3. Settle: treasury signs + broadcasts the real transfer to the REGISTERED payee.
    const commit = await fetch(`${treasuryUrl}/v1/reservations/${body.reservation_id}/commit`, { method: 'POST' });
    const commitBody = (await commit.json()) as { tx_hash?: string; error?: { message?: string } };
    if (!commit.ok || !commitBody.tx_hash) {
      await release(body.reservation_id);
      throw new ApiError(502, 'SETTLEMENT_FAILED', commitBody?.error?.message ?? 'settlement failed');
    }

    // 4. Retry with the payment proof.
    const retry = await fetch(body.provider_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment': commitBody.tx_hash },
      body: JSON.stringify(body.payload),
    });
    if (!retry.ok) {
      throw new ApiError(502, 'PROVIDER_REFUSED_PAYMENT', `provider rejected payment proof (${retry.status})`);
    }

    const result = await retry.json();
    return { result, tx_hash: commitBody.tx_hash };
  });
}