export interface PaymentChallenge {
  provider: string;
  amount: string;
  recipient: `0x${string}`;
  chain: number;
  token: string;
  nonce: string;
  expires_at: number;
  signature?: `0x${string}`;
}

export function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function parsePaymentResponse(value: string): { amount?: string; recipient?: string; tx_hash?: string } {
  try { return JSON.parse(value) as { amount?: string; recipient?: string; tx_hash?: string }; }
  catch { throw new Error('invalid payment response'); }
}
