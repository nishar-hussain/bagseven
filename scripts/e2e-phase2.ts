/**
 * Phase 2 end-to-end verification — Tool Marketplace (OnchainRouter).
 *
 * Flow: agent → register + approve a provider → list a paid tool → policy-gated
 * execution → x402 (402 → pay → retry-with-proof) → real on-chain settlement →
 * verified against the token contract. Also proves the payTo-binding rejects a
 * provider whose registered payout differs from its x402 challenge.
 *
 * Runs on whatever SEPOLIA_RPC_URL points at (real Sepolia or the local faucet).
 * Requires all services + the demo-provider running.
 *
 * Usage: pnpm exec tsx scripts/e2e-phase2.ts
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
const DEMO_URL = process.env.DEMO_PROVIDER_URL ?? 'http://localhost:4007';
const DEMO_PAYOUT = process.env.DEMO_PAYOUT ?? '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const TOOL_PRICE = process.env.E2E_TOOL_PRICE ?? '0.10';
const CREDIT = process.env.E2E_CREDIT ?? '5.00';

function log(step: string, ok: boolean, detail?: unknown): void {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) process.exitCode = 1;
}

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const balanceOf = async (address: string) =>
  publicClient.readContract({ address: USDC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`] }) as Promise<bigint>;
const toUnits = (amount: string): bigint => {
  const [int = '0', frac = ''] = amount.split('.');
  return BigInt(int) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
};

async function main(): Promise<void> {
  const consoleClient = new Client({ baseUrl: GATEWAY });

  // Agent A (the buyer).
  const org = await consoleClient.createOrganization({ legal_name: 'Phase2 Org' });
  const guardian = await consoleClient.createGuardian({ type: 'human', org_id: org.organization.id });
  const agent = await consoleClient.createAgent({ owner_org_id: org.organization.id, guardian_id: guardian.guardian.id, display_name: 'Marketplace Buyer', capabilities: ['trading'] });
  await consoleClient.confirmAgent(agent.agent_id, guardian.guardian_token);
  const buyer = new Client({ baseUrl: GATEWAY, agentId: agent.agent_id, privateKeyPem: agent.signing_private_key_pem });

  const wallet = await buyer.provisionWallet({ agent_id: agent.agent_id, chain: 'sepolia' });
  await buyer.creditWallet(wallet.wallet.id, { token: 'USDC', amount: CREDIT });
  await buyer.createPolicy({
    agent_id: agent.agent_id,
    daily_budget: '50.00',
    max_transaction: '20.00',
    allowed_chains: ['sepolia'],
    allowed_categories: ['trading', 'data-analysis'],
    created_by: 'e2e-phase2',
  });
  log('buyer agent funded + policy published', true);

  // Provider onboarding (2.5).
  const provider = await consoleClient.registerProvider({
    name: 'Demo Data Provider',
    contact_email: 'provider@example.com',
    payout_wallet_address: DEMO_PAYOUT,
    payout_chain: 'sepolia',
  });
  log('provider registered (pending)', provider.status === 'pending', provider.provider_id);
  await consoleClient.approveProvider(provider.provider_id);
  log('provider approved (active)', true);

  // List a paid tool (2.1).
  const tool = await consoleClient.createTool(provider.provider_token, {
    provider_id: provider.provider_id,
    name: 'liquidation-risk',
    description: 'Returns liquidation risk score for a position',
    category: 'trading',
    price: TOOL_PRICE,
    price_token: 'USDC',
    endpoint_url: `${DEMO_URL}/v1/exec`,
    input_schema: { position: { type: 'string' } },
  });
  log('tool listed (price ' + TOOL_PRICE + ')', !!tool.tool?.id, tool.tool?.id);

  const discovery = await consoleClient.listTools({ category: 'trading' });
  log('discovery finds the tool', discovery.tools.some((t) => t.id === tool.tool.id), discovery.tools.length + ' tools');

  // Execute the paid tool (2.2): policy → reserve → x402 → settle.
  const providerBefore = await balanceOf(DEMO_PAYOUT);
  const execution = await buyer.executeTool(agent.agent_id, tool.tool.id, { position: 'aave-wbtc-2x' }, `phase2-${Date.now()}`);
  log('tool executed (paid)', execution.status === 'succeeded' && eqMoney(execution.price_paid, TOOL_PRICE), {
    price_paid: execution.price_paid,
    tx_hash: execution.tx_hash?.slice(0, 18) + '…',
  });

  const providerAfter = await balanceOf(DEMO_PAYOUT);
  log(`provider paid exactly ${TOOL_PRICE} USDC on-chain`, providerAfter - providerBefore === toUnits(TOOL_PRICE), {
    delta: Number(providerAfter - providerBefore) / 1e6,
  });

  const buyerWallet = await buyer.getWallets(agent.agent_id);
  const usdc = buyerWallet.wallets[0]?.balances.find((b) => b.token === 'USDC');
  const expectedLeft = sub(CREDIT, TOOL_PRICE);
  log(`buyer ledger debited (${expectedLeft})`, eqMoney(usdc?.amount ?? '', expectedLeft), usdc?.amount);

  const receipts = await buyer.getAgentReceipts(agent.agent_id);
  log('receipt written for the tool call', receipts.receipts.length >= 1, receipts.receipts[0]?.id);

  // Negative: a tool category the policy doesn't allow → denied (2.3).
  const deniedTool = await consoleClient.createTool(provider.provider_token, {
    provider_id: provider.provider_id,
    name: 'gambling-odds',
    category: 'gambling',
    price: TOOL_PRICE,
    endpoint_url: `${DEMO_URL}/v1/exec`,
  });
  let policyDenied = false;
  try {
    await buyer.executeTool(agent.agent_id, deniedTool.tool.id, { game: 'sports' }, `phase2-denied-${Date.now()}`);
  } catch (err) {
    policyDenied = (err as { code?: string }).code === 'POLICY_DENIED';
  }
  log('tool in a disallowed category → policy-denied (2.3)', policyDenied);

  // Negative: payTo-binding — a provider registered with a DIFFERENT payout than
  // its x402 challenge → the payment must be aborted before any signature (2.6).
  const rogue = await consoleClient.registerProvider({
    name: 'Rogue Provider',
    payout_wallet_address: '0x1111111111111111111111111111111111111111',
    payout_chain: 'sepolia',
  });
  await consoleClient.approveProvider(rogue.provider_id);
  const rogueTool = await consoleClient.createTool(rogue.provider_token, {
    provider_id: rogue.provider_id,
    name: 'redirect-trap',
    category: 'trading',
    price: TOOL_PRICE,
    endpoint_url: `${DEMO_URL}/v1/exec`,
  });
  let redirectBlocked = false;
  try {
    await buyer.executeTool(agent.agent_id, rogueTool.tool.id, { trap: true }, `phase2-rogue-${Date.now()}`);
  } catch (err) {
    redirectBlocked = (err as { code?: string }).code === 'X402_CHALLENGE_MISMATCH';
  }
  log('payTo-binding blocks a payout redirect (2.6)', redirectBlocked);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});