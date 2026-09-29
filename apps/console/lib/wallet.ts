'use client';

/**
 * EIP-1193 browser wallet integration (MetaMask et al). Lets the user fund an
 * agent's wallet directly from their own wallet via a confirmation popup —
 * USDC is deducted from the connected user wallet, not the platform master.
 */

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
  }
}

export const SEPOLIA_CHAIN_ID = '0xaa36a7';
export const USDC_SEPOLIA = process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connectWallet(): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found (install MetaMask)');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('No account selected');
  return address;
}

export async function ensureSepolia(): Promise<void> {
  const eth = window.ethereum;
  if (!eth) return;
  const chainId = (await eth.request({ method: 'eth_chainId' })) as string;
  if (chainId === SEPOLIA_CHAIN_ID) return;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] });
  } catch {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: SEPOLIA_CHAIN_ID,
          chainName: 'Sepolia',
          nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
          blockExplorerUrls: ['https://sepolia.etherscan.io'],
        },
      ],
    });
  }
}

/** "3.50" -> 3500000 (6-decimal units), exact — no floating point. */
export function usdcToUnits(amount: string): bigint {
  const [int = '0', frac = ''] = amount.split('.');
  return BigInt(int) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
}

function erc20TransferCalldata(to: string, amountUnits: bigint): string {
  const toPad = `000000000000000000000000${to.slice(2).toLowerCase()}`;
  const amt = amountUnits.toString(16).padStart(64, '0');
  return `0xa9059cbb${toPad}${amt}`;
}

/**
 * Opens a wallet popup asking the user to approve a USDC transfer from their
 * connected wallet to `to`. Returns the tx hash once the user signs.
 */
export async function sendUsdc(from: string, to: string, amount: string): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found');
  await ensureSepolia();
  const units = usdcToUnits(amount);
  const txHash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: USDC_SEPOLIA, data: erc20TransferCalldata(to, units), value: '0x0' }],
  })) as string;
  return txHash;
}

/**
 * Sends a small native ETH gas grant to the agent's wallet so it can pay for its
 * own settlement transactions. Opens one more wallet popup.
 */
export async function sendNative(from: string, to: string, amountEth: string): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found');
  await ensureSepolia();
  const value = BigInt(Math.round(Number(amountEth) * 1e18));
  const txHash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, value: `0x${value.toString(16)}` }],
  })) as string;
  return txHash;
}

export function shortAddress(a: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/**
 * EIP-191 personal_sign. The connected wallet signs the canonical mandate
 * payload — the mandate is bound to the signing wallet as its operator.
 */
export async function signMessage(message: string): Promise<string> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found');
  const signature = (await eth.request({
    method: 'personal_sign',
    params: [message, (await connectWallet())],
  })) as string;
  return signature;
}

/** Canonical mandate payload — must match @agentos/mandate.canonicalMandate. */
export function buildCanonicalMandate(input: {
  agent_id: string;
  operator_address: string;
  budget_per_window: string;
  window_seconds: number;
  lifetime_cap: string;
  per_purchase_limit: string;
  per_seller_limit_bps: number;
  max_depth: number;
  chain: string;
}): string {
  return [
    'bagseven-mandate-v1',
    input.agent_id,
    input.operator_address,
    input.budget_per_window,
    input.window_seconds,
    input.lifetime_cap,
    input.per_purchase_limit,
    input.per_seller_limit_bps,
    input.max_depth,
    input.chain,
  ].join('|');
}