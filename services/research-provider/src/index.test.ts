import { describe, expect, it } from 'vitest';
import { buildResearchProvider } from './index.js';

describe('research provider', () => {
  it('returns free resources and a signed 402 challenge for paid resources', async () => {
    const app = buildResearchProvider({ RESEARCH_PROVIDER_KEY: `0x${'11'.repeat(32)}`, RESEARCH_PROVIDER_HOST: '127.0.0.1', CHAIN_ID: '31337' }).app;
    const free = await app.inject('/v1/resources/ev-battery-overview');
    const paid = await app.inject('/v1/resources/ev-battery-pricing');
    expect(free.statusCode).toBe(200);
    expect(paid.statusCode).toBe(402);
    expect(paid.headers['payment-required']).toBeTruthy();
    await app.close();
  });

  it('accepts a matching payment proof once and rejects a replay', async () => {
    const app = buildResearchProvider({ RESEARCH_PROVIDER_KEY: `0x${'22'.repeat(32)}`, RESEARCH_PROVIDER_HOST: '127.0.0.1', CHAIN_ID: '31337' }).app;
    const challenge = await app.inject('/v1/resources/ev-battery-pricing');
    const payment = JSON.parse(Buffer.from(String(challenge.headers['payment-required']), 'base64').toString()) as { amount: string; recipient: string; nonce: string };
    const proof = JSON.stringify({ amount: payment.amount, recipient: payment.recipient, nonce: payment.nonce, tx_hash: '0xdemo' });
    const paid = await app.inject({ method: 'GET', url: '/v1/resources/ev-battery-pricing', headers: { 'x-payment-response': proof } });
    const replay = await app.inject({ method: 'GET', url: '/v1/resources/ev-battery-pricing', headers: { 'x-payment-response': proof } });
    expect(paid.statusCode).toBe(200);
    expect(replay.statusCode).toBe(402);
    await app.close();
  });
});
