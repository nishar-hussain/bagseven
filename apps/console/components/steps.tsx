'use client';

import { useState } from 'react';
import { ConsoleClient } from '../lib/client';
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
  const [orgName, setOrgName] = useState('');
  const [agentName, setAgentName] = useState('');
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
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Acme Research" />
        </Field>
        <Field label="Agent name">
          <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. DeFi Treasury Agent" />
        </Field>
      </div>
      <Field label="Capabilities (comma separated)">
        <Input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} />
      </Field>
      <Button disabled={busy !== null || !orgName.trim() || !agentName.trim()} onClick={bootstrap}>
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
      await client.provisionWallet(session.agentId, 'sepolia');
      const next = await refresh(session);
      persist(next);
      toast('ok', 'Wallet provisioned');
      if (!next.walletId) throw new Error('wallet not returned');
      if (!session.walletId) onNext();
    });

  const fund = () =>
    run(`fund USDC ${fundAmount}`, async () => {
      if (!session.walletId) throw new Error('provision a wallet first');
      try {
        await client.creditWallet(session.walletId, 'USDC', fundAmount);
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          throw new Error('This wallet no longer exists in the backend (data was reset). Click "Reset session" in the sidebar and start fresh.', { cause: err });
        }
        throw err;
      }
      persist(await refresh(session));
      toast('ok', `Credited ${fundAmount} USDC`);
    });

  return (
    <Card title="Wallet & funds" action={<AgentBar session={session} />}>
      <p className="section-hint">
        Provisions a treasury wallet on <code>sepolia</code> (dev signer) and credits test USDC via the dev
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
        allowed_chains: ['sepolia'],
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
  const [counterparty, setCounterparty] = useState(session.payeeAgent?.id ?? crypto.randomUUID());

  const propose = (amt: string, label: string, idemKey: string, cat = category) =>
    run(`spend intent · ${label} (${amt} USDC)`, async () => {
      const d = await client.spendIntent(
        {
          agent_id: session.agentId,
          amount: amt,
          currency: 'USDC',
          category: cat,
          chain: 'sepolia',
          counterparty_id: counterparty,
        },
        idemKey,
      );
      const record: SpendRecord = {
        at: new Date().toISOString().slice(11, 19),
        amount: amt,
        category: cat,
        chain: 'sepolia',
        counterparty_id: counterparty,
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

export function StepMarketplace(props: StepProps) {
  const { session, client, busy, persist, run, toast } = props;
  const demoUrl = process.env.NEXT_PUBLIC_DEMO_PROVIDER_URL ?? 'http://localhost:4007';
  const demoPayout = process.env.NEXT_PUBLIC_DEMO_PAYOUT ?? '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
  const [tools, setTools] = useState<Array<{ id: string; name: string; category: string; price: string; provider: { name: string } }>>([]);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [toolInput, setToolInput] = useState('{"position":"aave-wbtc-2x"}');
  const [lastExec, setLastExec] = useState<string | null>(null);

  const seed = () =>
    run('seed demo marketplace', async () => {
      const provider = await client.registerProvider({
        name: 'Demo Data Provider',
        payout_wallet_address: demoPayout,
        payout_chain: 'sepolia',
      });
      await client.approveProvider(provider.provider_id);
      await client.createTool(provider.provider_token, {
        provider_id: provider.provider_id,
        name: 'liquidation-risk',
        description: 'Returns liquidation risk score for a position',
        category: 'trading',
        price: '0.10',
        price_token: 'USDC',
        endpoint_url: `${demoUrl}/v1/exec`,
      });
      const disc = await client.listTools({});
      setTools(disc.tools);
      setSelectedTool(disc.tools[0]?.id ?? '');
      toast('ok', 'Demo provider + tool seeded');
    });

  const refreshTools = () =>
    run('refresh tool list', async () => {
      const disc = await client.listTools({});
      setTools(disc.tools);
      toast('info', `${disc.tools.length} tools available`);
    });

  const execute = () =>
    run('execute paid tool', async () => {
      if (!session.agentId) throw new Error('create an agent first (step 1)');
      if (!selectedTool) throw new Error('seed or refresh the marketplace first');
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(toolInput);
      } catch {
        throw new Error('tool input must be valid JSON');
      }
      const tool = tools.find((t) => t.id === selectedTool)!;
      const res = await client.executeTool(selectedTool, session.agentId, input, `tool-${Date.now()}`);
      setLastExec(JSON.stringify(res.output, null, 2));
      persist({ ...session, toolExecutions: (session.toolExecutions ?? 0) + 1, lastToolExecution: { id: res.execution_id, name: tool.name, price: res.price_paid, txHash: res.tx_hash, output: JSON.stringify(res.output) } });
      toast('ok', `Tool "${tool.name}" executed — paid ${res.price_paid} USDC`);
    });

  return (
    <Card title="Tool marketplace" action={<AgentBar session={session} />}>
      <p className="section-hint">
        Browse paid tools and execute one — the call is <b>policy-checked, paid via x402, and settled on-chain</b> to the
        provider&apos;s registered payout address. The demo provider returns a real result only after verifying the
        payment on-chain.
      </p>
      <div className="btn-row">
        <Button disabled={busy !== null} onClick={seed}>
          {busy ? 'Working…' : 'Seed demo provider + tool ($0.10)'}
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={refreshTools}>
          Refresh tools
        </Button>
      </div>

      {tools.length > 0 && (
        <>
          <div className="divider" />
          <Field label="Tool">
            <Select value={selectedTool} onChange={(e) => setSelectedTool(e.target.value)}>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.category} · ${t.price} · {t.provider.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Input (JSON)">
            <Input value={toolInput} onChange={(e) => setToolInput(e.target.value)} />
          </Field>
          <Button disabled={busy !== null || !session.agentId} onClick={execute}>
            {busy ? 'Working…' : 'Execute & pay'}
          </Button>
        </>
      )}

      {session.lastToolExecution && (
        <CodeBlock>
          tool: {session.lastToolExecution.name}
          {'\n'}price_paid: {session.lastToolExecution.price} USDC
          {'\n'}tx_hash: {session.lastToolExecution.txHash}
          {'\n'}output: {session.lastToolExecution.output}
        </CodeBlock>
      )}
      {lastExec && <div className="output">{lastExec}</div>}
    </Card>
  );
}

export function StepSettle(props: StepProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [cpType, setCpType] = useState<'agent' | 'tool_provider' | 'data_provider'>('agent');

  const refresh = (s: Session) =>
    client.getWallet(s.agentId).then((w) => ({ ...s, balances: w.wallets[0]?.balances ?? [] }));

  const createPayee = () =>
    run('create payee agent (real recipient)', async () => {
      if (!session.orgId || !session.guardianId || !session.guardianToken) throw new Error('create an agent first (step 1)');
      const payeeRaw = await client.createAgent({
        owner_org_id: session.orgId,
        guardian_id: session.guardianId,
        display_name: 'Payee Agent',
        capabilities: [],
      });
      await client.confirmAgent(payeeRaw.agent_id, session.guardianToken);
      const payeeClient = new ConsoleClient(client.url);
      payeeClient.setAgent(payeeRaw.agent_id, payeeRaw.signing_private_key_pem);
      const w = await payeeClient.provisionWallet(payeeRaw.agent_id, 'sepolia');
      persist({ ...session, payeeAgent: { id: payeeRaw.agent_id, address: w.wallet.address } });
      toast('ok', 'Payee agent created — propose to it in Step 4, then come back to settle');
    });

  const doReserveAndCommit = async (token: string, decision: Session['lastDecision'] & { counterparty_id: string; amount: string }) => {
    if (!session.walletId) throw new Error('provision a wallet first (step 2)');
    let res: { reservation_id: string };
    try {
      res = await client.reserve(
        {
          wallet_id: session.walletId,
          token: 'USDC',
          amount: decision.amount,
          spend_token: token,
          counterparty_id: decision.counterparty_id,
          counterparty_type: cpType,
        },
        `reserve-${Date.now()}`,
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'INSUFFICIENT_FUNDS') {
        throw new Error(
          `Wallet has insufficient USDC — fund it in Step 2 (Credit) before settling. (available: ${session.balances.find((b) => b.token === 'USDC')?.amount ?? 0})`,
          { cause: err },
        );
      }
      if ((err as { code?: string }).code === 'UNRESOLVABLE_PAYEE') {
        throw new Error('That spend has no real recipient — create a payee agent below, re-propose to it in Step 4, then settle again.', { cause: err });
      }
      throw err;
    }
    // Token is single-use: consume it immediately so the button can't reuse it.
    const consumed: Session = { ...session, lastDecision: { ...decision, spend_token: undefined } };
    const commit = await client.commitReservation(res.reservation_id);
    const receipts = await client.getAgentReceipts(session.agentId);
    const next = {
      ...consumed,
      reservationId: res.reservation_id,
      txHash: commit.tx_hash,
      receiptId: receipts.receipts[0]?.id,
    };
    persist(await refresh(next));
    toast('ok', `Settled ${decision.amount} USDC — tx ${commit.tx_hash.slice(0, 12)}…`);
  };

  const settle = () =>
    run('reserve + commit', async () => {
      const decision = session.lastDecision;
      if (!decision?.spend_token) throw new Error('get an allow decision first (step 4)');
      if (!decision.counterparty_id) throw new Error('the allow decision is missing its counterparty — re-propose in step 4');
      try {
        await doReserveAndCommit(decision.spend_token, decision);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'SPEND_TOKEN_EXPIRED') throw err;
        // The 30s token expired — seamlessly mint a fresh one for the SAME intent,
        // then retry. The expired token's budget was already released by the treasury.
        toast('info', 'Token expired — refreshing…');
        const fresh = await client.spendIntent(
          {
            agent_id: session.agentId,
            amount: decision.amount,
            currency: 'USDC',
            category: decision.category,
            chain: decision.chain,
            counterparty_id: decision.counterparty_id,
          },
          `refresh-${Date.now()}`,
        );
        if (fresh.decision !== 'allow' || !fresh.spend_token) {
          throw new Error(`re-proposal denied: ${fresh.reason ?? fresh.decision}`, { cause: err });
        }
        const refreshed: Session = {
          ...session,
          lastDecision: { ...decision, decision_id: fresh.decision_id, spend_token: fresh.spend_token, idemKey: `refresh-${Date.now()}` },
        };
        persist(refreshed);
        await doReserveAndCommit(fresh.spend_token, refreshed.lastDecision as Session['lastDecision'] & { counterparty_id: string; amount: string });
      }
    });

  const hasValidPayee =
    !!session.payeeAgent && !!session.lastDecision && session.lastDecision.counterparty_id === session.payeeAgent.id;

  return (
    <Card title="Reserve & settle" action={<AgentBar session={session} />}>
      <p className="section-hint">
        Presents the last <code>spend_token</code> to the treasury — the only thing it will co-sign against — then
        settles: debit payer → credit payee → hash-chained receipt.
      </p>
      <p className="section-hint" style={{ marginTop: -8 }}>
        <span className="pill warn">single-use · 30s expiry</span> If the token expired while you read this, the
        console mints a fresh one automatically and retries.
      </p>

      <div className="card-title" style={{ marginTop: 6 }}>
        <h3>Recipient</h3>
      </div>
      {session.payeeAgent ? (
        <CodeBlock>
          payee_agent : {session.payeeAgent.id} <Copy value={session.payeeAgent.id} />
          {'\n'}payee_address: {session.payeeAgent.address}
        </CodeBlock>
      ) : (
        <p className="section-hint">
          The payment must go to a real agent&apos;s wallet — not a random id. Create a payee below, then in <b>Step
          4</b> propose the spend to its id (it&apos;s pre-filled), then settle here.
        </p>
      )}
      {!session.payeeAgent && (
        <Button variant="ghost" disabled={busy !== null} onClick={createPayee}>
          {busy ? 'Working…' : 'Create a payee agent'}
        </Button>
      )}
      {session.payeeAgent && !hasValidPayee && (
        <p className="section-hint">
          <span className="pill warn">re-propose needed</span> Your last spend intent was not made to the payee — go to{' '}
          <b>Step 4</b>, click <b>Propose</b> (the payee id is pre-filled), then return here.
        </p>
      )}
      <div className="divider" />

      <Field label="Counterparty type">
        <Select value={cpType} onChange={(e) => setCpType(e.target.value as 'agent')}>
          <option value="agent">agent</option>
          <option value="tool_provider">tool_provider</option>
          <option value="data_provider">data_provider</option>
        </Select>
      </Field>
      <Button disabled={busy !== null || !session.lastDecision?.spend_token || !hasValidPayee} onClick={settle}>
        {busy ? 'Working…' : 'Reserve & commit (uses last allow token)'}
      </Button>
      {session.lastDecision?.spend_token && !hasValidPayee && (
        <p className="section-hint">
          <span className="pill warn">blocked</span> Settle is disabled until your last allow is made to the payee
          (re-propose in Step 4).
        </p>
      )}
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