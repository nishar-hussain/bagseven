import { describe, expect, it } from 'vitest';
import { validateChallenge, type X402Challenge } from './x402.js';

const expected = {
  amount: '0.10',
  token: 'USDC',
  chain: 'sepolia',
  payee_address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
};

const good: X402Challenge = {
  amount: '0.10',
  token: 'USDC',
  chain: 'sepolia',
  payTo: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  nonce: 'n1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('x402 challenge validation (2.6)', () => {
  it('accepts an exact match', () => {
    expect(validateChallenge(good, expected)).toEqual([]);
  });

  it('rejects a mismatched amount (never auto-correct)', () => {
    const errors = validateChallenge({ ...good, amount: '1.00' }, expected);
    expect(errors.join(';')).toContain('amount mismatch');
  });

  it('rejects a mismatched token', () => {
    const errors = validateChallenge({ ...good, token: 'ETH' }, expected);
    expect(errors.join(';')).toContain('token mismatch');
  });

  it('rejects a mismatched chain', () => {
    const errors = validateChallenge({ ...good, chain: 'base' }, expected);
    expect(errors.join(';')).toContain('chain mismatch');
  });

  it('rejects payTo that differs from the registered payee — the redirect attack', () => {
    const attacker = '0x1111111111111111111111111111111111111111';
    const errors = validateChallenge({ ...good, payTo: attacker }, expected);
    expect(errors.join(';')).toContain('payTo');
  });

  it('rejects an expired challenge', () => {
    const errors = validateChallenge({ ...good, expiresAt: new Date(Date.now() - 1000).toISOString() }, expected);
    expect(errors.join(';')).toContain('expired');
  });

  it('rejects a missing nonce', () => {
    const errors = validateChallenge({ ...good, nonce: '' }, expected);
    expect(errors.join(';')).toContain('nonce');
  });

  it('rejects a missing challenge entirely', () => {
    expect(validateChallenge(undefined, expected).join(';')).toContain('no x402 challenge');
  });
});