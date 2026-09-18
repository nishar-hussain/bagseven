import { createHash } from 'node:crypto';

/**
 * Custody abstraction (D13). The Treasury Service talks only to this interface.
 * Phase 1 ships the DevSigner; real ERC-4337 / MPC custody is a later slice that
 * swaps in behind the same interface without touching the reservation logic.
 */
export interface Signer {
  readonly chain: string;
  readonly custodyType: 'dev' | 'mpc' | 'hsm' | 'smart-account';
  deriveAddress(agentId: string): Promise<string>;
  signAndSubmit(input: { agentId: string; to: string; amount: string; token: string }): Promise<{
    txHash: string;
    confirmed: boolean;
  }>;
}

export class DevSigner implements Signer {
  readonly chain: string;
  readonly custodyType = 'dev' as const;

  constructor(chain: string) {
    this.chain = chain;
  }

  deriveAddress(agentId: string): Promise<string> {
    const hash = createHash('sha256').update(`${this.chain}:${agentId}`).digest('hex').slice(0, 40);
    return Promise.resolve(`0x${hash}`);
  }

  async signAndSubmit(input: { agentId: string; to: string; amount: string; token: string }): Promise<{
    txHash: string;
    confirmed: boolean;
  }> {
    // Dev signer simulates an on-chain settlement. Slice 1.6 replaces this with a
    // real chain adapter; the reservation lifecycle is identical either way.
    const hash = createHash('sha256')
      .update(JSON.stringify({ agentId: input.agentId, to: input.to, amount: input.amount, token: input.token, nonce: Date.now() }))
      .digest('hex');
    return { txHash: `0x${hash}`, confirmed: true };
  }
}

export const SIGNERS: Record<string, Signer> = {};

export function getSigner(chain: string): Signer {
  const signer = SIGNERS[chain];
  if (!signer) throw new Error(`no signer for chain ${chain}`);
  return signer;
}

export function registerDevSigner(chain: string): Signer {
  const signer = new DevSigner(chain);
  SIGNERS[chain] = signer;
  return signer;
}