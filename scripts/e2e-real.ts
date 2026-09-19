/**
 * REAL on-chain end-to-end verification (slice 1.6) against Ethereum Sepolia
 * (SEPOLIA_RPC_URL) — or a local Anvil fork of it.
 *
 * Flow: agent A and agent B get real EOA addresses → A is funded with CREDIT_AMOUNT
 * USDC (default 10) via a real master-account transfer → A's policy allows a
 * spend → A reserves + commits against B → a real USDC `transfer` moves
 * SPEND_AMOUNT USDC (default 3) A→B on-chain → verified against the token contract.
 *
 * Amounts are overridable: E2E_CREDIT=10 E2E_SPEND=3 pnpm exec tsx scripts/e2e-real.ts
 */
import { Client } from '@agentos/sdk';
import { createPublicClient, http, erc20Abi } from 'viem';
import { sepolia } from 'viem/chains';
import { eq as eqMoney, sub } from '@agentos/money';

try {
  process.loadEnvFile();
} catch {
  /* .env optional; env vars may be passed explicitly */
}

const GATEWAY = 'http://localhost:4000';
const RPC = process.env.SEPOLIA_RPC_URL ?? 'http://localhost:8545';
const USDC = process.env.SEPOLIA_USDC ?? '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const CREDIT_AMOUNT = process.env.E2E_CREDIT ?? '10.00';
const SPEND_AMOUNT = process.env.E2E_SPEND ?? '3.00';

function log(step: string, ok: boolean, detail?: unknown): void {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) process.exitCode = 1;
}

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const toUnits = (amount: string): bigint => {
  const [int = '0', frac = ''] = amount.split('.');
  return BigInt(int) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
};
const withRetry = async <T>(fn: () => Promise<T>, attempts = 6): Promise<T> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2_000 * (i + 1)));
    }
  }
  throw lastErr;
};
const balanceOf = async (address: string) =>
  withRetry(() =>
    publicClient.readContract({ address: USDC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }),
  ) as Promise<bigint>;

interface AgentHandle {
  client: Client;
  id: string;
}

async function main(): Promise<void> {
  const consoleClient = new Client({ baseUrl: GATEWAY });

  const org = await consoleClient.createOrganization({ legal_name: 'Real E2E Org' });
  const guardian = await consoleClient.createGuardian({ type: 'human', org_id: org.organization.id });

  const makeAgent = async (name: string): Promise<AgentHandle> => {
    const a = await consoleClient.createAgent({ owner_org_id: org.organization.id, guardian_id: guardian.guardian.id, display_name: name, capabilities: ['trading'] });
    await consoleClient.confirmAgent(a.agent_id, guardian.guardian_token);
    return { client: new Client({ baseUrl: GATEWAY, agentId: a.agent_id, privateKeyPem: a.signing_private_key_pem }), id: a.agent_id };
  };

  const agentA = await makeAgent('Real Agent A');
  const agentB = await makeAgent('Real Agent B');

  const walletA = await agentA.client.provisionWallet({ agent_id: agentA.id, chain: 'sepolia' });
  const walletB = await agentA.client.provisionWallet({ agent_id: agentB.id, chain: 'sepolia' });
  log('real EOA addresses derived', /^0x[0-9a-fA-F]{40}$/.test(walletA.wallet.address) && /^0x[0-9a-fA-F]{40}$/.test(walletB.wallet.address), {
    A: walletA.wallet.address,
    B: walletB.wallet.address,
  });

  // Real funding: master account transfers CREDIT_AMOUNT USDC to A (+ ETH gas grant).
  const credit = await agentA.client.creditWallet(walletA.wallet.id, { token: 'USDC', amount: CREDIT_AMOUNT });
  log(`credit A with ${CREDIT_AMOUNT} USDC on-chain`, !!credit.tx_hash, { tx_hash: credit.tx_hash });

  const balA0 = await balanceOf(walletA.wallet.address);
  const creditUnits = toUnits(CREDIT_AMOUNT);
  log(`A on-chain USDC = ${CREDIT_AMOUNT}`, balA0 === creditUnits, balA0.toString());

  await agentA.client.createPolicy({
    agent_id: agentA.id,
    daily_budget: '50.00',
    max_transaction: '20.00',
    allowed_chains: ['sepolia'],
    allowed_categories: ['trading'],
    created_by: 'e2e-real',
  });

  // A proposes a $SPEND spend to B -> allow + token
  const decision = await agentA.client.proposeSpend(
    agentA.id,
    { amount: SPEND_AMOUNT, currency: 'USDC', category: 'trading', chain: 'sepolia', counterparty: agentB.id },
    'real-spend-1',
  );
  log(`spend intent $${SPEND_AMOUNT} → allow + token`, decision.decision === 'allow' && !!decision.spend_token, decision.reason);

  // Reserve against B (payee resolution: B's agent id → B's real address)
  const reserved = await agentA.client.reserve(
    {
      wallet_id: walletA.wallet.id,
      token: 'USDC',
      amount: SPEND_AMOUNT,
      spend_token: decision.spend_token!,
      counterparty_id: agentB.id,
      counterparty_type: 'agent',
    },
    'real-reserve-1',
  );
  log('reservation held', reserved.status === 'held', reserved.reservation_id);

  const committed = await agentA.client.commitReservation(reserved.reservation_id);
  log('commit → real on-chain tx', committed.status === 'committed' && /^0x[0-9a-fA-F]{64}$/.test(committed.tx_hash), committed.tx_hash);

  // On-chain verification: SPEND_AMOUNT moved from A to B.
  const spendUnits = toUnits(SPEND_AMOUNT);
  const balA = await balanceOf(walletA.wallet.address);
  const balB = await balanceOf(walletB.wallet.address);
  log(`A on-chain USDC = ${sub(CREDIT_AMOUNT, SPEND_AMOUNT)}`, balA === creditUnits - spendUnits, balA.toString());
  log(`B on-chain USDC = ${SPEND_AMOUNT}`, balB === spendUnits, balB.toString());

  // Ledger: A's off-chain balance debited (exact decimal math, no floats).
  const wA = await agentA.client.getWallets(agentA.id);
  const usdcA = wA.wallets[0]?.balances.find((b) => b.token === 'USDC');
  const expectedLedger = sub(CREDIT_AMOUNT, SPEND_AMOUNT);
  log(`A ledger balance = ${expectedLedger}`, eqMoney(usdcA?.amount ?? '', expectedLedger), usdcA?.amount);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});