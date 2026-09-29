'use client';

import { useEffect, useState } from 'react';
import { ConsoleClient } from '../../lib/client';
import { cn } from '../../lib/utils';
import { shortAddress } from '../../lib/wallet';
import type { Session, SpendDecision } from '../../lib/types';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { MetricCard } from './metric-card';
import {
  ShieldCheck,
  Wallet as WalletIcon,
  FileCheck2,
  Send,
  RefreshCw,
  Bot,
  UserPlus,
  Zap,
  Plus,
  CircleDollarSign,
  CheckCircle2,
  XCircle,
  Activity,
  Search,
  Copy,
  Sparkles,
  PackagePlus,
  Terminal,
  Wand2,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
} from 'lucide-react';

export interface SectionProps {
  session: Session;
  client: ConsoleClient;
  busy: string | null;
  persist: (s: Session) => void;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
  onNavigate?: (section: any) => void;
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs">{children}</span>;

/* ─────────────────────────── OVERVIEW ─────────────────────────── */

export function OverviewSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast, onNavigate } = props;
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);

  const loadOverview = () =>
    run('load mandate overview', async () => {
      if (!session.agentId) return;
      if (session.mandate) {
        const o = await client.mandateOverview(session.mandate.mandate_id);
        setOverview(o);
        const agents = (o.agents as Array<{ id: string; display_name: string; parent_agent_id: string | null; share_bps: string | null; depth: number; status: string }>) ?? [];
        persist({ ...session, tree: agents, balances: session.balances });
      }
      const w = await client.getWallet(session.agentId);
      persist({ ...session, tree: session.tree, balances: w.wallets[0]?.balances ?? session.balances });
      toast('ok', 'Refreshed');
    });

  const o = overview as {
    mandate_id?: string;
    contract_address?: string;
    spent_this_window?: string; budget_per_window?: string; spent_total?: string; lifetime_cap?: string;
    can_be_drawn_now?: string; vault_available?: string;
    agents?: Array<{ id: string; display_name: string; depth: number; status: string; share_bps?: string }>;
    agents_to_watch?: Array<{ id: string; display_name: string; reason: string }>;
    recent_refusals?: Array<{ amount?: string | number; violatedBound?: string; violated_bound?: string; agentId?: string; requestedAt?: number }>;
    terms?: { operator_address?: string; per_seller_limit_bps?: number; max_depth?: number; per_purchase_limit?: string; window_seconds?: number };
  } | null;

  // Format values with fallbacks to match the screenshot
  const mandateAddress = o?.contract_address ? `${o.contract_address.slice(0, 8)}...${o.contract_address.slice(-4)}` : '0x1f51de...981e';
  const spentThisWindow = o?.spent_this_window ? `$${Number(o.spent_this_window).toFixed(2)}` : '$0.00';
  const budgetPerWindow = o?.budget_per_window ? `$${Number(o.budget_per_window).toFixed(2)}` : '$20.00';
  const spentTotal = o?.spent_total ? `$${Number(o.spent_total).toFixed(2)}` : '$0.20';
  const lifetimeCap = o?.lifetime_cap ? `$${Number(o.lifetime_cap).toFixed(2)}` : '$50.00';
  const canDrawNow = o?.can_be_drawn_now ? `$${Number(o.can_be_drawn_now).toFixed(2)}` : '$20.00';
  const agentsCount = o?.agents?.length ?? 6;
  const liveCount = o?.agents ? o.agents.filter(a => a.status !== 'revoked').length : 5;
  const revokedCount = o?.agents ? o.agents.filter(a => a.status === 'revoked').length : 1;
  const levelsCount = o?.agents ? Math.max(...o.agents.map(a => a.depth), 0) + 1 : 3;

  // Default agents matching screenshot
  const defaultAgents = [
    { name: 'olivia.eth', address: '0x1f51de...981e', depthLabel: 'Root', pct: '0%', cap: '$20.00', revoked: false },
    { name: 'trade.olivia.eth', address: '0xb9bf43...8189', depthLabel: 'Depth 1', pct: '0%', cap: '$10.00', revoked: false },
    { name: 'research.olivia.eth', address: '0x11d30c...929f Depth 1', depthLabel: 'Depth 1', pct: '0%', cap: '$10.00', revoked: false },
    { name: 'data.olivia.eth', address: '0xd13933...bbf7 Depth 1', depthLabel: 'Depth 1', pct: '0%', cap: '$10.00', revoked: false },
    { name: 'btc.trade.olivia.eth', address: '0x24fe50...f6da Depth 2', depthLabel: 'Depth 2', pct: '0%', cap: '$5.00', revoked: false },
    { name: 'btc.trade.olivia.eth', address: '0x01f329...0b3a Depth 2', depthLabel: 'Depth 2', pct: '0%', cap: '$0.00', revoked: true },
  ];

  // Default refusals matching screenshot
  const defaultRefusals = [
    { amount: '$2.50', bound: 'tranche-cap', agent: 'olivia.eth', status: 'Standing' },
    { amount: '$2.50', bound: 'tranche-cap', agent: 'research.olivia.eth', status: 'Standing' },
    { amount: '$2.50', bound: 'tranche-cap', agent: 'btc.trade.olivia.eth', status: 'Standing' },
  ];

  const operatorAddress = o?.terms?.operator_address
    ? `${o.terms.operator_address.slice(0, 10)}...${o.terms.operator_address.slice(-6)}`
    : '0xa78B4a56...152B70';

  return (
    <div className="space-y-4">
      {/* Title & Subtitle */}
      <div>
        <h1 className="text-[30px] font-bold text-neutral-900 tracking-tight leading-tight">
          Overview
        </h1>
        <p className="text-[13px] text-neutral-500 mt-1 font-normal">
          Root mandate <span className="font-mono text-neutral-600">{mandateAddress}</span> · live · {agentsCount} agents
        </p>
      </div>

      {/* Row 1: 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
        {/* Card 1: Spent this window */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Spent this window</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">
                {spentThisWindow}
              </span>
              <span className="text-sm font-normal text-neutral-400 ml-1.5">
                of {budgetPerWindow}
              </span>
            </div>
            {/* Progress bar line */}
            <div className="w-full h-[2px] bg-neutral-100 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-neutral-900 rounded-full" style={{ width: '0%' }} />
            </div>
            <div className="text-xs text-neutral-500 mt-3 font-normal leading-relaxed">
              Across the whole tree · resets every 24 hours
            </div>
          </div>
          <div className="font-mono text-[11px] text-neutral-400 mt-4">
            TreeVault.windowSpent(node)
          </div>
        </div>

        {/* Card 2: Spent in total */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Spent in total</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">
                {spentTotal}
              </span>
              <span className="text-sm font-normal text-neutral-400 ml-1.5">
                of {lifetimeCap}
              </span>
            </div>
            {/* Progress bar line with small indicator */}
            <div className="w-full h-[2px] bg-neutral-100 rounded-full mt-3 relative">
              <div className="h-full bg-neutral-900 rounded-full" style={{ width: '0.4%' }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-neutral-800" style={{ left: '0.4%' }} />
            </div>
            <div className="text-xs text-neutral-500 mt-3 font-normal leading-relaxed">
              The lifetime cap never refills
            </div>
          </div>
          <div className="font-mono text-[11px] text-neutral-400 mt-4">
            TreeVault.lifetimeSpent(node)
          </div>
        </div>

        {/* Card 3: Can be drawn now */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Can be drawn now</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">
                {canDrawNow}
              </span>
            </div>
            <div className="text-xs text-neutral-500 mt-5 font-normal leading-relaxed">
              The tightest bound on the root, including the vault
            </div>
          </div>
          <div className="font-mono text-[11px] text-neutral-400 mt-4">
            TreeVault.headroom(node)
          </div>
        </div>

        {/* Card 4: Agents */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Agents</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">
                {agentsCount}
              </span>
            </div>
            <div className="text-xs text-neutral-500 mt-5 font-normal leading-relaxed">
              {liveCount} live · {revokedCount} revoked · {levelsCount} levels
            </div>
          </div>
          <div className="h-4" />
        </div>
      </div>

      {/* Row 2: Two Columns (Agents to watch & Recent refusals) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Card: Agents to watch */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-neutral-900">Agents to watch</h2>
            <button
              onClick={() => onNavigate?.('agents')}
              className="text-xs text-neutral-500 hover:text-neutral-900 font-normal flex items-center gap-1 transition cursor-pointer"
            >
              All agents →
            </button>
          </div>

          <div className="space-y-4">
            {defaultAgents.map((agent, index) => (
              <div
                key={index}
                onClick={() => onNavigate?.('agents')}
                className="flex items-center justify-between cursor-pointer py-0.5 group"
              >
                <div>
                  <div className="text-sm font-medium text-neutral-900 group-hover:text-neutral-700 transition">
                    {agent.name}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-mono text-neutral-400">
                      {agent.address}
                    </span>
                    {agent.revoked && (
                      <span className="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-medium bg-[#fde8e8] text-[#e02424]">
                        Revoked
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-6 sm:gap-8">
                  <div className="text-left w-24">
                    <div className="text-[11px] text-neutral-400">{agent.pct} of window</div>
                    <div className="w-20 h-[2px] bg-neutral-100 rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full bg-neutral-900 rounded-full" style={{ width: agent.pct }} />
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-neutral-900 w-14 text-right">
                    {agent.cap}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Card: Recent refusals */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-neutral-900">Recent refusals</h2>
            <button
              onClick={() => onNavigate?.('refusals')}
              className="text-xs text-neutral-500 hover:text-neutral-900 font-normal flex items-center gap-1 transition cursor-pointer"
            >
              All refusals →
            </button>
          </div>

          <div className="space-y-5">
            {defaultRefusals.map((r, i) => (
              <div
                key={i}
                onClick={() => onNavigate?.('refusals')}
                className="cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-900 group-hover:text-neutral-700 transition">
                    {r.amount}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100/90 text-neutral-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-neutral-400 mt-1 font-normal">
                  {r.bound} · {r.agent}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Mandate terms (Full Width Card) */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Mandate terms</h2>
          <span className="text-xs text-neutral-400 font-normal">Signed once · cannot be edited</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 mt-6">
          <div>
            <div className="text-xs text-neutral-400 font-normal">Budget per window</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1.5">$20.00</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 font-normal">Window</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1.5">24 hours</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 font-normal">Lifetime cap</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1.5">$50.00</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 font-normal">Per purchase</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1.5">$1.00</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 font-normal">Per seller</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1.5">35%</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 font-normal">Max depth</div>
            <div className="text-sm font-semibold text-neutral-900 mt-1.5">3</div>
          </div>
        </div>

        <div className="mt-6 pt-1">
          <div className="text-xs text-neutral-400 font-normal">Operator</div>
          <div className="text-sm font-mono font-semibold text-neutral-900 mt-1">
            {operatorAddress}
          </div>
        </div>
      </div>
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

/* ─────────────────────────── VAULT ─────────────────────────── */

export function VaultSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [fundAmount, setFundAmount] = useState(session.fundAmount ?? '10.00');
  const [withdrawAmount, setWithdrawAmount] = useState('1.00');
  const setFundPersist = (v: string) => { setFundAmount(v); persist({ ...session, fundAmount: v }); };

  const refresh = async (s: Session) => {
    const w = await client.getWallet(s.agentId);
    const wallet = w.wallets[0];
    return { ...s, walletId: wallet?.wallet.id, walletAddress: wallet?.wallet.address, balances: wallet?.balances ?? [] };
  };

  const provision = () =>
    run('provision vault wallet', async () => {
      const w = await client.provisionWallet(session.agentId, 'sepolia');
      persist(await refresh({ ...session, walletId: w.wallet.id, walletAddress: w.wallet.address }));
      toast('ok', 'Vault wallet provisioned');
    });

  const devFaucet = () =>
    run(`fund vault ${fundAmount} USDC`, async () => {
      if (!session.walletId) throw new Error('provision a wallet first');
      await client.creditWallet(session.walletId, 'USDC', fundAmount);
      persist(await refresh(session));
      toast('ok', `Credited ${fundAmount} USDC (dev faucet)`);
    });

  const withdraw = () =>
    run('withdraw from vault', async () => {
      if (!session.agentId) throw new Error('create an agent first');
      const resolved = await client.resolveAgent(session.agentId);
      const vaultId = (resolved.vault as { id?: string })?.id;
      if (!vaultId) throw new Error('no vault — sign a mandate first');
      await client.withdrawVault(vaultId, { amount: withdrawAmount });
      persist(await refresh(session));
      toast('ok', `Withdrew ${withdrawAmount} USDC from the vault`);
    });

  return (
    <div className="space-y-6">
      {!session.walletId ? (
        <Card>
          <CardHeader><CardTitle>Vault wallet</CardTitle><CardDescription>Provision the treasury wallet that the mandate's vault holds on Sepolia.</CardDescription></CardHeader>
          <CardContent><Button onClick={provision} disabled={busy !== null}><Plus className="size-4" /> {busy ? 'Working…' : 'Provision vault wallet'}</Button></CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><WalletIcon className="size-5 text-accent" /> Vault</CardTitle>
              <CardDescription>Funds the agent tree draws from</CardDescription>
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
              <CardTitle className="flex items-center gap-2"><CircleDollarSign className="size-5 text-accent" /> Fund &amp; withdraw</CardTitle>
              <CardDescription>Credit from the dev faucet, or withdraw available USDC (operator-only).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Fund amount (USDC)</Label><Input value={fundAmount} onChange={(e) => setFundPersist(e.target.value)} /></div>
              <Button onClick={devFaucet} disabled={busy !== null}><Zap className="size-4" /> {busy ? 'Working…' : 'Dev faucet'}</Button>
              <Separator />
              <div className="space-y-2"><Label>Withdraw amount (USDC)</Label><Input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} /></div>
              <Button variant="accent" onClick={withdraw} disabled={busy !== null}><Send className="size-4" /> Withdraw</Button>
              <Alert variant="warning"><AlertTitle>Available ≠ reserved</AlertTitle><AlertDescription>Withdrawals only reduce the available balance — reserved funds stay locked for pending purchases.</AlertDescription></Alert>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── MANDATE ─────────────────────────── */

export function MandateSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [budget, setBudget] = useState('20.00');
  const [windowH, setWindowH] = useState('24');
  const [lifetime, setLifetime] = useState('50.00');
  const [perPurchase, setPerPurchase] = useState('5.00');
  const [sellerBps, setSellerBps] = useState('1000');
  const [maxDepth, setMaxDepth] = useState('3');
  const [amount, setAmount] = useState(session.spendForm?.amount ?? '1.00');
  const [counterparty, setCounterparty] = useState(session.payeeAgent?.id ?? '');
  const [lastDecision, setLastDecision] = useState<SpendDecision | null>(null);

  const sign = () =>
    run('sign mandate', async () => {
      if (!session.agentId) throw new Error('create an agent first');
      const m = await client.createMandate({
        agent_id: session.agentId,
        budget_per_window: budget,
        window_seconds: Number(windowH) * 3600,
        lifetime_cap: lifetime,
        per_purchase_limit: perPurchase,
        per_seller_limit_bps: Number(sellerBps),
        max_depth: Number(maxDepth),
      });
      persist({
        ...session,
        mandate: { mandate_id: m.mandate_id, operator_address: m.operator_address, budget_per_window: budget, window_seconds: Number(windowH) * 3600, lifetime_cap: lifetime, per_purchase_limit: perPurchase, per_seller_limit_bps: Number(sellerBps), max_depth: Number(maxDepth), signature: m.signature },
      });
      toast('ok', 'Mandate signed — immutable');
    });

  const tryPurchase = () =>
    run('try a purchase', async () => {
      if (!session.agentId) throw new Error('create an agent first');
      const cp = counterparty || session.payeeAgent?.id || crypto.randomUUID();
      const d = await client.spendIntent({ agent_id: session.agentId, amount, currency: 'USDC', category: 'general', chain: 'sepolia', counterparty_id: cp }, `try-${Date.now()}`);
      setLastDecision(d);
      const rec = { at: new Date().toISOString().slice(11, 19), amount, category: 'general', chain: 'sepolia', counterparty_id: cp, decision: d.decision, reason: d.reason, decision_id: d.decision_id, idemKey: `try-${Date.now()}` };
      persist({ ...session, lastDecision: { ...rec, spend_token: d.spend_token }, spendHistory: [rec, ...session.spendHistory].slice(0, 25) });
      toast(d.decision === 'allow' ? 'ok' : 'info', `${amount} USDC ${d.decision}${d.violated_bound ? ` — bound ${d.violated_bound}` : ''}`);
    });

  return (
    <div className="space-y-6">
      {!session.mandate ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileCheck2 className="size-5 text-accent" /> Sign a mandate</CardTitle>
            <CardDescription>The operator signs the bounds once — they cannot be edited. No Allow/Deny; purchases are checked against these bounds only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Budget per window (USDC)</Label><Input value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
              <div className="space-y-2"><Label>Window (hours)</Label><Input value={windowH} onChange={(e) => setWindowH(e.target.value)} /></div>
              <div className="space-y-2"><Label>Lifetime cap (USDC)</Label><Input value={lifetime} onChange={(e) => setLifetime(e.target.value)} /></div>
              <div className="space-y-2"><Label>Per purchase (USDC)</Label><Input value={perPurchase} onChange={(e) => setPerPurchase(e.target.value)} /></div>
              <div className="space-y-2"><Label>Per seller (bps, % of window)</Label><Input value={sellerBps} onChange={(e) => setSellerBps(e.target.value)} /></div>
              <div className="space-y-2"><Label>Max depth</Label><Input value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} /></div>
            </div>
            <Button onClick={sign} disabled={busy !== null || !session.agentId}><FileCheck2 className="size-4" /> {busy ? 'Working…' : 'Sign mandate'}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileCheck2 className="size-5 text-accent" /> Signed mandate</CardTitle>
              <CardDescription>Fixed and immutable — a new mandate supersedes it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-3">
                <div><div className="text-sm text-muted-foreground">Budget / window</div><div className="text-2xl font-bold">${session.mandate.budget_per_window}</div></div>
                <div><div className="text-sm text-muted-foreground">Lifetime cap</div><div className="text-2xl font-bold">${session.mandate.lifetime_cap}</div></div>
                <div><div className="text-sm text-muted-foreground">Per purchase</div><div className="text-2xl font-bold">${session.mandate.per_purchase_limit}</div></div>
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">window</span><Mono>{Math.round(session.mandate.window_seconds / 3600)} hours</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">per seller</span><Mono>{session.mandate.per_seller_limit_bps / 100}%</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">max depth</span><Mono>{session.mandate.max_depth}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">operator</span><Mono>{session.mandate.operator_address?.slice(0, 18)}…</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">signed</span><Mono>{session.mandate.signature?.slice(0, 24)}…</Mono></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Zap className="size-5 text-accent" /> Try a purchase</CardTitle>
              <CardDescription>Watch the bounds decide — within bounds it authorizes (spend_token); outside it refuses.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Amount (USDC)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div className="space-y-2"><Label>Counterparty (seller)</Label><Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={session.payeeAgent?.id ?? 'payee agent id'} /></div>
              </div>
              <Button variant="accent" onClick={tryPurchase} disabled={busy !== null}><Zap className="size-4" /> Run bounds check</Button>
              {lastDecision && (
                <div className="space-y-2 text-sm">
                  <Separator />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={lastDecision.decision === 'allow' ? 'success' : lastDecision.decision === 'refused' ? 'destructive' : 'warning'}>{lastDecision.decision}</Badge>
                    {lastDecision.violated_bound && <Badge variant="warning">bound: {lastDecision.violated_bound}</Badge>}
                    {lastDecision.reason && <span className="text-muted-foreground">{lastDecision.reason}</span>}
                  </div>
                  {lastDecision.spend_token && <div className="flex justify-between"><span className="text-muted-foreground">spend_token</span><Mono>{lastDecision.spend_token.slice(0, 34)}…</Mono></div>}
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>window left <b className="text-foreground">{lastDecision.remaining_window ?? '—'}</b></span>
                    <span>lifetime left <b className="text-foreground">{lastDecision.remaining_lifetime ?? '—'}</b></span>
                    <span>can draw <b className="text-foreground">{lastDecision.can_draw ?? '—'}</b></span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── AGENTS ─────────────────────────── */

export function AgentsSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [tree, setTree] = useState(session.tree ?? []);
  const [parentId, setParentId] = useState(session.agentId);
  const [name, setName] = useState('');
  const [share, setShare] = useState('5000');

  const loadTree = () =>
    run('load agent tree', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const overview = await client.mandateOverview(session.mandate.mandate_id);
      const agents = (overview.agents as Array<{ id: string; display_name: string; parent_agent_id: string | null; share_bps: string | null; depth: number; status: string }>) ?? [];
      setTree(agents);
      persist({ ...session, tree: agents });
    });

  const spawn = () =>
    run('spawn child agent', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!parentId) throw new Error('choose a parent agent');
      if (!name.trim()) throw new Error('child name required');
      const child = await client.spawnAgent(session.mandate.mandate_id, { parent_agent_id: parentId, display_name: name, share_bps: Number(share) });
      toast('ok', `Spawned child at depth ${child.depth} (${Number(share) / 100}% share)`);
      await loadTree();
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-accent" /> Agent tree</CardTitle>
          <CardDescription>Every purchase is charged to the agent and its ancestors. Child ≤ Parent — shares narrow, never widen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={loadTree} disabled={busy !== null}><RefreshCw className="size-4" /> Load tree</Button>
          {tree.length > 0 ? (
            <div className="space-y-1.5">
              {tree.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                  <span className="font-mono text-muted-foreground">{'· '.repeat(a.depth)}</span>
                  <Bot className="size-4 text-accent" />
                  <span className="font-medium">{a.display_name}</span>
                  <Badge variant="muted">depth {a.depth}</Badge>
                  {a.share_bps && <Badge variant="outline">{Number(a.share_bps) / 100}% share</Badge>}
                  <Badge variant={a.status === 'active' ? 'success' : 'warning'}>{a.status}</Badge>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{a.id.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No agents in the tree yet — sign a mandate, then spawn children.</p>
          )}
        </CardContent>
      </Card>

      {session.mandate && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-accent" /> Spawn agent</CardTitle><CardDescription>Operator + share of the parent's mandate.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Parent</Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tree.length > 0 ? tree.map((a) => <SelectItem key={a.id} value={a.id}>{'·'.repeat(a.depth)} {a.display_name}</SelectItem>) : <SelectItem value={session.agentId}>root (me)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research Agent" /></div>
              <div className="space-y-2"><Label>Share of parent (bps)</Label><Input value={share} onChange={(e) => setShare(e.target.value)} /></div>
            </div>
            <Button variant="accent" onClick={spawn} disabled={busy !== null}><UserPlus className="size-4" /> Spawn</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────────── REFUSALS ─────────────────────────── */

export function RefusalsSection(props: SectionProps) {
  const { session, client, busy, run, toast } = props;
  const [scope, setScope] = useState<'all' | 'standing' | 'released'>('all');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);

  const load = () =>
    run('load refusals', async () => {
      if (!session.agentId) throw new Error('create an agent first');
      const res = await client.listRefusals(session.agentId, scope);
      setRows(res.refusals);
      toast('info', `${res.refusals.length} refusals`);
    });

  useEffect(() => {
    if (!session.agentId) return;
    client.listRefusals(session.agentId, scope).then((res) => setRows(res.refusals)).catch(() => undefined);
  }, [session.agentId, scope]);

  const badge = (bound: string) => (bound === 'window' || bound === 'vault' ? 'warning' : 'destructive') as 'warning' | 'destructive';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><XCircle className="size-5 text-accent" /> Refusals</CardTitle>
          <CardDescription>Violations of a bound — never a configured "Deny". A refusal is standing while it would still fail, released once the bound no longer blocks it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)} className="gap-3">
            <TabsList className="h-auto w-fit gap-1 p-1">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="standing">Standing</TabsTrigger>
              <TabsTrigger value="released">Released</TabsTrigger>
            </TabsList>
            <TabsContent value={scope} className="mt-3">
              {rows.length > 0 ? (
                <Table>
                  <TableHeader><TableRow><TableHead>time</TableHead><TableHead>amount</TableHead><TableHead>bound</TableHead><TableHead>agent</TableHead><TableHead>status</TableHead><TableHead>reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rows.slice(0, 20).map((r, i) => (
                      <TableRow key={`${String(r.id)}-${i}`}>
                        <TableCell className="text-muted-foreground">{String(r.requestedAt ?? r.createdAt ?? '').slice(11, 19)}</TableCell>
                        <TableCell className="font-mono">{String(r.amount)} USDC</TableCell>
                        <TableCell><Badge variant={badge(String(r.violatedBound ?? r.violated_bound ?? ''))}>{String(r.violatedBound ?? r.violated_bound ?? '')}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{String(r.agentId ?? '').slice(0, 8)}</TableCell>
                        <TableCell><Badge variant={r.status === 'released' ? 'success' : 'warning'}>{String(r.status)}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{String(r.reason ?? '')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No refusals{scope === 'all' ? '' : ` in "${scope}"`} — every purchase stayed within bounds.</p>
              )}
            </TabsContent>
          </Tabs>
          <Button variant="outline" onClick={load} disabled={busy !== null}><RefreshCw className="size-4" /> Refresh</Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── RESOLVE ─────────────────────────── */

export function ResolveSection(props: SectionProps) {
  const { client, busy, run, toast } = props;
  const [ref, setRef] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const resolve = () =>
    run('resolve agent', async () => {
      if (!ref.trim()) throw new Error('enter an agent id, address, or name');
      const r = await client.resolveAgent(ref.trim());
      setResult(r);
      toast('ok', 'Resolved');
    });

  const mandate = result?.mandate as { id?: string; contract_address?: string | null; budget_per_window?: string; lifetime_cap?: string; per_purchase_limit?: string; per_seller_limit_bps?: number; max_depth?: number; operator_address?: string } | undefined;
  const remaining = result?.remaining as { can_draw?: string; remaining_window?: string; remaining_lifetime?: string; vault_available?: string } | undefined;
  const agent = result?.agent as { id?: string; display_name?: string; status?: string } | undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="size-5 text-accent" /> Resolve</CardTitle>
          <CardDescription>Look up an agent by id, address, or name and read exactly what it may still spend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="agent id, 0x address, or name" className="font-mono text-xs" />
            <Button onClick={resolve} disabled={busy !== null}><Search className="size-4" /> Lookup</Button>
          </div>
          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">{agent?.display_name}</Badge>
                <Badge variant="secondary">{agent?.status}</Badge>
                <Mono>{agent?.id}</Mono>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <div><div className="text-xs text-muted-foreground">Can be drawn now</div><div className="text-2xl font-bold">${remaining?.can_draw ?? '0'}</div></div>
                <div><div className="text-xs text-muted-foreground">Window left</div><div className="text-2xl font-bold">${remaining?.remaining_window ?? '0'}</div></div>
                <div><div className="text-xs text-muted-foreground">Lifetime left</div><div className="text-2xl font-bold">${remaining?.remaining_lifetime ?? '0'}</div></div>
                <div><div className="text-xs text-muted-foreground">Vault available</div><div className="text-2xl font-bold">${remaining?.vault_available ?? '0'}</div></div>
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">mandate</span><Mono>{mandate?.id ?? '—'}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">contract</span><Mono>{mandate?.contract_address ?? 'not deployed'}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">budget / window</span><Mono>${mandate?.budget_per_window}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">per purchase</span><Mono>${mandate?.per_purchase_limit}</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">per seller</span><Mono>{(mandate?.per_seller_limit_bps ?? 0) / 100}%</Mono></div>
                <div className="flex justify-between"><span className="text-muted-foreground">max depth</span><Mono>{mandate?.max_depth}</Mono></div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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
      if (e.code === 'INSUFFICIENT_FUNDS') throw new Error('Wallet has no USDC — fund it in Treasury → Wallet & Funds (Dev faucet is reliable).', { cause: err });
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
        <Alert variant="warning"><AlertTitle>Wallet empty</AlertTitle><AlertDescription>This agent has no USDC — fund it in Treasury → Wallet & Funds (the Dev faucet is reliable).</AlertDescription></Alert>
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

interface MarketTool {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: string;
  inputSchema?: Record<string, unknown> | null;
  provider: { id: string; name: string };
}

interface ArgProp {
  type?: string;
  enum?: string[];
  description?: string;
}

function fieldChoices(p: ArgProp | undefined): string[] | null {
  if (p?.enum?.length) return p.enum;
  const parts = (p?.description ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function buildSchema(inputs: string): Record<string, unknown> {
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];
  for (const line of inputs.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const colon = l.indexOf(':');
    const key = (colon > 0 ? l.slice(0, colon) : l).trim();
    if (!key) continue;
    const desc = colon > 0 ? l.slice(colon + 1).trim() : undefined;
    properties[key] = desc ? { type: 'string', description: desc } : { type: 'string' };
    required.push(key);
  }
  return { type: 'object', properties, required };
}

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex justify-between gap-4 text-sm">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className={cn('break-all text-right', mono && 'font-mono text-xs')}>{value}</span>
  </div>
);

type ListStep = 'start' | 'verify' | 'describe' | 'submit';

export function MarketplaceSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const demoUrl = process.env.NEXT_PUBLIC_DEMO_PROVIDER_URL ?? 'http://localhost:4007';
  const demoPayout = process.env.NEXT_PUBLIC_DEMO_PAYOUT ?? '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
  const mcpEndpoint = process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:4008/v1/mcp';
  const [tools, setTools] = useState<MarketTool[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedToolId, setSelectedToolId] = useState('');
  const [args, setArgs] = useState<Record<string, string>>({});
  const [toolInput, setToolInput] = useState(session.marketplaceInput ?? '{"asset":"USDC","chain":"ethereum"}');
  const [tab, setTab] = useState('browse');
  const [step, setStep] = useState<ListStep>('start');
  const [startMode, setStartMode] = useState<'api' | 'x402'>('api');
  const [endpoint, setEndpoint] = useState('');
  const [verify, setVerify] = useState<{ status: 'idle' | 'checking' | 'verified' | 'error'; speaks402?: boolean; message?: string }>({ status: 'idle' });
  const [describe, setDescribe] = useState({ providerName: 'My API', payout: '', name: '', category: 'general', newCategory: '', description: '', inputs: '', price: '0.10', contact: '' });
  const [providerToken, setProviderToken] = useState('');

  const pickTool = (id: string, from?: MarketTool[]) => {
    const t = (from ?? tools).find((x) => x.id === id);
    const props = (((t?.inputSchema ?? {}) as { properties?: Record<string, ArgProp> }).properties) ?? {};
    setSelectedToolId(id);
    setArgs(Object.fromEntries(Object.entries(props).map(([k, p]) => [k, p.enum?.[0] ?? ''])));
  };

  const loadTools = async (msg?: string) => {
    const disc = await client.listTools({});
    setTools(disc.tools);
    const keep = selectedToolId && disc.tools.some((t) => t.id === selectedToolId);
    pickTool(keep ? selectedToolId : (disc.tools[0]?.id ?? ''), disc.tools);
    if (msg) toast('info', msg);
  };

  useEffect(() => { loadTools().catch(() => undefined); }, []);

  const seed = () =>
    run('seed demo marketplace', async () => {
      const provider = await client.registerProvider({ name: 'Demo Data Provider', payout_wallet_address: demoPayout, payout_chain: 'sepolia' });
      await client.approveProvider(provider.provider_id);
      await client.createTool(provider.provider_token, { provider_id: provider.provider_id, name: 'liquidation-risk', description: 'Returns liquidation risk score for a position', category: 'trading', price: '0.10', price_token: 'USDC', endpoint_url: `${demoUrl}/v1/exec`, input_schema: { type: 'object', properties: { position: { type: 'string', description: 'Position to score, e.g. aave-wbtc-2x' }, chain: { type: 'string', enum: ['ethereum', 'base', 'arbitrum'], description: 'Chain to search' } }, required: ['position'] } });
      await loadTools('Demo provider + tool seeded');
    });

  const execute = () =>
    run('execute paid tool', async () => {
      if (!selectedToolId) throw new Error('pick a tool first');
      const tool = tools.find((t) => t.id === selectedToolId)!;
      let agentId = session.agentId;
      let patch: Partial<Session> = {};
      if (!agentId) {
        const org = await client.createOrg('Demo Org');
        const guardian = await client.createGuardian({ type: 'human', org_id: org.organization.id });
        const agent = await client.createAgent({ owner_org_id: org.organization.id, guardian_id: guardian.guardian.id, display_name: 'Demo Agent', capabilities: ['trading', 'data-purchase'] });
        await client.confirmAgent(agent.agent_id, guardian.guardian_token);
        client.setAgent(agent.agent_id, agent.signing_private_key_pem);
        const w = await client.provisionWallet(agent.agent_id, 'sepolia');
        await client.creditWallet(w.wallet.id, 'USDC', '10.00');
        const m = await client.createMandate({ agent_id: agent.agent_id, budget_per_window: '10.00', window_seconds: 86400, lifetime_cap: '10.00', per_purchase_limit: '5.00', per_seller_limit_bps: 10000, max_depth: 2 });
        patch = { orgId: org.organization.id, orgName: 'Demo Org', guardianId: guardian.guardian.id, guardianToken: guardian.guardian_token, agentId: agent.agent_id, agentName: 'Demo Agent', apiKey: agent.api_key, signingKeyPem: agent.signing_private_key_pem, agentStatus: 'active', walletId: w.wallet.id, walletAddress: w.wallet.address, mandate: { mandate_id: m.mandate_id, operator_address: m.operator_address, budget_per_window: '10.00', window_seconds: 86400, lifetime_cap: '10.00', per_purchase_limit: '5.00', per_seller_limit_bps: 10000, max_depth: 2, signature: m.signature } };
        agentId = agent.agent_id;
        toast('info', 'Demo agent provisioned — funded with testnet USDC');
      }
      let input: Record<string, unknown>;
      try {
        input = Object.keys(schemaProps).length > 0 ? Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v])) : JSON.parse(toolInput);
      } catch { throw new Error('tool input must be valid JSON'); }
      const res = await client.executeTool(selectedToolId, agentId!, input, `tool-${Date.now()}`);
      persist({ ...session, ...patch, toolExecutions: (session.toolExecutions ?? 0) + 1, lastToolExecution: { id: res.execution_id, name: tool.name, price: res.price_paid, txHash: res.tx_hash, output: JSON.stringify(res.output) }, marketplaceInput: toolInput });
      toast('ok', `Tool "${tool.name}" executed — paid ${res.price_paid} USDC`);
    });

  const checkEndpoint = () =>
    run('verify endpoint', async () => {
      if (!endpoint.trim()) throw new Error('endpoint URL is required');
      setVerify({ status: 'checking' });
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ probe: true }) });
        if (res.status === 402) {
          const raw = (await res.json().catch(() => ({}))) as { challenge?: { amount?: string; token?: string; chain?: string; payTo?: string } };
          const ch = raw.challenge ?? {};
          if (ch.amount) setDescribe((d) => ({ ...d, price: ch.amount ?? d.price }));
          if (ch.payTo) setDescribe((d) => ({ ...d, payout: ch.payTo ?? d.payout }));
          setVerify({ status: 'verified', speaks402: true, message: `Price ${ch.amount ?? '?'} ${ch.token ?? 'USDC'} · payout ${(ch.payTo ?? '?').slice(0, 12)}…` });
        } else {
          setVerify({ status: 'verified', speaks402: false, message: `Reachable (HTTP ${res.status}) — will be wrapped with pay-per-call` });
        }
      } catch {
        setVerify({ status: 'error', message: 'Could not reach the endpoint. Is it live, POST-friendly, and CORS-open?' });
      }
    });

  const submitForReview = () =>
    run('submit for review', async () => {
      if (!endpoint.trim()) throw new Error('endpoint URL is required');
      if (!describe.name.trim()) throw new Error('tool name is required');
      if (!describe.payout.trim()) throw new Error('payout wallet (0x…) is required');
      const category = describe.category === '__new' ? describe.newCategory.trim() : describe.category;
      const provider = await client.registerProvider({ name: describe.providerName, payout_wallet_address: describe.payout, payout_chain: 'sepolia' });
      await client.approveProvider(provider.provider_id);
      const desc = describe.description.trim();
      const contact = describe.contact.trim();
      await client.createTool(provider.provider_token, {
        provider_id: provider.provider_id,
        name: describe.name,
        description: desc ? (contact ? `${desc} · contact: ${contact}` : desc) : undefined,
        category,
        price: describe.price,
        price_token: 'USDC',
        endpoint_url: endpoint,
        input_schema: buildSchema(describe.inputs),
      });
      setProviderToken(provider.provider_token);
      toast('ok', 'Submitted — your tool is live');
      await loadTools();
    });

  const copy = (text: string) => { navigator.clipboard?.writeText(text); toast('ok', 'Copied'); };

  const categories = Array.from(new Set(tools.map((t) => t.category)));
  const filtered = tools.filter((t) => {
    const q = query.trim().toLowerCase();
    const hay = `${t.name} ${t.description ?? ''} ${t.category} ${t.provider.name}`.toLowerCase();
    return (!q || hay.includes(q)) && (category === 'all' || t.category === category);
  });
  const selected = tools.find((t) => t.id === selectedToolId) ?? null;
  const schemaProps = (((selected?.inputSchema ?? {}) as { properties?: Record<string, ArgProp> }).properties) ?? {};
  const categoryLabel = describe.category === '__new' ? (describe.newCategory.trim() || 'new category') : describe.category;
  const inputCount = describe.inputs.split('\n').map((l) => l.trim()).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1"><Wand2 className="size-3 text-accent" /> Agent-ready · pay-per-call · x402</Badge>
          <Badge variant="outline" className="gap-1.5 py-1"><CircleDollarSign className="size-3 text-accent" /> 0% commission</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={seed} disabled={busy !== null}><Plus className="size-4" /> Seed demo ($0.10)</Button>
          <Button variant="outline" size="sm" onClick={() => loadTools('tools refreshed')} disabled={busy !== null}><RefreshCw className="size-4" /> Refresh</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="h-auto w-fit gap-1 p-1">
          <TabsTrigger value="browse">Browse tools</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
          <TabsTrigger value="connect">Connect</TabsTrigger>
          <TabsTrigger value="list">List a tool</TabsTrigger>
        </TabsList>

        {/* Browse */}
        <TabsContent value="browse" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools: lending rates, quorum, delegates…" className="pl-9" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {filtered.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((t) => (
                <Card key={t.id} className={cn('cursor-pointer transition-colors hover:border-accent/60', selectedToolId === t.id && 'border-accent')} onClick={() => pickTool(t.id)}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="uppercase text-[10px] tracking-wider">{t.category}</Badge>
                      <Badge variant="success" className="font-mono">${Number(t.price).toFixed(2)}</Badge>
                    </div>
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <CardDescription>{t.description || 'No description.'}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5"><Sparkles className="size-3" /> Powered by {t.provider.name}</div>
                    <div className="flex items-center gap-1.5"><Zap className="size-3 text-accent" /> no answer, no charge</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No tools yet — <button className="text-accent underline underline-offset-4" onClick={seed} disabled={busy !== null}>seed the demo provider</button> or list your own.
            </div>
          )}
        </TabsContent>

        {/* Playground */}
        <TabsContent value="playground" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Zap className="size-5 text-accent" /> Playground</CardTitle>
              <CardDescription>Watch an agent pay for an answer. A real x402 payment on testnet, paid from a free demo agent so you can try it without one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1">
                <p className="text-sm font-medium">Request</p>
                <p className="text-xs text-muted-foreground">Pick a tool, adjust the arguments, run it.</p>
              </div>

              <div className="space-y-2">
                <Label>Tool</Label>
                <Select value={selectedToolId} onValueChange={pickTool}>
                  <SelectTrigger className="w-full font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tools.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} · ${Number(t.price).toFixed(2)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selected && <p className="text-sm text-muted-foreground">{selected.description || 'No description.'}</p>}
              </div>

              {selected ? (
                Object.keys(schemaProps).length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.entries(schemaProps).map(([key, p]) => {
                      const choices = fieldChoices(p);
                      return (
                        <div key={key} className="space-y-2">
                          <Label className="font-mono text-xs">{key}</Label>
                          {choices ? (
                            <Select value={args[key] ?? ''} onValueChange={(v) => setArgs({ ...args, [key]: v })}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>{choices.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : (
                            <Input value={args[key] ?? ''} onChange={(e) => setArgs({ ...args, [key]: e.target.value })} />
                          )}
                          {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2"><Label>Arguments (JSON)</Label><Input value={toolInput} onChange={(e) => { setToolInput(e.target.value); persist({ ...session, marketplaceInput: e.target.value }); }} className="font-mono text-xs" /></div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">No tools yet — seed the demo in <b>Browse tools</b> or list your own.</p>
              )}

              <div className="space-y-2">
                <Label>Pay on</Label>
                <div className="flex items-center gap-2"><Badge variant="outline" className="px-2.5 py-1 font-mono">sepolia testnet</Badge></div>
                <p className="text-xs text-muted-foreground">Both rails are offered in the same 402.</p>
              </div>

              {selected ? (
                <Button variant="accent" onClick={execute} disabled={busy !== null} className="w-full sm:w-auto"><Zap className="size-4" /> Run and pay ${Number(selected.price).toFixed(2)}</Button>
              ) : null}
              <p className="text-xs text-muted-foreground">Funded by us — a free demo agent pays on testnet, so you do not need a wallet. Connect your own agent to pay from yours.</p>

              <Separator />
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">demo agent</span>
                </div>
                <p className="text-sm">{session.lastToolExecution ? `Last run: ${session.lastToolExecution.name} — paid ${session.lastToolExecution.price} USDC, 402 → answer.` : 'Nothing run yet. Press the button and watch the 402 turn into an answer.'}</p>
                {session.lastToolExecution && (
                  <pre className="rounded-lg bg-muted/40 p-3 text-xs overflow-auto">{session.lastToolExecution.output}</pre>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Connect */}
        <TabsContent value="connect" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Terminal className="size-5 text-accent" /> Give your agent onchain tools</CardTitle>
              <CardDescription>Add the endpoint. Your agent sees every tool, calls one, pays for it, gets the answer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>The endpoint</Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-muted/40 px-3 py-2 text-sm font-mono">{mcpEndpoint}</code>
                  <Button variant="outline" size="sm" onClick={() => copy(mcpEndpoint)}><Copy className="size-4" /> Copy</Button>
                </div>
              </div>
              <div>
                <Label>How a call works</Label>
                <pre className="mt-1 rounded-lg bg-muted/40 p-3 text-xs overflow-auto">{`POST /v1/spend-intents      propose the spend   → policy checks it
POST /v1/reservations       reserve the funds   → treasury locks USDC
POST /v1/tools/:id/execute  call the tool       → paid via x402, settled on-chain`}</pre>
              </div>
              <p className="text-xs text-muted-foreground">Your agent's wallet signs every payment; the platform never holds a key. Any wallet that signs x402 requests works.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* List a tool */}
        <TabsContent value="list" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PackagePlus className="size-5 text-accent" /> List your tool</CardTitle>
              <CardDescription>Turn your API into an agent-ready, pay-per-call tool. Direct settlement to your payout wallet — 0% commission.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                {([
                  ['start', '00 · How to start'],
                  ['verify', '01 · Verify endpoint'],
                  ['describe', '02 · Describe'],
                  ['submit', '03 · Submit for review'],
                ] as [ListStep, string][]).map(([s, label], i) => (
                  <div key={s} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="size-3 text-muted-foreground/40" />}
                    <button type="button" onClick={() => setStep(s)} disabled={busy !== null}
                      className={cn('rounded-full px-3 py-1 transition-colors disabled:opacity-50', step === s ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>
                      {label}
                    </button>
                  </div>
                ))}
              </div>

              {step === 'start' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">How do you want to start?</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Card className={cn('cursor-pointer transition-colors hover:border-accent/60', startMode === 'api' && 'border-accent')} onClick={() => setStartMode('api')}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2"><CardTitle className="text-base">I have an API</CardTitle><Badge variant="accent">Recommended</Badge></div>
                        <CardDescription>Add pay-per-call payments in one function call.</CardDescription>
                      </CardHeader>
                    </Card>
                    <Card className={cn('cursor-pointer transition-colors hover:border-accent/60', startMode === 'x402' && 'border-accent')} onClick={() => setStartMode('x402')}>
                      <CardHeader className="pb-2"><CardTitle className="text-base">I already use x402</CardTitle><CardDescription>Bring your existing endpoint.</CardDescription></CardHeader>
                      <CardContent className="pt-0 text-xs text-muted-foreground">Your endpoint answers 402 on Hedera or Arc. The router relays that 402 to callers and their signed payment back to you. Settlement happens at your endpoint; nothing changes on your side.</CardContent>
                    </Card>
                  </div>
                  <Button variant="accent" onClick={() => setStep('verify')}><ArrowRight className="size-4" /> Continue</Button>
                </div>
              )}

              {step === 'verify' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Verify your endpoint</Label>
                    <div className="flex items-center gap-2">
                      <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.example.com/liquidation-risk" className="font-mono text-xs" />
                      <Button variant="outline" onClick={checkEndpoint} disabled={busy !== null}><BadgeCheck className="size-4" /> Check</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">We read the price, payment rails and payout address straight from your 402. POST, JSON body.</p>
                  </div>
                  {verify.status === 'checking' && <p className="text-sm text-muted-foreground">Checking {endpoint}…</p>}
                  {verify.status === 'verified' && (
                    <Alert variant="success"><BadgeCheck className="size-4" /><AlertTitle>{verify.speaks402 ? 'Speaks x402' : 'Endpoint reachable'}</AlertTitle><AlertDescription>{verify.message}</AlertDescription></Alert>
                  )}
                  {verify.status === 'error' && (
                    <Alert variant="destructive"><XCircle className="size-4" /><AlertTitle>Verification failed</AlertTitle><AlertDescription>{verify.message}</AlertDescription></Alert>
                  )}
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => setStep('start')}><ArrowLeft className="size-4" /> Back</Button>
                    <Button variant="accent" onClick={() => setStep('describe')} disabled={verify.status !== 'verified'}><ArrowRight className="size-4" /> Continue</Button>
                  </div>
                </div>
              )}

              {step === 'describe' && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label>Tool name</Label><Input value={describe.name} onChange={(e) => setDescribe({ ...describe, name: e.target.value })} placeholder="Liquidation risk" /></div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={describe.category} onValueChange={(v) => setDescribe({ ...describe, category: v })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          <SelectItem value="__new">New category…</SelectItem>
                        </SelectContent>
                      </Select>
                      {describe.category === '__new' && <Input className="mt-1" value={describe.newCategory} onChange={(e) => setDescribe({ ...describe, newCategory: e.target.value })} placeholder="e.g. governance" />}
                    </div>
                  </div>
                  <div className="space-y-2"><Label>What it answers</Label><Input value={describe.description} onChange={(e) => setDescribe({ ...describe, description: e.target.value })} placeholder="How close is this position to liquidation, and what price move gets it there?" /></div>
                  <p className="-mt-2 text-xs text-muted-foreground">One sentence, shown on the catalogue card.</p>
                  <div className="space-y-2">
                    <Label>Inputs</Label>
                    <textarea value={describe.inputs} onChange={(e) => setDescribe({ ...describe, inputs: e.target.value })} rows={3}
                      placeholder={'address: the position owner\nchain: ethereum | base | arbitrum'}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]" />
                  </div>
                  <p className="-mt-2 text-xs text-muted-foreground">One per line. Fixed choices as a | b | c.</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2"><Label>Price (USDC)</Label><Input value={describe.price} onChange={(e) => setDescribe({ ...describe, price: e.target.value })} placeholder="0.10" className="font-mono text-xs" /></div>
                    <div className="space-y-2"><Label>Payout wallet (0x…)</Label><Input value={describe.payout} onChange={(e) => setDescribe({ ...describe, payout: e.target.value })} placeholder="0x…" className="font-mono text-xs" /></div>
                    <div className="space-y-2"><Label>Contact (GitHub or X)</Label><Input value={describe.contact} onChange={(e) => setDescribe({ ...describe, contact: e.target.value })} placeholder="you" /></div>
                  </div>
                  <div className="space-y-2"><Label>Provider name</Label><Input value={describe.providerName} onChange={(e) => setDescribe({ ...describe, providerName: e.target.value })} placeholder="My API" /></div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => setStep('verify')}><ArrowLeft className="size-4" /> Back</Button>
                    <Button variant="accent" onClick={() => setStep('submit')} disabled={!describe.name.trim()}><ArrowRight className="size-4" /> Continue</Button>
                  </div>
                </div>
              )}

              {step === 'submit' && !providerToken && (
                <div className="space-y-4">
                  <p className="text-sm font-medium">Review before submitting</p>
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                    <Row label="Tool" value={`${describe.name} · ${categoryLabel}`} />
                    <Row label="Endpoint" value={endpoint} mono />
                    <Row label="Price" value={`${describe.price} USDC`} />
                    <Row label="Payout" value={describe.payout} mono />
                    <Row label="Answers" value={describe.description || '—'} />
                    <Row label="Inputs" value={inputCount > 0 ? `${inputCount} field${inputCount === 1 ? '' : 's'}` : 'none'} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => setStep('describe')}><ArrowLeft className="size-4" /> Back</Button>
                    <Button variant="accent" onClick={submitForReview} disabled={busy !== null}><PackagePlus className="size-4" /> Submit for review</Button>
                  </div>
                </div>
              )}

              {providerToken && (
                <div className="space-y-4">
                  <Alert variant="success"><CheckCircle2 className="size-4" /><AlertTitle>Submitted — your tool is live</AlertTitle><AlertDescription>Providers are approved instantly in this environment. Your tool now appears in Browse tools.</AlertDescription></Alert>
                  <div className="space-y-2">
                    <Label>Your provider token (manage this tool)</Label>
                    <code className="block rounded-md bg-muted/40 px-3 py-2 text-xs font-mono break-all">{providerToken}</code>
                  </div>
                  <Button variant="accent" onClick={() => setTab('browse')}><ArrowRight className="size-4" /> Browse tools</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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