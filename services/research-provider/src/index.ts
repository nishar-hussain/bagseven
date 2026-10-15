import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';

export interface ResearchResource { id: string; title: string; provider: string; category: string; price: string; free: boolean; summary: string; source_url?: string }
interface LiveResource { title: string; price: string; snippet: string }

function loadAccount(config: NodeJS.ProcessEnv) {
  const key = config.RESEARCH_PROVIDER_KEY ?? config.OPERATOR_DEV_KEY;
  if (!key) throw new Error('RESEARCH_PROVIDER_KEY or OPERATOR_DEV_KEY is required');
  return privateKeyToAccount(key as `0x${string}`);
}

function resourceId(resource: LiveResource): string { return `live-${createHash('sha256').update(JSON.stringify(resource)).digest('hex').slice(0, 24)}`; }

async function wikipediaSearch(query: string): Promise<LiveResource[]> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '5', format: 'json', origin: '*' }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`live research search failed (${response.status})`);
  const payload = await response.json() as { query?: { search?: Array<{ title: string; snippet: string }> } };
  const premium = /premium|expensive|full report|forecast/i.test(query);
  return (payload.query?.search ?? []).map((item) => ({ title: item.title, price: premium ? '5.00' : '0.10', snippet: item.snippet.replace(/<[^>]+>/g, '') }));
}

async function wikipediaArticle(title: string): Promise<{ extract: string; url: string }> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`live research article failed (${response.status})`);
  const payload = await response.json() as { extract?: string; content_urls?: { desktop?: { page?: string } } };
  return { extract: payload.extract ?? 'The live source returned no summary.', url: payload.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
}

export function buildResearchProvider(config: NodeJS.ProcessEnv = process.env): { app: FastifyInstance; address: string } {
  const account = loadAccount(config);
  const host = config.RESEARCH_PROVIDER_HOST ?? '127.0.0.1';
  const chain = Number(config.CHAIN_ID ?? 43113);
  const token = config.USDC_ADDRESS ?? 'demo-usdc';
  const issued = new Map<string, LiveResource>();
  const available = new Map<string, LiveResource>();
  const app = Fastify({ logger: { name: 'bagseven-live-research-provider' } });

  app.get('/healthz', async () => ({ ok: true, service: 'bagseven-live-research-provider', source: 'Wikipedia REST API', address: account.address }));
  app.get('/v1/providers', async (request, reply) => {
    const query = ((request.query as { query?: string }).query ?? 'technology market research').trim();
    try {
      const live = await wikipediaSearch(query);
      const resources: ResearchResource[] = live.map((item) => { const id = resourceId(item); available.set(id, item); return { id, title: item.title, provider: 'wikipedia-live', category: 'live research', price: item.price, free: false, summary: item.snippet, source_url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}` }; });
      return { providers: [{ id: 'wikipedia-live', name: 'Live Wikipedia Research Provider', categories: ['live research'], resources }] };
    } catch (error) { return reply.code(502).send({ error: 'live_provider_unavailable', message: (error as Error).message }); }
  });
  app.get('/v1/resources/:id', async (request, reply) => {
    const resource = available.get((request.params as { id: string }).id);
    if (!resource) return reply.code(404).send({ error: 'resource_not_found' });
    const nonce = createHash('sha256').update(`${resource.title}:${Date.now()}:${Math.random()}`).digest('hex');
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
    if (!parsed.nonce || !issuedResource || parsed.amount !== issuedResource.price || parsed.recipient?.toLowerCase() !== account.address.toLowerCase()) return reply.code(402).send({ error: 'invalid_payment', message: 'payment proof does not match the live research challenge' });
    const article = await wikipediaArticle(issuedResource.title);
    issued.delete(parsed.nonce);
    return { resource: { title: issuedResource.title, summary: article.extract, source_url: article.url, provider: 'wikipedia-live' }, paid: true, tx_hash: parsed.tx_hash ?? null };
  });
  return { app, address: account.address };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.RESEARCH_PROVIDER_PORT ?? 4010);
  const provider = buildResearchProvider();
  provider.app.listen({ port, host: '0.0.0.0' }).then(() => provider.app.log.info({ port, address: provider.address }, 'live research provider listening')).catch((error) => { console.error(error); process.exit(1); });
}
