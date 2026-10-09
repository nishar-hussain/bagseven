import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResearchProvider } from './index.js';

function wikipediaResponse(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
afterEach(() => vi.unstubAllGlobals());

describe('live research provider', () => {
  it('searches live sources and returns a signed 402 challenge for a live result', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).includes('action=query') ? wikipediaResponse({ query: { search: [{ title: 'Electric vehicle', snippet: 'Live source result' }] } }) : wikipediaResponse({ extract: 'Live article', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Electric_vehicle' } } })));
    const app = buildResearchProvider({ RESEARCH_PROVIDER_KEY: `0x${'11'.repeat(32)}`, RESEARCH_PROVIDER_HOST: '127.0.0.1', CHAIN_ID: '31337' }).app;
    const catalog = await app.inject('/v1/providers?query=electric%20vehicle');
    const resource = (catalog.json() as { providers: Array<{ resources: Array<{ id: string }> }> }).providers[0]!.resources[0]!;
    const paid = await app.inject(`/v1/resources/${resource.id}`);
    expect(catalog.statusCode).toBe(200);
    expect(paid.statusCode).toBe(402);
    expect(paid.headers['payment-required']).toBeTruthy();
    await app.close();
  });

  it('accepts a matching payment proof once and rejects a replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).includes('action=query') ? wikipediaResponse({ query: { search: [{ title: 'Electric vehicle', snippet: 'Live source result' }] } }) : wikipediaResponse({ extract: 'Live article', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Electric_vehicle' } } })));
    const app = buildResearchProvider({ RESEARCH_PROVIDER_KEY: `0x${'22'.repeat(32)}`, RESEARCH_PROVIDER_HOST: '127.0.0.1', CHAIN_ID: '31337' }).app;
    const catalog = await app.inject('/v1/providers?query=electric%20vehicle');
    const resource = (catalog.json() as { providers: Array<{ resources: Array<{ id: string }> }> }).providers[0]!.resources[0]!;
    const challenge = await app.inject(`/v1/resources/${resource.id}`);
    const payment = JSON.parse(Buffer.from(String(challenge.headers['payment-required']), 'base64').toString()) as { amount: string; recipient: string; nonce: string };
    const proof = JSON.stringify({ amount: payment.amount, recipient: payment.recipient, nonce: payment.nonce, tx_hash: '0xdemo' });
    const paid = await app.inject({ method: 'GET', url: `/v1/resources/${resource.id}`, headers: { 'x-payment-response': proof } });
    const replay = await app.inject({ method: 'GET', url: `/v1/resources/${resource.id}`, headers: { 'x-payment-response': proof } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ paid: true, resource: { title: 'Electric vehicle', summary: 'Live article' } });
    expect(replay.statusCode).toBe(402);
    await app.close();
  });
});
