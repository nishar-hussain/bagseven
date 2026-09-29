import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  createHash,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from 'node:crypto';

/**
 * Agent-to-platform authentication using signed request envelopes.
 *
 * Every request an agent makes to a service must carry an envelope binding:
 *   agent_id, method, path, body_hash, nonce, timestamp
 * signed with the agent's Ed25519 key. The agent runtime (the LLM) never holds a
 * signing key for Treasury co-signing; this envelope only authorizes "propose".
 */

export interface Envelope {
  agent_id: string;
  method: string;
  path: string;
  body_hash: string;
  nonce: string;
  timestamp: string;
  signature: string;
}

export interface AgentCredentials {
  apiKey: string;
  apiKeyHash: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export function createAgentKeyPair(): AgentCredentials {
  const apiKey = `sk_agt_${randomBytes(24).toString('base64url')}`;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    apiKey,
    apiKeyHash: hashApiKey(apiKey),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function canonicalEnvelope(input: Omit<Envelope, 'signature'>): string {
  return JSON.stringify({
    agent_id: input.agent_id,
    method: input.method,
    path: input.path,
    body_hash: input.body_hash,
    nonce: input.nonce,
    timestamp: input.timestamp,
  });
}

export function signEnvelope(
  input: Omit<Envelope, 'signature'>,
  privateKeyPem: string,
): Envelope {
  const key = createPrivateKey(privateKeyPem);
  const data = Buffer.from(canonicalEnvelope(input), 'utf8');
  const signature = ed25519Sign(null, data, key).toString('base64');
  return { ...input, signature };
}

export function verifyEnvelope(envelope: Envelope, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    const data = Buffer.from(canonicalEnvelope(envelope), 'utf8');
    return ed25519Verify(null, data, key, Buffer.from(envelope.signature, 'base64'));
  } catch {
    return false;
  }
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export interface SigningKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Spend tokens (D1 in docs/DECISIONS.md): Ed25519-signed claims issued by the
 * Policy Service and verified by the Treasury Service at co-sign time.
 * Format: "v1.<base64url(canonicalClaims)>.<base64url(signature)>"
 */

export interface SpendTokenClaims {
  v: 1;
  decision_id: string;
  agent_id: string;
  amount: string;
  currency: string;
  chain: string;
  category: string;
  counterparty_id: string | null;
  mandate_id?: string;
  depth?: number;
  iat: string;
  exp: string;
  jti: string;
}

const TOKEN_PREFIX = 'v1.';

export function signSpendToken(claims: SpendTokenClaims, privateKeyPem: string): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  const key = createPrivateKey(privateKeyPem);
  const signature = ed25519Sign(null, payload, key);
  return `${TOKEN_PREFIX}${payload.toString('base64url')}.${signature.toString('base64url')}`;
}

export function verifySpendToken(token: string, publicKeyPem: string): SpendTokenClaims {
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error('invalid token format');
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) throw new Error('invalid token format');
  const payloadB64 = rest.slice(0, dot);
  const sigB64 = rest.slice(dot + 1);
  const payload = Buffer.from(payloadB64, 'base64url');
  const signature = Buffer.from(sigB64, 'base64url');
  const key = createPublicKey(publicKeyPem);
  const ok = ed25519Verify(null, payload, key, signature);
  if (!ok) throw new Error('invalid token signature');
  const claims = JSON.parse(payload.toString('utf8')) as SpendTokenClaims;
  if (claims.v !== 1) throw new Error('unsupported token version');
  const now = Date.now();
  if (Date.parse(claims.exp) <= now) throw new Error('token expired');
  if (Date.parse(claims.iat) > now + 5_000) throw new Error('token issued in future');
  return claims;
}

export function newJti(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Decodes a spend token's claims WITHOUT verifying the signature. Used only to
 * read claims from an expired token (e.g. to release its budget reservation).
 * Never use this for authorization — always verifySpendToken for that.
 */
export function peekSpendTokenClaims(token: string): SpendTokenClaims {
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error('invalid token format');
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) throw new Error('invalid token format');
  const payload = Buffer.from(rest.slice(0, dot), 'base64url');
  return JSON.parse(payload.toString('utf8')) as SpendTokenClaims;
}

export function generateSigningKeypair(): SigningKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
/**
 * Generic Ed25519 sign/verify over raw bytes, used for signing a mandate's
 * canonical payload (the operator signs the mandate once; it cannot be edited).
 */
export function signBytes(payload: Uint8Array, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return ed25519Sign(null, payload, key).toString('base64');
}

export function verifyBytes(payload: Uint8Array, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return ed25519Verify(null, payload, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
