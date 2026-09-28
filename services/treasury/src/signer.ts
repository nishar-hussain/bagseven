import { createHash } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseUnits,
  sha256,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { ChainSpec } from './chains.js';

/**
 * Custody abstraction (D13). The Treasury Service talks only to this interface.
 * DevSigner simulates settlement (no chain). RealEoaSigner broadcasts real
 * transactions on a real EVM chain (Base Sepolia, or a local Anvil fork of it).
 */
export interface Signer {
  readonly chain: string;
  readonly custodyType: 'dev' | 'mpc' | 'hsm' | 'smart-account' | 'eoa';
  deriveAddress(agentId: string): Promise<string>;
  signAndSubmit(input: { agentId: string; to: string; amount: string; token: string }): Promise<{
    txHash: string;
    confirmed: boolean;
  }>;
  /** Transfer the agent's full on-chain balance (USDC + native) to a target address. */
  sweep(agentId: string, to: string): Promise<{ usdcTxHash?: string; ethTxHash?: string }>;
  /** Raw on-chain balance for an address/token (for ledger reconciliation), or null if not readable. */
  getBalance?(address: string, token: string): Promise<bigint | null>;
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
    const hash = createHash('sha256')
      .update(JSON.stringify({ agentId: input.agentId, to: input.to, amount: input.amount, token: input.token, nonce: Date.now() }))
      .digest('hex');
    return { txHash: `0x${hash}`, confirmed: true };
  }

  async sweep(agentId: string, to: string): Promise<{ usdcTxHash?: string; ethTxHash?: string }> {
    return { usdcTxHash: `0x${createHash('sha256').update(`sweep:${agentId}:${to}:${Date.now()}`).digest('hex')}` };
  }

  async getBalance(): Promise<bigint | null> {
    return null; // dev signer has no chain
  }
}

/**
 * Real EOA signer.
 *
 * - Every agent gets a deterministic address derived from a platform-held seed:
 *     privateKey = sha256(agentSeed : agentId : chain)
 *   Only the platform (holder of the seed) can derive it — it is not a public
 *   function of the agent id. Production custody should replace this with MPC /
 *   smart-account custody behind the same interface.
 * - A master account (TREASURY_MASTER_PRIVATE_KEY) funds agents (credit faucet)
 *   and pays the agent's gas grant so its transfers confirm.
 * - USDC moves via ERC-20 `transfer`; ETH via native send.
 */
export class RealEoaSigner implements Signer {
  readonly chain: string;
  readonly custodyType = 'eoa' as const;
  private readonly spec: ChainSpec;
  private readonly agentSeed: string;
  private readonly masterPrivateKey: Hex;
  private readonly publicClient;
  private readonly walletClient;

  constructor(chain: string, spec: ChainSpec, agentSeed: string, masterPrivateKey: string) {
    this.chain = chain;
    this.spec = spec;
    this.agentSeed = agentSeed;
    this.masterPrivateKey = masterPrivateKey as Hex;
    this.publicClient = createPublicClient({ chain: spec.viemChain, transport: http(spec.rpcUrl) });
    const master = privateKeyToAccount(this.masterPrivateKey);
    this.walletClient = createWalletClient({ account: master, chain: spec.viemChain, transport: http(spec.rpcUrl) });
  }

  private agentAccount(agentId: string): PrivateKeyAccount {
    const digest = sha256(toBytes(`${this.agentSeed}:${agentId}:${this.chain}`));
    return privateKeyToAccount(digest);
  }

  get masterAddress(): Address {
    return privateKeyToAccount(this.masterPrivateKey).address;
  }

  async deriveAddress(agentId: string): Promise<string> {
    return this.agentAccount(agentId).address;
  }

  private decimalsFor(token: string): number {
    if (token === 'ETH') return this.spec.nativeDecimals;
    return this.spec.tokenDecimals[token] ?? this.spec.nativeDecimals;
  }

  private amountToUnits(amount: string, token: string): bigint {
    const decimals = this.decimalsFor(token);
    const [int, frac = ''] = amount.split('.');
    const truncated = `${int}.${frac.slice(0, decimals)}`;
    return parseUnits(truncated, decimals);
  }

  async signAndSubmit(input: { agentId: string; to: string; amount: string; token: string }): Promise<{
    txHash: string;
    confirmed: boolean;
  }> {
    const account = this.agentAccount(input.agentId);
    const wallet = createWalletClient({ account, chain: this.spec.viemChain, transport: http(this.spec.rpcUrl) });
    const to = input.to as Address;
    const value = this.amountToUnits(input.amount, input.token);

    let hash: Hex;
    if (input.token === 'ETH') {
      hash = await wallet.sendTransaction({ to, value });
    } else if (input.token === 'USDC') {
      hash = await wallet.writeContract({
        address: this.spec.usdcAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, value],
      });
    } else {
      throw new Error(`unsupported token for real settlement: ${input.token}`);
    }

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { txHash: hash, confirmed: receipt.status === 'success' };
  }

  /** Funds a wallet address from the master account: token credit + a small native gas grant. */
  async fund(to: string, token: string, amount: string): Promise<{ txHash: string; gasTxHash?: string }> {
    const value = this.amountToUnits(amount, token);
    let txHash: Hex;

    if (token === 'ETH') {
      txHash = await this.walletClient.sendTransaction({ to: to as Address, value });
    } else {
      txHash = await this.walletClient.writeContract({
        address: this.spec.usdcAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to as Address, value],
      });
    }
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    // Grant a little native gas so the derived agent can pay for its own transfers.
    const gasTxHash = await this.walletClient.sendTransaction({
      to: to as Address,
      value: parseUnits(this.spec.gasGrantNative, this.spec.nativeDecimals),
    });
    await this.publicClient.waitForTransactionReceipt({ hash: gasTxHash });

    return { txHash, gasTxHash };
  }

  /** Sweeps the agent's full on-chain USDC + native balance to a target address. */
  async sweep(agentId: string, to: string): Promise<{ usdcTxHash?: string; ethTxHash?: string }> {
    const account = this.agentAccount(agentId);
    const wallet = createWalletClient({ account, chain: this.spec.viemChain, transport: http(this.spec.rpcUrl) });
    const result: { usdcTxHash?: string; ethTxHash?: string } = {};

    const usdcBal = (await this.publicClient.readContract({
      address: this.spec.usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    })) as bigint;
    if (usdcBal > 0n) {
      const usdcTx: Hex = await wallet.writeContract({
        address: this.spec.usdcAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to as Address, usdcBal],
      });
      result.usdcTxHash = usdcTx;
      await this.publicClient.waitForTransactionReceipt({ hash: usdcTx });
    }

    const ethBal = await this.publicClient.getBalance({ address: account.address });
    if (ethBal > 0n) {
      const gasEstimate = 21_000n * (await this.publicClient.getGasPrice());
      const value = ethBal > gasEstimate ? ethBal - gasEstimate : 0n;
      if (value > 0n) {
        const ethTx: Hex = await wallet.sendTransaction({ to: to as Address, value });
        result.ethTxHash = ethTx;
        await this.publicClient.waitForTransactionReceipt({ hash: ethTx });
      }
    }

    return result;
  }

  /** Reads the real on-chain balance (raw units) for ledger reconciliation. */
  async getBalance(address: string, token: string): Promise<bigint | null> {
    if (token === 'USDC') {
      return (await this.publicClient.readContract({
        address: this.spec.usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as Address],
      })) as bigint;
    }
    if (token === 'ETH') {
      return this.publicClient.getBalance({ address: address as Address });
    }
    return null;
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

export function registerRealSigner(chain: string, spec: ChainSpec, agentSeed: string, masterPrivateKey: string): Signer {
  const signer = new RealEoaSigner(chain, spec, agentSeed, masterPrivateKey);
  SIGNERS[chain] = signer;
  return signer;
}