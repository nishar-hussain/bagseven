import { describe, expect, it } from 'vitest';
import { buildDemoProvider } from './index.js';

const key = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;

describe('demo provider HTTP payment flow', () => {
  it('issues a challenge, accepts the matching proof once, and rejects replay', async () => {
    const provider = buildDemoProvider({ DEMO_PROVIDER_KEY: key, DEMO_PROVIDER_HOST: '127.0.0.1', DEMO_PROVIDER_PRICE: '0.10', CHAIN_ID: '31337' });
    const first = await provider.app.inject('/weather');
    expect(first.statusCode).toBe(402);
    const challenge = first.json().payment as { amount: string; recipient: string; nonce: string };
    const proof = JSON.stringify({ amount: challenge.amount, recipient: challenge.recipient, nonce: challenge.nonce, tx_hash: '0xdemo' });
    const paid = await provider.app.inject({ method: 'GET', url: '/weather', headers: { 'x-payment-response': proof } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().paid).toBe(true);
    const replay = await provider.app.inject({ method: 'GET', url: '/weather', headers: { 'x-payment-response': proof } });
    expect(replay.statusCode).toBe(402);
    await provider.app.close();
  });
});
