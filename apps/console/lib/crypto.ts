'use client';

/**
 * Browser-side Ed25519 envelope signing, compatible with @agentos/auth's Node
 * verifier (raw 64-byte signature, base64-encoded).
 */

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bytes = atob(b64);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return out.buffer;
}

export async function importEd25519PrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToArrayBuffer(pem), { name: 'Ed25519' }, false, ['sign']);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function ed25519Sign(privateKey: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(data));
  return toBase64(new Uint8Array(sig));
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Envelope {
  agent_id: string;
  method: string;
  path: string;
  body_hash: string;
  nonce: string;
  timestamp: string;
  signature: string;
}

export async function signEnvelope(
  agentId: string,
  method: string,
  path: string,
  body: unknown,
  privateKey: CryptoKey,
): Promise<Envelope> {
  const bodyHash = await sha256Hex(JSON.stringify(body ?? null));
  const canonical = JSON.stringify({
    agent_id: agentId,
    method,
    path,
    body_hash: bodyHash,
    nonce: newNonce(),
    timestamp: new Date().toISOString(),
  });
  const signature = await ed25519Sign(privateKey, canonical);
  return { ...JSON.parse(canonical), signature };
}