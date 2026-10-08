import { describe, expect, it } from 'vitest';
import { encodeBase64, parsePaymentResponse } from './protocol.js';

describe('demo provider payment protocol', () => {
  it('round-trips a payment proof', () => {
    const proof = { amount: '0.10', recipient: '0x0000000000000000000000000000000000000001', nonce: 'n1', tx_hash: '0xabc' };
    expect(parsePaymentResponse(JSON.stringify(proof))).toEqual(proof);
  });

  it('encodes a challenge for the payment-required header', () => {
    expect(Buffer.from(encodeBase64('{"amount":"0.10"}'), 'base64').toString('utf8')).toBe('{"amount":"0.10"}');
  });
});
