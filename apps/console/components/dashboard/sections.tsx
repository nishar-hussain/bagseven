'use client';

import { useEffect, useState } from 'react';
import { ConsoleClient } from '../../lib/client';
import { connectWallet, ensureSepolia, hasWallet, sendNative, sendUsdc, shortAddress } from '../../lib/wallet';
import type { Session } from '../../lib/types';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { MetricCard } from './metric-card';
import {
  ShieldCheck,
  Wallet as WalletIcon,
  FileCheck2,
  Coins,
  Send,
  Store,
  RefreshCw,
  Bot,
  UserPlus,
  Zap,
  Plus,
  CircleDollarSign,
  CheckCircle2,
  XCircle,
  Activity,
} from 'lucide-react';

export interface SectionProps {
  session: Session;
  client: ConsoleClient;
  busy: string | null;
  persist: (s: Session) => void;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs">{children}</span>;

/* ─────────────────────────── OVERVIEW ─────────────────────────── */

export function OverviewSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const usdc = session.balances.find((b) => b.token === 'USDC');
  const eth = session.balances.find((b) => b.token === 'ETH');
  const spent = session.spendHistory.filter((r) => r.decision === 'allow').length;

  const refresh = () =>
    run('refresh', async () => {
      if (!session.agentId) return;
      const w = await client.getWallet(session.agentId);
      persist({ ...session, balances: w.wallets[0]?.balances ?? session.balances });
      toast('ok', 'Refreshed balances');
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Agent status" value={session.agentStatus || '—'} hint={session.agentName || 'not created'} tone={session.agentStatus === 'active' ? 'success' : session.agentStatus ? 'warning' : 'default'} icon={ShieldCheck} delay={0} />
        <MetricCard title="USDC balance" value={usdc ? Number(usdc.amount).toFixed(2) : '0.00'} hint={usdc ? `${Number(usdc.reservedAmount).toFixed(2)} reserved` : undefined} icon={CircleDollarSign} delay={1} />
        <MetricCard title="ETH balance" value={eth ? Number(eth.amount).toFixed(4) : '0.00'} hint="gas" icon={WalletIcon} delay={2} />
        <MetricCard title="Policy" value={session.policy ? `v${session.policy.version}` : '—'} hint={session.policy ? `max tx $${session.policy.max_transaction}` : 'not set'} icon={FileCheck2} delay={3} />
      </div>

      {session.agentId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Agent</span>
              <Button variant="ghost" size="sm" onClick={refresh} disabled={busy !== null}><RefreshCw className="size-4" /> Refresh</Button>
            </CardTitle>
            <CardDescription>Live overview of the active agent</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary"><Bot className="size-3" /> {session.agentName || 'no agent'}</Badge>
              <Badge variant="accent">{session.agentStatus || 'pending'}</Badge>
              {session.walletAddress && <Badge variant="muted"><Mono>{session.walletAddress.slice(0, 10)}…{session.walletAddress.slice(-4)}</Mono></Badge>}
              {session.payeeAgent && <Badge variant="success">payee ready</Badge>}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div><div className="text-sm text-muted-foreground">Allow decisions</div><div className="text-2xl font-bold">{spent}</div></div>
              <div><div className="text-sm text-muted-foreground">Tool executions</div><div className="text-2xl font-bold">{session.toolExecutions ?? 0}</div></div>
              <div><div className="text-sm text-muted-foreground">Settlements</div><div className="text-2xl font-bold">{session.txHash ? '1 ✓' : '0'}</div></div>
            </div>
          </CardContent>
        </Card>
      )}

      {!session.agentId && (
        <Alert>
          <AlertTitle>Get started</AlertTitle>
          <AlertDescription>Go to <b>Identity</b> to create an agent, then fund it in <b>Wallet &amp; Funds</b>, publish a <b>Policy</b>, and try a <b>Spend Intent</b>.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/* ─────────────────────────── IDENTITY ─────────────────────────── */

export function IdentitySection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [orgName, setOrgName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [capabilities, setCapabilities] = useState('trading, data-purchase');

  const bootstrap = () =>
    run('bootstrap org + guardian + agent', async () => {
      const org = await client.createOrg(orgName);
      const guardian = await client.createGuardian({ type: 'human', org_id: org.organization.id });
      const agent = await client.createAgent({ owner_org_id: org.organization.id, guardian_id: guardian.guardian.id, display_name: agentName, capabilities: capabilities.split(',').map((c) => c.trim()).filter(Boolean) });
      const confirmed = await client.confirmAgent(agent.agent_id, guardian.guardian_token);
      client.setAgent(agent.agent_id, agent.signing_private_key_pem);
      persist({ ...session, orgId: org.organization.id, orgName, guardianId: guardian.guardian.id, guardianToken: guardian.guardian_token, agentId: agent.agent_id, agentName, apiKey: agent.api_key, signingKeyPem: agent.signing_private_key_pem, agentStatus: confirmed.agent.status });
      toast('ok', 'Agent created and confirmed');
    });

  const createPayee = () =>
    run('create payee agent (real recipient)', async () => {
      if (!session.orgId || !session.guardianId || !session.guardianToken) throw new Error('create an agent first');
      const payeeRaw = await client.createAgent({ owner_org_id: session.orgId, guardian_id: session.guardianId, display_name: 'Payee Agent', capabilities: [] });
      await client.confirmAgent(payeeRaw.agent_id, session.guardianToken);
      const payeeClient = new ConsoleClient(client.url);
      payeeClient.setAgent(payeeRaw.agent_id, payeeRaw.signing_private_key_pem);
      const w = await payeeClient.provisionWallet(payeeRaw.agent_id, 'sepolia');
      persist({ ...session, payeeAgent: { id: payeeRaw.agent_id, address: w.wallet.address } });
      toast('ok', 'Payee agent created');
    });

  return (
    <div className="space-y-6">
      {session.agentId ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-accent" /> Agent</CardTitle>
            <CardDescription>Registered identity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent">{session.agentStatus}</Badge>
              <Badge variant="secondary">{session.agentName}</Badge>
              <Badge variant="muted">{session.orgName}</Badge>
            </div>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">agent_id</span><Mono>{session.agentId}</Mono></div>
              <div className="flex justify-between"><span className="text-muted-foreground">api_key</span><Mono>{session.apiKey.slice(0, 18)}…</Mono></div>
              <div className="flex justify-between"><span className="text-muted-foreground">guardian_token</span><Mono>{session.guardianToken.slice(0, 14)}…</Mono></div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Payee agent</div>
                <div className="text-xs text-muted-foreground">{session.payeeAgent ? shortAddress(session.payeeAgent.address) : 'needed to settle payments'}</div>
              </div>
              {!session.payeeAgent ? (
                <Button variant="outline" size="sm" onClick={createPayee} disabled={busy !== null}><UserPlus className="size-4" /> Create payee</Button>
              ) : (
                <Badge variant="success">ready</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Create agent</CardTitle>
            <CardDescription>Register an agent under an organization with a guardian, then confirm it to active.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="org">Organization name</Label><Input id="org" placeholder="e.g. Acme Research" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="agent">Agent name</Label><Input id="agent" placeholder="e.g. DeFi Treasury Agent" value={agentName} onChange={(e) => setAgentName(e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="caps">Capabilities (comma separated)</Label><Input id="caps" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} /></div>
            <Button disabled={busy !== null || !orgName.trim() || !agentName.trim()} onClick={bootstrap}>
              <Plus className="size-4" /> {busy ? 'Working…' : 'Create & confirm agent'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────────── WALLET ─────────────────────────── */

export function WalletSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [fundAmount, setFundAmount] = useState(session.fundAmount ?? '10.00');
  const setFundPersist = (v: string) => { setFundAmount(v); persist({ ...session, fundAmount: v }); };

  const refresh = (s: Session) => client.getWallet(s.agentId).then((w) => ({ ...s, walletId: w.wallets[0]?.wallet.id, walletAddress: w.wallets[0]?.wallet.address, balances: w.wallets[0]?.balances ?? [] }));

  const provision = () =>
    run('provision wallet', async () => {
      await client.provisionWallet(session.agentId, 'sepolia');
      persist(await refresh(session));
      toast('ok', 'Wallet provisioned');
    });

  const connect = () =>
    run('connect my wallet', async () => {
      if (!hasWallet()) throw new Error('No browser wallet (MetaMask) detected — use the Dev faucet instead.');
      const address = await connectWallet();
      await ensureSepolia();
      persist({ ...session, userWallet: address });
      toast('ok', `Connected ${shortAddress(address)}`);
    });

  const fundFromWallet = () =>
    run(`fund ${fundAmount} USDC from my wallet`, async () => {
      if (!session.walletId) throw new Error('provision a wallet first');
      if (!session.userWallet) throw new Error('connect your wallet first');
      const gasEth = process.env.NEXT_PUBLIC_GAS_GRANT_ETH ?? '0.01';
      const txHash = await sendUsdc(session.userWallet, session.walletAddress!, fundAmount);
      try { await sendNative(session.userWallet, session.walletAddress!, gasEth); } catch { /* declined gas grant */ }
      toast('info', 'Transactions sent — waiting for confirmation…');
      let rec: { balances: Array<{ token: string; amount: string; reservedAmount: string }> } | null = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        rec = await client.reconcileWallet(session.walletId);
        const u = rec.balances.find((b) => b.token === 'USDC');
        if (u && Number(u.amount) >= Number(fundAmount)) break;
      }
      persist(await refresh({ ...session, balances: rec?.balances ?? session.balances }));
      const u = (rec?.balances ?? session.balances).find((b) => b.token === 'USDC');
      if (u && Number(u.amount) >= Number(fundAmount)) toast('ok', `Sent ${fundAmount} USDC (+ ${gasEth} ETH gas) — tx ${txHash.slice(0, 12)}…`);
      else toast('info', `Tx ${txHash.slice(0, 12)}… sent but not confirmed yet — reconcile again.`);
    });

  const devFaucet = () =>
    run(`fund USDC ${fundAmount}`, async () => {
      if (!session.walletId) throw new Error('provision a wallet first');
      await client.creditWallet(session.walletId, 'USDC', fundAmount);
      persist(await refresh(session));
      toast('ok', `Credited ${fundAmount} USDC (dev faucet)`);
    });

  return (
    <div className="space-y-6">
      {!session.walletId ? (
        <Card>
          <CardHeader><CardTitle>Wallet</CardTitle><CardDescription>Provision a treasury wallet on sepolia for the agent.</CardDescription></CardHeader>
          <CardContent><Button onClick={provision} disabled={busy !== null}><Plus className="size-4" /> {busy ? 'Working…' : 'Provision wallet'}</Button></CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><WalletIcon className="size-5 text-accent" /> Agent wallet</CardTitle>
              <CardDescription>Where the agent holds funds</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">address</span><Mono>{session.walletAddress}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">wallet_id</span><Mono>{session.walletId}</Mono></div>
              </div>
              <Separator />
              <div className="grid gap-2">
                {session.balances.map((b) => (
                  <div key={b.token} className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">{b.token}</span>
                    <div className="text-right">
                      <div className="text-lg font-bold">{Number(b.amount).toFixed(b.token === 'ETH' ? 4 : 2)}</div>
                      <div className="text-xs text-muted-foreground">{Number(b.reservedAmount).toFixed(b.token === 'ETH' ? 4 : 2)} reserved</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CircleDollarSign className="size-5 text-accent" /> Fund</CardTitle>
              <CardDescription>Credit from the dev faucet, or pay from your own wallet via a popup.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Fund amount (USDC)</Label><Input value={fundAmount} onChange={(e) => setFundPersist(e.target.value)} /></div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={devFaucet} disabled={busy !== null}><Zap className="size-4" /> {busy ? 'Working…' : 'Dev faucet'}</Button>
                {session.userWallet ? (
                  <Button variant="accent" onClick={fundFromWallet} disabled={busy !== null}><Send className="size-4" /> Send {fundAmount} USDC from my wallet</Button>
                ) : (
                  <Button variant="outline" onClick={connect} disabled={busy !== null}><WalletIcon className="size-4" /> Connect my wallet</Button>
                )}
              </div>
              {session.userWallet && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="accent">connected</Badge><Mono>{shortAddress(session.userWallet)}</Mono>
                </div>
              )}
              <Alert variant="warning">
                <AlertTitle>Gas</AlertTitle>
                <AlertDescription>Wallet funding also sends a small ETH gas grant so the agent can settle. The dev faucet does this automatically.</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── POLICY ─────────────────────────── */

export function PolicySection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [daily, setDaily] = useState('50.00');
  const [maxTx, setMaxTx] = useState('20.00');
  const [threshold, setThreshold] = useState('15.00');
  const [catBudget, setCatBudget] = useState('10.00');

  const create = () =>
    run('publish policy', async () => {
      const policy = await client.createPolicy({ agent_id: session.agentId, daily_budget: daily, max_transaction: maxTx, allowed_chains: ['sepolia'], allowed_categories: ['trading', 'data-purchase'], category_limits: { 'data-purchase': { daily_budget: catBudget, max_per_tx: '5.00' } }, human_approval_threshold: threshold, created_by: 'console' });
      persist({ ...session, policy: { policy_id: policy.policy_id, version: policy.version, daily_budget: daily, max_transaction: maxTx, category_limits: { 'data-purchase': { daily_budget: catBudget, max_per_tx: '5.00' } }, human_approval_threshold: threshold } });
      toast('ok', 'Policy published');
    });

  return (
    <div className="space-y-6">
      {session.policy ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileCheck2 className="size-5 text-accent" /> Active policy</CardTitle><CardDescription>Version {session.policy.version}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <div><div className="text-sm text-muted-foreground">Daily budget</div><div className="text-2xl font-bold">${session.policy.daily_budget}</div></div>
              <div><div className="text-sm text-muted-foreground">Max per tx</div><div className="text-2xl font-bold">${session.policy.max_transaction}</div></div>
              <div><div className="text-sm text-muted-foreground">Approval &gt;</div><div className="text-2xl font-bold">${session.policy.human_approval_threshold}</div></div>
            </div>
            <Separator />
            <div className="text-sm text-muted-foreground">Chains: sepolia · Categories: trading, data-purchase · data-purchase daily cap ${session.policy.category_limits?.['data-purchase']?.daily_budget}</div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Publish policy</CardTitle><CardDescription>Deterministic spending rules evaluated on every intent.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Daily budget</Label><Input value={daily} onChange={(e) => setDaily(e.target.value)} /></div>
              <div className="space-y-2"><Label>Max per transaction</Label><Input value={maxTx} onChange={(e) => setMaxTx(e.target.value)} /></div>
              <div className="space-y-2"><Label>Human approval threshold</Label><Input value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>data-purchase daily budget</Label><Input value={catBudget} onChange={(e) => setCatBudget(e.target.value)} /></div>
            <Button onClick={create} disabled={busy !== null || !session.agentId}><FileCheck2 className="size-4" /> {busy ? 'Working…' : 'Publish policy'}</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────────── SPEND ─────────────────────────── */

export function SpendSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [amount, setAmount] = useState(session.spendForm?.amount ?? '3.00');
  const [category, setCategory] = useState(session.spendForm?.category ?? 'data-purchase');
  const [counterparty, setCounterparty] = useState(session.spendForm?.counterparty ?? session.payeeAgent?.id ?? crypto.randomUUID());
  const pf = (a: string, cat: string, cp: string) => persist({ ...session, spendForm: { amount: a, category: cat, counterparty: cp } });

  const propose = (amt: string, label: string, idemKey: string, cat = category) =>
    run(`spend intent · ${label} (${amt} USDC)`, async () => {
      const d = await client.spendIntent({ agent_id: session.agentId, amount: amt, currency: 'USDC', category: cat, chain: 'sepolia', counterparty_id: counterparty }, idemKey);
      const rec = { at: new Date().toISOString().slice(11, 19), amount: amt, category: cat, chain: 'sepolia', counterparty_id: counterparty, decision: d.decision, reason: d.reason, decision_id: d.decision_id, idemKey, remaining: d.remaining_daily_budget };
      persist({ ...session, lastDecision: { ...rec, spend_token: d.spend_token }, spendHistory: [rec, ...session.spendHistory].slice(0, 25) });
      toast(d.decision === 'allow' ? 'ok' : 'info', `${amt} USDC ${d.decision}${d.reason ? ` — ${d.reason}` : ''}`);
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Coins className="size-5 text-accent" /> Spend intents</CardTitle>
          <CardDescription>The hot path — policy returns allow + spend_token, deny with a reason, or pending_approval above the threshold.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label>Amount (USDC)</Label><Input value={amount} onChange={(e) => { setAmount(e.target.value); pf(e.target.value, category, counterparty); }} /></div>
            <div className="space-y-2"><Label>Category</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v); pf(amount, v, counterparty); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data-purchase">data-purchase (cap $10)</SelectItem>
                  <SelectItem value="trading">trading</SelectItem>
                  <SelectItem value="gambling">gambling (not allowed)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Counterparty (uuid)</Label><Input value={counterparty} onChange={(e) => { setCounterparty(e.target.value); pf(amount, category, e.target.value); }} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => propose(amount, 'custom', `custom-${Date.now()}`)} disabled={busy !== null}><Zap className="size-4" /> Propose ${amount}</Button>
            <Button variant="outline" onClick={() => propose('500.00', 'over-limit', `over-${Date.now()}`)} disabled={busy !== null}>Test $500 → deny</Button>
            <Button variant="outline" onClick={() => propose('6.00', 'category cap', `cat-${Date.now()}`, 'data-purchase')} disabled={busy !== null}>Test $6 data → deny</Button>
          </div>
        </CardContent>
      </Card>

      {session.lastDecision && (
        <Card>
          <CardHeader><CardTitle>Last decision</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={session.lastDecision.decision === 'allow' ? 'success' : session.lastDecision.decision === 'deny' ? 'destructive' : 'warning'}>{session.lastDecision.decision}</Badge>
              {session.lastDecision.reason && <span className="text-sm text-muted-foreground">{session.lastDecision.reason}</span>}
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between"><span className="text-muted-foreground">decision_id</span><Mono>{session.lastDecision.decision_id}</Mono></div>
              <div className="flex justify-between"><span className="text-muted-foreground">remaining daily</span><Mono>{session.lastDecision.remaining ?? '—'}</Mono></div>
              <div className="flex justify-between sm:col-span-2"><span className="text-muted-foreground">spend_token</span><Mono>{session.lastDecision.spend_token ? session.lastDecision.spend_token.slice(0, 32) + '…' : '—'}</Mono></div>
            </div>
          </CardContent>
        </Card>
      )}

      {session.spendHistory.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Decision history</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>time</TableHead><TableHead>amount</TableHead><TableHead>category</TableHead><TableHead>decision</TableHead><TableHead>reason</TableHead></TableRow></TableHeader>
              <TableBody>
                {session.spendHistory.slice(0, 12).map((r, i) => (
                  <TableRow key={`${r.at}-${i}`}><TableCell className="text-muted-foreground">{r.at}</TableCell><TableCell className="font-mono">{r.amount}</TableCell><TableCell>{r.category}</TableCell><TableCell><Badge variant={r.decision === 'allow' ? 'success' : r.decision === 'deny' ? 'destructive' : 'warning'}>{r.decision}</Badge></TableCell><TableCell className="text-muted-foreground">{r.reason ?? `remaining ${r.remaining}`}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────────── SETTLE ─────────────────────────── */

export function SettleSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [cpType, setCpType] = useState<'agent' | 'tool_provider' | 'data_provider'>('agent');

  const refresh = (s: Session) => client.getWallet(s.agentId).then((w) => ({ ...s, balances: w.wallets[0]?.balances ?? [] }));

  useEffect(() => {
    if (!session.walletId || !session.agentId) return;
    let cancelled = false;
    (async () => {
      try { const rec = await client.reconcileWallet(session.walletId!); if (!cancelled) persist(await refresh({ ...session, balances: rec.balances })); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [session.walletId]);

  const createPayee = () =>
    run('create payee agent (real recipient)', async () => {
      if (!session.orgId || !session.guardianId || !session.guardianToken) throw new Error('create an agent first');
      const payeeRaw = await client.createAgent({ owner_org_id: session.orgId, guardian_id: session.guardianId, display_name: 'Payee Agent', capabilities: [] });
      await client.confirmAgent(payeeRaw.agent_id, session.guardianToken);
      const payeeClient = new ConsoleClient(client.url);
      payeeClient.setAgent(payeeRaw.agent_id, payeeRaw.signing_private_key_pem);
      const w = await payeeClient.provisionWallet(payeeRaw.agent_id, 'sepolia');
      persist({ ...session, payeeAgent: { id: payeeRaw.agent_id, address: w.wallet.address } });
      toast('ok', 'Payee agent created — propose to it in Spend, then settle');
    });

  const hasValidPayee = !!session.payeeAgent && !!session.lastDecision && session.lastDecision.counterparty_id === session.payeeAgent.id;

  const doReserveAndCommit = async (token: string, decision: Session['lastDecision'] & { counterparty_id: string; amount: string }) => {
    if (!session.walletId) throw new Error('provision a wallet first');
    let res: { reservation_id: string };
    try {
      res = await client.reserve({ wallet_id: session.walletId, token: 'USDC', amount: decision.amount, spend_token: token, counterparty_id: decision.counterparty_id, counterparty_type: cpType }, `reserve-${Date.now()}`);
    } catch (err) {
      const e = err as { code?: string; status?: number };
      if (e.code === 'INSUFFICIENT_FUNDS') throw new Error('Wallet has no USDC — fund it in Wallet & Funds (Dev faucet is reliable).', { cause: err });
      if (e.code === 'UNRESOLVABLE_PAYEE') throw new Error('That spend has no real recipient — create a payee, re-propose to it in Spend, then settle.', { cause: err });
      if (e.status === 404) throw new Error('Stale session — click Reset in Settings.', { cause: err });
      throw err;
    }
    const consumed: Session = { ...session, lastDecision: { ...decision, spend_token: undefined } };
    const commit = await client.commitReservation(res.reservation_id);
    const receipts = await client.getAgentReceipts(session.agentId);
    persist(await refresh({ ...consumed, reservationId: res.reservation_id, txHash: commit.tx_hash, receiptId: receipts.receipts[0]?.id }));
    toast('ok', `Settled ${decision.amount} USDC — tx ${commit.tx_hash.slice(0, 14)}…`);
  };

  const settle = () =>
    run('reserve + commit', async () => {
      const decision = session.lastDecision;
      if (!decision?.spend_token) throw new Error('get an allow decision first (Spend)');
      if (!decision.counterparty_id) throw new Error('the allow decision is missing its counterparty');
      try {
        await doReserveAndCommit(decision.spend_token, decision);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'SPEND_TOKEN_EXPIRED') throw err;
        toast('info', 'Token expired — refreshing…');
        const fresh = await client.spendIntent({ agent_id: session.agentId, amount: decision.amount, currency: 'USDC', category: decision.category, chain: decision.chain, counterparty_id: decision.counterparty_id }, `refresh-${Date.now()}`);
        if (fresh.decision !== 'allow' || !fresh.spend_token) throw new Error(`re-proposal denied: ${fresh.reason ?? fresh.decision}`, { cause: err });
        const refreshed: Session = { ...session, lastDecision: { ...decision, decision_id: fresh.decision_id, spend_token: fresh.spend_token, idemKey: `refresh-${Date.now()}` } };
        persist(refreshed);
        await doReserveAndCommit(fresh.spend_token, refreshed.lastDecision as Session['lastDecision'] & { counterparty_id: string; amount: string });
      }
    });

  const usdcEmpty = (session.balances.find((b) => b.token === 'USDC')?.amount ?? '0') === '0' || Number(session.balances.find((b) => b.token === 'USDC')?.amount ?? 0) <= 0;

  return (
    <div className="space-y-6">
      {usdcEmpty && (
        <Alert variant="warning"><AlertTitle>Wallet empty</AlertTitle><AlertDescription>This agent has no USDC — fund it in Wallet &amp; Funds (the Dev faucet is reliable).</AlertDescription></Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-accent" /> Recipient</CardTitle><CardDescription>The payment goes to a real agent's wallet — not a random id.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {session.payeeAgent ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">payee_agent</span><Mono>{session.payeeAgent.id}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">payee_address</span><Mono>{session.payeeAgent.address}</Mono></div>
              </div>
            ) : (
              <Button variant="outline" onClick={createPayee} disabled={busy !== null}><Plus className="size-4" /> Create a payee agent</Button>
            )}
            <Separator />
            <div className="space-y-2"><Label>Counterparty type</Label>
              <Select value={cpType} onValueChange={(v) => setCpType(v as typeof cpType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">agent</SelectItem>
                  <SelectItem value="tool_provider">tool_provider</SelectItem>
                  <SelectItem value="data_provider">data_provider</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Send className="size-5 text-accent" /> Reserve &amp; commit</CardTitle><CardDescription>Presents the last spend_token — the only thing the treasury co-signs against.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Last decision:</span>
              {session.lastDecision ? <Badge variant={session.lastDecision.decision === 'allow' ? 'success' : 'destructive'}>{session.lastDecision.decision}</Badge> : <Badge variant="muted">none</Badge>}
            </div>
            {session.payeeAgent && !hasValidPayee && session.lastDecision?.spend_token && (
              <Alert variant="warning"><AlertTitle>Re-propose needed</AlertTitle><AlertDescription>Your last allow wasn't made to the payee — re-propose in Spend (the payee id is pre-filled), then settle here.</AlertDescription></Alert>
            )}
            <Button variant="accent" size="lg" onClick={settle} disabled={busy !== null || !session.lastDecision?.spend_token || !hasValidPayee}>
              <CheckCircle2 className="size-4" /> {busy ? 'Working…' : 'Reserve & commit'}
            </Button>
            {session.txHash && (
              <div className="space-y-2 text-sm">
                <Separator />
                <div className="flex justify-between"><span className="text-muted-foreground">tx_hash</span><Mono>{session.txHash}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">receipt</span><Mono>{session.receiptId}</Mono></div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────── MARKETPLACE ─────────────────────────── */

export function MarketplaceSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const demoUrl = process.env.NEXT_PUBLIC_DEMO_PROVIDER_URL ?? 'http://localhost:4007';
  const demoPayout = process.env.NEXT_PUBLIC_DEMO_PAYOUT ?? '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
  const [tools, setTools] = useState<Array<{ id: string; name: string; category: string; price: string; provider: { name: string } }>>([]);
  const [selectedTool, setSelectedTool] = useState('');
  const [toolInput, setToolInput] = useState(session.marketplaceInput ?? '{"position":"aave-wbtc-2x"}');

  const seed = () =>
    run('seed demo marketplace', async () => {
      const provider = await client.registerProvider({ name: 'Demo Data Provider', payout_wallet_address: demoPayout, payout_chain: 'sepolia' });
      await client.approveProvider(provider.provider_id);
      await client.createTool(provider.provider_token, { provider_id: provider.provider_id, name: 'liquidation-risk', description: 'Returns liquidation risk score for a position', category: 'trading', price: '0.10', price_token: 'USDC', endpoint_url: `${demoUrl}/v1/exec` });
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
      if (!session.agentId) throw new Error('create an agent first');
      if (!selectedTool) throw new Error('seed or refresh the marketplace first');
      let input: Record<string, unknown>;
      try { input = JSON.parse(toolInput); } catch { throw new Error('tool input must be valid JSON'); }
      const tool = tools.find((t) => t.id === selectedTool)!;
      const res = await client.executeTool(selectedTool, session.agentId, input, `tool-${Date.now()}`);
      persist({ ...session, toolExecutions: (session.toolExecutions ?? 0) + 1, lastToolExecution: { id: res.execution_id, name: tool.name, price: res.price_paid, txHash: res.tx_hash, output: JSON.stringify(res.output) }, marketplaceInput: toolInput });
      toast('ok', `Tool "${tool.name}" executed — paid ${res.price_paid} USDC`);
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Store className="size-5 text-accent" /> Tool marketplace</CardTitle>
          <CardDescription>Browse paid tools and execute one — policy-checked, paid via x402, settled on-chain to the provider's registered payout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={seed} disabled={busy !== null}><Plus className="size-4" /> Seed demo provider + tool ($0.10)</Button>
            <Button variant="outline" onClick={refreshTools} disabled={busy !== null}><RefreshCw className="size-4" /> Refresh tools</Button>
          </div>
          {tools.length > 0 && (
            <>
              <div className="space-y-2"><Label>Tool</Label>
                <Select value={selectedTool} onValueChange={setSelectedTool}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tools.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} · {t.category} · ${t.price} · {t.provider.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Input (JSON)</Label><Input value={toolInput} onChange={(e) => { setToolInput(e.target.value); persist({ ...session, marketplaceInput: e.target.value }); }} /></div>
              <Button variant="accent" onClick={execute} disabled={busy !== null || !session.agentId}><Zap className="size-4" /> Execute &amp; pay</Button>
            </>
          )}
          {session.lastToolExecution && (
            <div className="space-y-2 text-sm">
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">{session.lastToolExecution.name}</Badge>
                <Badge variant="secondary">paid {session.lastToolExecution.price} USDC</Badge>
                {session.lastToolExecution.txHash && <Badge variant="muted"><Mono>{session.lastToolExecution.txHash.slice(0, 16)}…</Mono></Badge>}
              </div>
              <pre className="rounded-lg bg-muted/40 p-3 text-xs overflow-auto">{session.lastToolExecution.output}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── ACTIVITY ─────────────────────────── */

export function ActivitySection(props: SectionProps) {
  const { session } = props;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5 text-accent" /> Activity</CardTitle><CardDescription>Every platform call, newest first.</CardDescription></CardHeader>
      <CardContent>
        <div className="space-y-1">
          {session.spendHistory.map((r, i) => (
            <div key={`${r.at}-${i}`} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={r.decision === 'allow' ? 'success' : r.decision === 'deny' ? 'destructive' : 'warning'}>{r.decision}</Badge>
                <span className="font-mono">{r.amount} USDC</span>
                <span className="text-muted-foreground">{r.category}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{r.at}</span>
            </div>
          ))}
          {session.spendHistory.length === 0 && <p className="text-sm text-muted-foreground">No spend intents yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── SETTINGS ─────────────────────────── */

export function SettingsSection(props: SectionProps) {
  const { session, toast } = props;
  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Connection</CardTitle><CardDescription>Platform endpoints and session.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">gateway</span><Mono>{gateway}</Mono></div>
          <div className="flex justify-between"><span className="text-muted-foreground">agent</span><Mono>{session.agentId || 'none'}</Mono></div>
          <div className="flex justify-between"><span className="text-muted-foreground">wallet</span><Mono>{session.walletAddress || 'none'}</Mono></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Reset</CardTitle><CardDescription>Clear the local session and start fresh.</CardDescription></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => { localStorage.removeItem('agentos-console'); toast('info', 'Session reset — reload to start fresh'); setTimeout(() => location.reload(), 600); }}>
            <XCircle className="size-4" /> Reset session
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}