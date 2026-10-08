import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';

export interface ResearchResource {
  id: string;
  title: string;
  provider: string;
  category: string;
  price: string;
  free: boolean;
  summary: string;
}

const resources: ResearchResource[] = [
  { id: 'ev-battery-overview', title: 'EV battery market overview', provider: 'market-data', category: 'electric vehicles', price: '0.00', free: true, summary: 'A public overview of battery chemistry, production capacity, and regional demand.' },
  { id: 'ev-battery-pricing', title: 'EV battery pricing dataset', provider: 'market-data', category: 'electric vehicles', price: '0.10', free: false, summary: 'Quarterly battery pack pricing and the leading cost drivers across major regions.' },
  { id: 'ev-premium-outlook', title: 'Premium EV outlook report', provider: 'research', category: 'electric vehicles', price: '5.00', free: false, summary: 'A premium forecast covering demand, supply-chain risk, and five-year adoption scenarios.' },
];

function loadAccount(config: NodeJS.ProcessEnv) {
  const key = config.RESEARCH_PROVIDER_KEY ?? config.OPERATOR_DEV_KEY;
  if (!key) throw new Error('RESEARCH_PROVIDER_KEY or OPERATOR_DEV_KEY is required');
  return privateKeyToAccount(key as `0x${string}`);
}

export function buildResearchProvider(config: NodeJS.ProcessEnv = process.env): { app: FastifyInstance; address: string } {
  const account = loadAccount(config);
  const host = config.RESEARCH_PROVIDER_HOST ?? '127.0.0.1';
  const chain = Number(config.CHAIN_ID ?? 31337);
  const token = config.USDC_ADDRESS ?? 'demo-usdc';
  const issued = new Map<string, ResearchResource>();
  const app = Fastify({ logger: { name: 'bagseven-research-provider' } });

  app.get('/healthz', async () => ({ ok: true, service: 'bagseven-research-provider', address: account.address }));
  app.get('/v1/providers', async () => ({ providers: [{ id: 'market-data', name: 'Market Data Provider', categories: ['electric vehicles'], resources: resources.filter((resource) => resource.provider === 'market-data') }, { id: 'research', name: 'Research Report Provider', categories: ['electric vehicles'], resources: resources.filter((resource) => resource.provider === 'research') }] }));
  app.get('/v1/resources/:id', async (request, reply) => {
    const resource = resources.find((item) => item.id === (request.params as { id: string }).id);
    if (!resource) return reply.code(404).send({ error: 'resource_not_found' });
    if (resource.free) return { resource, paid: false };

    const nonce = createHash('sha256').update(`${resource.id}:${Date.now()}:${Math.random()}`).digest('hex');
    const challenge = { provider: request.hostname || host, amount: resource.price, recipient: account.address, chain, token, nonce, expires_at: Math.floor(Date.now() / 1000) + 120 };
    const canonical = ['bagseven-payment-v1', challenge.provider, challenge.amount, challenge.recipient.toLowerCase(), challenge.chain, challenge.token.toLowerCase(), challenge.nonce, challenge.expires_at].join('|');
    const signature = await account.signMessage({ message: canonical });
    issued.set(nonce, resource);
    const payment = request.headers['x-payment-response'] ?? request.headers['x-payment'];
    if (typeof payment !== 'string') {
      reply.header('payment-required', Buffer.from(JSON.stringify({ ...challenge, signature })).toString('base64'));
      return reply.code(402).send({ error: 'payment_required', payment: { ...challenge, signature } });
    }
    let parsed: { amount?: string; recipient?: string; nonce?: string; tx_hash?: string };
    try { parsed = JSON.parse(payment) as typeof parsed; } catch { return reply.code(402).send({ error: 'invalid_payment' }); }
    const issuedResource = parsed.nonce ? issued.get(parsed.nonce) : undefined;
    if (!parsed.nonce || !issuedResource || parsed.amount !== issuedResource.price || parsed.recipient?.toLowerCase() !== account.address.toLowerCase()) return reply.code(402).send({ error: 'invalid_payment', message: 'payment proof does not match the challenge' });
    issued.delete(parsed.nonce);
    return { resource: issuedResource, paid: true, tx_hash: parsed.tx_hash ?? null };
  });
  return { app, address: account.address };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.RESEARCH_PROVIDER_PORT ?? 4010);
  const provider = buildResearchProvider();
  provider.app.listen({ port, host: '0.0.0.0' }).then(() => provider.app.log.info({ port, address: provider.address }, 'research provider listening')).catch((error) => { console.error(error); process.exit(1); });
}
