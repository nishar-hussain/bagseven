import { describe, expect, it } from 'vitest';
import {
  canonicalEnvelope,
  generateSigningKeypair,
  hashBody,
  hashApiKey,
  newNonce,
  signEnvelope,
  verifyEnvelope,
} from './index.js';

describe('auth envelopes', () => {
  const keypair = generateSigningKeypair();
  const base = {
    agent_id: 'agt_1',
    method: 'POST',
    path: '/v1/policy-checks',
    body_hash: hashBody({ amount: '7.00' }),
    nonce: newNonce(),
    timestamp: new Date().toISOString(),
  };

  it('signs and verifies a valid envelope', () => {
    const env = signEnvelope(base, keypair.privateKeyPem);
    expect(verifyEnvelope(env, keypair.publicKeyPem)).toBe(true);
  });

  it('rejects a tampered body hash', () => {
    const env = signEnvelope(base, keypair.privateKeyPem);
    const tampered = { ...env, body_hash: hashBody({ amount: '9999.00' }) };
    expect(verifyEnvelope(tampered, keypair.publicKeyPem)).toBe(false);
  });

  it('rejects a wrong public key', () => {
    const env = signEnvelope(base, keypair.privateKeyPem);
    const other = generateSigningKeypair();
    expect(verifyEnvelope(env, other.publicKeyPem)).toBe(false);
  });

  it('canonical form is deterministic', () => {
    expect(canonicalEnvelope(base)).toBe(canonicalEnvelope(base));
  });

  it('hashes api keys irreversibly', () => {
    expect(hashApiKey('secret')).not.toBe('secret');
    expect(hashApiKey('secret')).toHaveLength(64);
  });
});