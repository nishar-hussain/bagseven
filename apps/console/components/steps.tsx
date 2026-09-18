'use client';

import { useState } from 'react';
import type { ConsoleClient } from '../lib/client';
import type { Session, SpendRecord } from '../lib/types';
import { Button, Card, CodeBlock, Copy, Field, Input, KV, Pill, Select, StatusPill } from './ui';

export interface StepProps {
  session: Session;
  client: ConsoleClient;
  busy: string | null;
  persist: (s: Session) => void;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
  onNext: () => void;
}

export function AgentBar({ session }: { session: Session }) {
  if (!session.agentId) return <p className="empty">No agent yet.</p>;
  return (
    <div className="flex">
      <span className="mono small">{session.agentName || session.agentId.slice(0, 12)}</span>
      <StatusPill status={session.agentStatus} />
    </div>
  );
}

export function StepBootstrap(props: StepProps) {
  const { session, client, busy, persist, run, toast, onNext } = props;
  const [orgName, setOrgName] = useState('Acme Research');
  const [agentName, setAgentName] = useState('DeFi Treasury Agent');
  const [capabilities, setCapabilities] = useState('trading, data-purchase');

  const bootstrap = () =>
    run('bootstrap org + guardian + agent', async () => {
      const org = await client.createOrg(orgName);
      const guardian = await client.createGuardian({ type: 'human', org_id: org.organization.id });
      const agent = await client.createAgent({
        owner_org_id: org.organization.id,
        guardian_id: guardian.guardian.id,
        display_name: agentName,
        capabilities: capabilities.split(',').map((c) => c.trim()).filter(Boolean),
      });
      const confirmed = await client.confirmAgent(agent.agent_id, guardian.guardian_token);
      client.setAgent(agent.agent_id, agent.signing_private_key_pem);
      persist({
        ...session,
        orgId: org.organization.id,
        orgName,
        guardianId: guardian.guardian.id,
        guardianToken: guardian.guardian_token,
        agentId: agent.agent_id,
        agentName,
        apiKey: agent.api_key,
        signingKeyPem: agent.signing_private_key_pem,
        agentStatus: confirmed.agent.status,
      });
      toast('ok', 'Agent created and confirmed');
      onNext();
    });

  return (
    <Card
      title="Create agent"
      action={<AgentBar session={session} />}
    >
      <p className="section-hint">
        Registers an agent under an organization with a guardian, then the guardian confirms it to{' '}
        <code>active</code>. The signing key shown is used by the browser to sign every request envelope.
      </p>
      <div className="grid-2">
        <Field label="Organization name">
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </Field>
        <Field label="Agent name">
          <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} />
        </Field>
      </div>
      <Field label="Capabilities (comma separated)">
        <Input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} />
      </Field>
      <Button disabled={busy !== null} onClick={bootstrap}>
        {busy ? 'Working…' : 'Create & confirm agent'}
      </Button>
      {session.agentId && (
        <CodeBlock>
          agent_id        {session.agentId} <Copy value={session.agentId} />
          {'\n'}status         {session.agentStatus}
          {'\n'}api_key        {session.apiKey.slice(0, 18)}… <Copy value={session.apiKey} />
          {'\n'}guardian_token {session.guardianToken.slice(0, 18)}… <Copy value={session.guardianToken} />
        </CodeBlock>
      )}
    </Card>
  );
}

export function StepWallet(props: StepProps) {
  const { session, client, busy, persist, run, toast, onNext } = props;
  const [fundAmount, setFundAmount] = useState('100.00');

  const refresh = (s: Session) =>
    client.getWallet(s.agentId).then((w) => {
      const first = w.wallets[0];
      return { ...s, walletId: first?.wallet.id, walletAddress: first?.wallet.address, balances: first?.balances ?? [] };
    });

  const provision = () =>
    run('provision wallet', async () => {
      await client.provisionWallet(session.agentId, 'base-sepolia');
      const next = await refresh(session);
      persist(next);
      toast('ok', 'Wallet provisioned');
      if (!next.walletId) throw new Error('wallet not returned');
      if (!session.walletId) onNext();
    });

  const fund = () =>
    run(`fund USDC ${fundAmount}`, async () => {
      if (!session.walletId) throw new Error('provision a wallet first');
      await client.creditWallet(session.walletId, 'USDC', fundAmount);
      persist(await refresh(session));
      toast('ok', `Credited ${fundAmount} USDC`);
    });

  return (
    <Card title="Wallet & funds" action={<AgentBar session={session} />}>
      <p className="section-hint">
        Provisions a treasury wallet on <code>base-sepolia</code> (dev signer) and credits test USDC via the dev
        faucet. The wallet is the only place an agent can hold funds.
      </p>
      {!session.walletId ? (
        <Button disabled={busy !== null} onClick={provision}>
          {busy ? 'Working…' : 'Provision wallet'}
        </Button>
      ) : (
        <>
          <div className="grid-2">
            <Field label="Fund amount (USDC)">
              <Input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
            </Field>
            <div className="flex" style={{ alignItems: 'flex-end' }}>
              <Button disabled={busy !== null} onClick={fund}>
                {busy ? 'Working…' : 'Credit (dev faucet)'}
              </Button>
            </div>
          </div>
          <CodeBlock>
            wallet_id  {session.walletId} <Copy value={session.walletId} />
            {'\n'}address    {session.walletAddress}
            {session.balances.map((b) => (
              <span key={b.token}>
                {'\n'}{b.token}: {b.amount} <span className="muted">(reserved {b.reservedAmount})</span>
              </span>
            ))}
          </CodeBlock>
        </>
      )}
    </Card>
  );
}

export function StepPolicy(props: StepProps) {
  const { session, client, busy, persist, run, toast, onNext } = props;
  const [daily, setDaily] = useState('50.00');
  const [maxTx, setMaxTx] = useState('20.00');
  const [threshold, setThreshold] = useState('15.00');
  const [catBudget, setCatBudget] = useState('10.00');
  const [catPerTx, setCatPerTx] = useState('5.00');

  const create = () =>
    run('publish policy', async () => {
      const policy = await client.createPolicy({
        agent_id: session.agentId,
        daily_budget: daily,
        max_transaction: maxTx,
        allowed_chains: ['base-sepolia'],
        allowed_categories: ['trading', 'data-purchase'],
        category_limits: { 'data-purchase': { daily_budget: catBudget, max_per_tx: catPerTx } },
        human_approval_threshold: threshold,
        created_by: 'console',
      });
      persist({
        ...session,
        policy: {
          policy_id: policy.policy_id,
          version: policy.version,
          daily_budget: daily,
          max_transaction: maxTx,
          category_limits: { 'data-purchase': { daily_budget: catBudget, max_per_tx: catPerTx } },
          human_approval_threshold: threshold,
        },
      });
      toast('ok', 'Policy published');
      onNext();
    });

  return (
    <Card title="Policy" action={<AgentBar session={session} />}>
      <p className="section-hint">
        Deterministic spending rules evaluated on every intent. Values below are the defaults you used in Phase 1
        verification — tweak and publish to see different behavior.
      </p>
      <div className="grid-3">
        <Field label="Daily budget">
          <Input value={daily} onChange={(e) => setDaily(e.target.value)} />
        </Field>
        <Field label="Max per transaction">
          <Input value={maxTx} onChange={(e) => setMaxTx(e.target.value)} />
        </Field>
        <Field label="Human approval threshold">
          <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="data-purchase · daily budget">
          <Input value={catBudget} onChange={(e) => setCatBudget(e.target.value)} />
        </Field>
        <Field label="data-purchase · max per tx">
          <Input value={catPerTx} onChange={(e) => setCatPerTx(e.target.value)} />
        </Field>
      </div>
      <Button disabled={busy !== null} onClick={create}>
        {busy ? 'Working…' : 'Publish policy'}
      </Button>
      {session.policy && (
        <CodeBlock>
          policy_id  {session.policy.policy_id} <Copy value={session.policy.policy_id} />
          {'\n'}version     v{session.policy.version}
          {'\n'}daily       {session.policy.daily_budget}  ·  max_tx {session.policy.max_transaction}  ·  approval &gt; {session.policy.human_approval_threshold}
          {'\n'}category    data-purchase: {session.policy.category_limits?.['data-purchase']?.daily_budget} daily / {session.policy.category_limits?.['data-purchase']?.max_per_tx} per tx
        </CodeBlock>
      )}
    </Card>
  );
}

export function StepSpend(props: StepProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [amount, setAmount] = useState('3.00');
  const [category, setCategory] = useState('data-purchase');
  const [counterparty, setCounterparty] = useState(crypto.randomUUID());

  const propose = (amt: string, label: string, idemKey: string, cat = category) =>
    run(`spend intent · ${label} (${amt} USDC)`, async () => {
      const d = await client.spendIntent(
        {
          agent_id: session.agentId,
          amount: amt,
          currency: 'USDC',
          category: cat,
          chain: 'base-sepolia',
          counterparty_id: counterparty,
        },
        idemKey,
      );
      const record: SpendRecord = {
        at: new Date().toISOString().slice(11, 19),
        amount: amt,
        category: cat,
        chain: 'base-sepolia',
        decision: d.decision,
        reason: d.reason,
        decision_id: d.decision_id,
        idemKey,
        remaining: d.remaining_daily_budget,
      };
      persist({
        ...session,
        lastDecision: { ...record, spend_token: d.spend_token },
        spendHistory: [record, ...session.spendHistory].slice(0, 25),
      });
      toast(d.decision === 'allow' ? 'ok' : 'info', `${amt} USDC ${d.decision}${d.reason ? ` — ${d.reason}` : ''}`);
    });

  const idemRetry = () => {
    const last = session.lastDecision;
    if (!last) return;
    void propose(last.amount, `retry ${last.amount} (same idempotency key)`, last.idemKey, last.category);
  };

  return (
    <Card title="Spend intents" action={<AgentBar session={session} />}>
      <p className="section-hint">
        The hot path — <code>POST /v1/spend-intents</code>. The policy engine returns{' '}
        <Pill tone="allow">allow</Pill> with a spend_token, <Pill tone="deny">deny</Pill> with a reason, or{' '}
        <Pill tone="pending_approval">pending_approval</Pill> above the human threshold. Retrying with the same
        idempotency key returns the identical decision.
      </p>
      <div className="grid-3">
        <Field label="Amount (USDC)">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="data-purchase">data-purchase (cat budget $10)</option>
            <option value="trading">trading</option>
            <option value="gambling">gambling (not allowed)</option>
          </Select>
        </Field>
        <Field label="Counterparty (uuid)">
          <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </Field>
      </div>
      <div className="btn-row">
        <Button disabled={busy !== null} onClick={() => propose(amount, 'custom', `custom-${Date.now()}`)}>
          {busy ? 'Working…' : `Propose $${amount}`}
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => propose('500.00', 'over-limit', `over-${Date.now()}`)}>
          Test $500 → deny
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => propose('6.00', 'category cap', `cat-${Date.now()}`, 'data-purchase')}>
          Test $6 data → deny (cat cap $5)
        </Button>
        <Button variant="ghost" disabled={busy !== null || !session.lastDecision} onClick={idemRetry}>
          Retry last (same key)
        </Button>
      </div>

      {session.lastDecision && (
        <>
          <div className="divider" />
          <KV k="last decision" v={<Pill tone={session.lastDecision.decision}>{session.lastDecision.decision}</Pill>} />
          <KV k="decision_id" v={<span>{session.lastDecision.decision_id.slice(0, 18)}… <Copy value={session.lastDecision.decision_id} /></span>} />
          <KV k="reason" v={session.lastDecision.reason ?? '—'} />
          <KV k="remaining daily" v={session.lastDecision.remaining ?? '—'} />
          <KV k="spend_token" v={session.lastDecision.spend_token ? session.lastDecision.spend_token.slice(0, 42) + '…' : '—'} />
        </>
      )}

      {session.spendHistory.length > 0 && (
        <>
          <div className="divider" />
          <h3 style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--muted)' }}>Decision history</h3>
          <table className="table">
            <thead>
              <tr>
                <th>time</th>
                <th>amount</th>
                <th>category</th>
                <th>decision</th>
                <th>reason / remaining</th>
              </tr>
            </thead>
            <tbody>
              {session.spendHistory.map((r, i) => (
                <tr key={i}>
                  <td className="mono muted">{r.at}</td>
                  <td className="mono">{r.amount}</td>
                  <td>{r.category}</td>
                  <td>
                    <Pill tone={r.decision}>{r.decision}</Pill>
                  </td>
                  <td className="muted small">{r.reason ?? `remaining ${r.remaining}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

export function StepSettle(props: StepProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [cpType, setCpType] = useState<'agent' | 'tool_provider' | 'data_provider'>('agent');

  const refresh = (s: Session) =>
    client.getWallet(s.agentId).then((w) => ({ ...s, balances: w.wallets[0]?.balances ?? [] }));

  const settle = () =>
    run('reserve + commit', async () => {
      if (!session.lastDecision?.spend_token) throw new Error('get an allow decision first (step 4)');
      if (!session.walletId) throw new Error('provision a wallet first (step 2)');
      const counterpartyId = crypto.randomUUID();
      const res = await client.reserve(
        {
          wallet_id: session.walletId,
          token: 'USDC',
          amount: session.lastDecision.amount,
          spend_token: session.lastDecision.spend_token,
          counterparty_id: counterpartyId,
          counterparty_type: cpType,
        },
        `reserve-${Date.now()}`,
      );
      const commit = await client.commitReservation(res.reservation_id);
      const receipts = await client.getAgentReceipts(session.agentId);
      const next = {
        ...session,
        reservationId: res.reservation_id,
        txHash: commit.tx_hash,
        receiptId: receipts.receipts[0]?.id,
      };
      persist(await refresh(next));
      toast('ok', `Settled ${session.lastDecision.amount} USDC — tx ${commit.tx_hash.slice(0, 12)}…`);
    });

  return (
    <Card title="Reserve & settle" action={<AgentBar session={session} />}>
      <p className="section-hint">
        Presents the last <code>spend_token</code> to the treasury — the only thing it will co-sign against — then
        settles: debit payer → credit payee → hash-chained receipt.
      </p>
      <Field label="Counterparty type">
        <Select value={cpType} onChange={(e) => setCpType(e.target.value as 'agent')}>
          <option value="agent">agent</option>
          <option value="tool_provider">tool_provider</option>
          <option value="data_provider">data_provider</option>
        </Select>
      </Field>
      <Button disabled={busy !== null || !session.lastDecision?.spend_token} onClick={settle}>
        {busy ? 'Working…' : 'Reserve & commit (uses last allow token)'}
      </Button>
      {session.txHash && (
        <CodeBlock>
          reservation  {session.reservationId} <Copy value={session.reservationId ?? ''} />
          {'\n'}tx_hash      {session.txHash} <Copy value={session.txHash} />
          {'\n'}receipt      {session.receiptId} <Copy value={session.receiptId ?? ''} />
          {session.balances.map((b) => (
            <span key={b.token}>
              {'\n'}{b.token}: {b.amount} <span className="muted">(reserved {b.reservedAmount})</span>
            </span>
          ))}
        </CodeBlock>
      )}
    </Card>
  );
}