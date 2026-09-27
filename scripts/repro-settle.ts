import { Client } from '@agentos/sdk';
async function main() {
  const G = 'http://localhost:4000';
  const c = new Client({ baseUrl: G });
  const org = await c.createOrganization({ legal_name: 'Settle Repro2' });
  const g = await c.createGuardian({ type: 'human', org_id: org.organization.id });
  const a = await c.createAgent({ owner_org_id: org.organization.id, guardian_id: g.guardian.id, display_name: 'Payer' });
  await c.confirmAgent(a.agent_id, g.guardian_token);
  const ac = new Client({ baseUrl: G, agentId: a.agent_id, privateKeyPem: a.signing_private_key_pem });
  const p = await c.createAgent({ owner_org_id: org.organization.id, guardian_id: g.guardian.id, display_name: 'Payee' });
  await c.confirmAgent(p.agent_id, g.guardian_token);
  await ac.provisionWallet({ agent_id: a.agent_id, chain: 'sepolia' });
  await ac.provisionWallet({ agent_id: p.agent_id, chain: 'sepolia' });
  const w = (await ac.getWallets(a.agent_id)).wallets[0].wallet;
  await ac.creditWallet(w.id, { token: 'USDC', amount: '5.00' });
  await ac.createPolicy({ agent_id: a.agent_id, daily_budget: '50.00', max_transaction: '20.00', allowed_chains: ['sepolia'], allowed_categories: ['trading'], created_by: 'repro' });
  const d = await ac.proposeSpend(a.agent_id, { amount: '3.00', currency: 'USDC', category: 'trading', chain: 'sepolia', counterparty: p.agent_id }, 's-1');
  const r = await ac.reserve({ wallet_id: w.id, token: 'USDC', amount: '3.00', spend_token: d.spend_token!, counterparty_id: p.agent_id, counterparty_type: 'agent' }, 's-2');
  const cm = await ac.commitReservation(r.reservation_id);
  console.log('REAL PAYEE: reserve+commit OK, tx', cm.tx_hash?.slice(0,18));
  // zero-address rejection
  const d2 = await ac.proposeSpend(a.agent_id, { amount: '1.00', currency: 'USDC', category: 'trading', chain: 'sepolia', counterparty: crypto.randomUUID() }, 's-3');
  try {
    const r2 = await ac.reserve({ wallet_id: w.id, token: 'USDC', amount: '1.00', spend_token: d2.spend_token!, counterparty_id: crypto.randomUUID(), counterparty_type: 'agent' }, 's-4');
    await ac.commitReservation(r2.reservation_id);
    console.log('ZERO-ADDRESS: unexpectedly committed');
  } catch (e) { console.log('ZERO-ADDRESS rejected:', (e as any).code); }
}
main();
