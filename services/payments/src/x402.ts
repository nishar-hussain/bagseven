import { eq as eqMoney } from '@agentos/money';

export interface X402Challenge {
  amount: string;
  token: string;
  chain: string;
  payTo: string;
  nonce: string;
  expiresAt?: string;
}

export interface ExpectedPayment {
  amount: string;
  token: string;
  chain: string;
  payee_address: string;
}

/**
 * x402 challenge validation (slice 2.6). The challenge must match the reservation
 * byte-for-byte on amount/token/chain, and — critically — payTo must equal the
 * PROVIDER'S REGISTERED payout address. A mismatched payTo means an attacker is
 * trying to redirect the payment: abort before any signature is requested.
 */
export function validateChallenge(challenge: X402Challenge | undefined, expected: ExpectedPayment): string[] {
  const errors: string[] = [];
  if (!challenge) {
    errors.push('no x402 challenge returned');
    return errors;
  }
  if (!eqMoney(challenge.amount, expected.amount)) errors.push(`amount mismatch: expected ${expected.amount}, got ${challenge.amount}`);
  if (challenge.token !== expected.token) errors.push(`token mismatch: expected ${expected.token}, got ${challenge.token}`);
  if (challenge.chain !== expected.chain) errors.push(`chain mismatch: expected ${expected.chain}, got ${challenge.chain}`);
  if ((challenge.payTo ?? '').toLowerCase() !== (expected.payee_address ?? '').toLowerCase()) {
    errors.push(`payTo does not match registered payee: got ${challenge.payTo}`);
  }
  if (!challenge.nonce) errors.push('missing nonce');
  if (challenge.expiresAt && Date.parse(challenge.expiresAt) < Date.now()) errors.push('challenge expired');
  return errors;
}