import { createHash } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encodeBase64, parsePaymentResponse, type PaymentChallenge } from './protocol.js';

export function buildDemoProvider(config: NodeJS.ProcessEnv = process.env): { app: FastifyInstance; address: string; recipient: string } {
  const providerKey = config.DEMO_PROVIDER_KEY as `0x${string}` | undefined;
  if (!providerKey) throw new Error('DEMO_PROVIDER_KEY is required');
  const account = privateKeyToAccount(providerKey);
  const recipient = (config.DEMO_PROVIDER_RECIPIENT ?? account.address) as `0x${string}`;
  const providerHost = config.DEMO_PROVIDER_HOST ?? '127.0.0.1';
  const price = config.DEMO_PROVIDER_PRICE ?? '0.10';
  const chain = Number(config.CHAIN_ID ?? 31337);
  const token = config.USDC_ADDRESS ?? 'demo-usdc';
  const issued = new Map<string, PaymentChallenge>();
  const app = Fastify({ logger: { name: 'bagseven-demo-provider' } });
  app.get('/healthz', async () => ({ ok: true, service: 'bagseven-demo-provider', address: account.address }));
  app.get('/:resource', async (req, reply) => {
    const { resource } = z.object({ resource: z.enum(['weather', 'research', 'market-data']) }).parse(req.params);
    const challenge: PaymentChallenge = { provider: providerHost, amount: price, recipient, chain, token, nonce: createHash('sha256').update(`${resource}:${Date.now()}:${Math.random()}`).digest('hex'), expires_at: Math.floor(Date.now() / 1000) + 120 };
    const canonical = ['bagseven-payment-v1', challenge.provider, challenge.amount, challenge.recipient.toLowerCase(), challenge.chain, challenge.token.toLowerCase(), challenge.nonce, challenge.expires_at].join('|');
    challenge.signature = await account.signMessage({ message: canonical });
    const payment = req.headers['x-payment-response'] ?? req.headers['x-payment'];
    if (typeof payment !== 'string') {
      issued.set(challenge.nonce, challenge);
      reply.header('payment-required', encodeBase64(JSON.stringify(challenge)));
      return reply.code(402).send({ error: 'payment_required', payment: challenge });
    }
    const parsed = parsePaymentResponse(payment);
    const issuedChallenge = parsed.nonce ? issued.get(parsed.nonce) : undefined;
    if (!issuedChallenge || issuedChallenge.expires_at < Math.floor(Date.now() / 1000) || parsed.amount !== issuedChallenge.amount || parsed.recipient?.toLowerCase() !== issuedChallenge.recipient.toLowerCase()) return reply.code(402).send({ error: 'invalid_payment', message: 'payment proof does not match the challenge' });
    issued.delete(issuedChallenge.nonce);
    return { resource, data: `Demo ${resource} data`, paid: true, tx_hash: parsed.tx_hash };
  });
  return { app, address: account.address, recipient };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.DEMO_PROVIDER_PORT ?? 4007);
  const provider = buildDemoProvider();
  await provider.app.listen({ port, host: '0.0.0.0' });
  provider.app.log.info({ address: provider.address, recipient: provider.recipient, port }, 'demo provider listening');
}
