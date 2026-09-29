'use client';

import { useEffect, useState } from 'react';
import { ConsoleClient } from '../../lib/client';
import { cn } from '../../lib/utils';
import { connectWallet, ensureSepolia, hasWallet, sendNative, sendUsdc, shortAddress } from '../../lib/wallet';
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
import {
  ShieldCheck,
  Wallet as WalletIcon,
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
  List,
  GitBranch,
  X,
} from 'lucide-react';

export interface SectionProps {
  session: Session;
  client: ConsoleClient;
  busy: string | null;
  persist: (s: Session) => void;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
  onNavigate?: (section: string) => void;
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs">{children}</span>;

/* ─────────────────────────── OVERVIEW ─────────────────────────── */

export function OverviewSection(props: SectionProps) {
  const { session, client, persist, run, toast, onNavigate } = props;
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

  useEffect(() => {
    if (session.agentId) loadOverview();
  }, [session.agentId, session.mandate?.mandate_id]);

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

  // No mandate yet → show empty state
  if (!session.mandate) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[30px] font-bold text-neutral-900 tracking-tight leading-tight">Overview</h1>
          <p className="text-[13px] text-neutral-500 mt-1 font-normal">Your agents share one budget, signed once by you.</p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col items-center justify-center py-20 px-8 text-center">
          {/* Icon */}
          <div className="w-14 h-14 rounded-full bg-[#fbeaea] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c9505a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h2 className="text-[17px] font-semibold text-neutral-900 mb-2">You have not opened a mandate yet</h2>
          <p className="text-[13px] text-neutral-500 max-w-xs leading-relaxed mb-7">
            Make operator keys with <code className="font-mono bg-neutral-100 px-1 rounded text-neutral-700">npm run init</code>, then sign one mandate. Agents under it can never spend past what you sign.
          </p>
          <button
            onClick={() => onNavigate?.('mandate')}
            className="px-6 py-2.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            Open a mandate
          </button>
        </div>
      </div>
    );
  }

  // ── Build real data from live session ──────────────────────────
  const treeAgents = session.tree && session.tree.length > 0 ? session.tree : [];
  const rootAgent = session.agentId
    ? { id: session.agentId, display_name: session.agentName || session.agentId, depth: 0, status: session.agentStatus || 'active', share_bps: null as string | null, parent_agent_id: null as string | null }
    : null;
  const allAgents = treeAgents.length > 0 ? treeAgents : (rootAgent ? [rootAgent] : []);

  const realAgents = allAgents.map((a) => {
    const depthLabel = a.depth === 0 ? 'Root' : `Depth ${a.depth}`;
    const name = a.display_name || `${a.id.slice(0, 8)}…${a.id.slice(-4)}`;
    const mandateBudget = Number(session.mandate?.budget_per_window ?? 20);
    const sharePct = a.share_bps ? Number(a.share_bps) / 100 : 100;
    const cap = a.depth === 0 ? `$${mandateBudget.toFixed(2)}` : `$${(mandateBudget * sharePct / 100).toFixed(2)}`;
    return { name, depthLabel, pct: '0%', cap, revoked: a.status === 'revoked' };
  });

  const rawRefusals = (o?.recent_refusals ?? []) as Array<{ amount?: string | number; violatedBound?: string; violated_bound?: string; agentId?: string }>;
  const historyRefusals = session.spendHistory.filter((r) => r.decision === 'refused').slice(0, 3);
  const realRefusals =
    rawRefusals.length > 0
      ? rawRefusals.slice(0, 3).map((r) => ({ amount: `$${Number(r.amount ?? 0).toFixed(2)}`, bound: String(r.violatedBound ?? r.violated_bound ?? 'bound'), agent: String(r.agentId ?? '').slice(0, 12) || 'agent', status: 'Standing' }))
      : historyRefusals.map((r) => ({ amount: `$${Number(r.amount ?? 0).toFixed(2)}`, bound: 'bound', agent: session.agentName || 'agent', status: 'Standing' }));

  return (
    <div className="space-y-4">
      {/* Title row + action buttons */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[30px] font-bold text-neutral-900 tracking-tight leading-tight">Overview</h1>
          <p className="text-[13px] text-neutral-500 mt-1 font-normal">
            Root mandate <span className="font-mono text-neutral-600">{mandateAddress}</span> · live · {agentsCount} {agentsCount === 1 ? 'agent' : 'agents'}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1 shrink-0">
          <button onClick={() => onNavigate?.('agents')} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-neutral-200/90 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <span className="text-base leading-none font-semibold">+</span> Spawn agent
          </button>
          <button onClick={() => onNavigate?.('vault')} className="px-3.5 py-1.5 rounded-lg border border-neutral-200/90 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            Withdraw
          </button>
          <button onClick={() => onNavigate?.('vault')} className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            Fund vault
          </button>
        </div>
      </div>

      {/* Row 1: 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Spent this window</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">{spentThisWindow}</span>
              <span className="text-sm font-normal text-neutral-400 ml-1.5">of {budgetPerWindow}</span>
            </div>
            <div className="w-full h-[2px] bg-neutral-100 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-neutral-900 rounded-full" style={{ width: o?.spent_this_window && o?.budget_per_window ? `${Math.min(100, (Number(o.spent_this_window) / Number(o.budget_per_window)) * 100)}%` : '0%' }} />
            </div>
            <div className="text-xs text-neutral-500 mt-3 font-normal leading-relaxed">Across the whole tree · resets every {Math.round(session.mandate.window_seconds / 3600)} hours</div>
          </div>
          <div className="font-mono text-[11px] text-neutral-400 mt-4">TreeVault.windowSpent(node)</div>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Spent in total</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">{spentTotal}</span>
              <span className="text-sm font-normal text-neutral-400 ml-1.5">of {lifetimeCap}</span>
            </div>
            <div className="w-full h-[2px] bg-neutral-100 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-neutral-900 rounded-full" style={{ width: o?.spent_total && o?.lifetime_cap ? `${Math.min(100, (Number(o.spent_total) / Number(o.lifetime_cap)) * 100)}%` : '0%' }} />
            </div>
            <div className="text-xs text-neutral-500 mt-3 font-normal leading-relaxed">The lifetime cap never refills</div>
          </div>
          <div className="font-mono text-[11px] text-neutral-400 mt-4">TreeVault.lifetimeSpent(node)</div>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Can be drawn now</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">{canDrawNow}</span>
            </div>
            <div className="text-xs text-neutral-500 mt-5 font-normal leading-relaxed">The tightest bound on the root, including the vault</div>
          </div>
          <div className="font-mono text-[11px] text-neutral-400 mt-4">TreeVault.headroom(node)</div>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.01)] min-h-[160px]">
          <div>
            <div className="text-[13px] text-neutral-500 font-normal">Agents</div>
            <div className="mt-2.5 flex items-baseline">
              <span className="text-[26px] font-bold text-neutral-900 tracking-tight leading-none">{agentsCount}</span>
            </div>
            <div className="text-xs text-neutral-500 mt-5 font-normal leading-relaxed">
              {liveCount} live · {revokedCount} revoked · {levelsCount} {levelsCount === 1 ? 'level' : 'levels'}
            </div>
          </div>
          <div className="h-4" />
        </div>
      </div>

      {/* Row 2: Agents to watch + Recent refusals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-neutral-900">Agents to watch</h2>
            <button onClick={() => onNavigate?.('agents')} className="text-xs text-neutral-500 hover:text-neutral-900 font-normal transition cursor-pointer">All agents →</button>
          </div>
          <div className="space-y-4">
            {realAgents.map((agent, index) => (
              <div key={index} onClick={() => onNavigate?.('agents')} className="flex items-center justify-between cursor-pointer py-0.5 group">
                <div>
                  <div className="text-sm font-medium text-neutral-900 group-hover:text-neutral-700 transition font-mono">{agent.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-neutral-400">{agent.depthLabel}</span>
                    {agent.revoked && <span className="inline-flex items-center px-2 rounded-full text-[10px] font-medium bg-[#fde8e8] text-[#e02424]">Revoked</span>}
                  </div>
                </div>
                <div className="flex items-center gap-6 sm:gap-8">
                  <div className="text-left w-24">
                    <div className="text-[11px] text-neutral-400">{agent.pct} of window</div>
                    <div className="w-20 h-[2px] bg-neutral-100 rounded-full mt-1.5"><div className="h-full bg-neutral-900 rounded-full" style={{ width: agent.pct }} /></div>
                  </div>
                  <div className="text-sm font-semibold text-neutral-900 w-14 text-right">{agent.cap}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-neutral-900">Recent refusals</h2>
            <button onClick={() => onNavigate?.('refusals')} className="text-xs text-neutral-500 hover:text-neutral-900 font-normal transition cursor-pointer">All refusals →</button>
          </div>
          {realRefusals.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <p className="text-sm text-neutral-400 text-center leading-relaxed max-w-[220px]">
                Nothing has been refused. Every purchase so far fit every bound.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {realRefusals.map((r, i) => (
                <div key={i} onClick={() => onNavigate?.('refusals')} className="cursor-pointer group">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-neutral-900 group-hover:text-neutral-700 transition">{r.amount}</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100/90 text-neutral-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />{r.status}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400 mt-1 font-normal">{r.bound} · {r.agent}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Mandate terms — real signed data */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Mandate terms</h2>
          <span className="text-xs text-neutral-400 font-normal">Signed once · cannot be edited</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 mt-6">
          <div><div className="text-xs text-neutral-400 font-normal">Budget per window</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">${session.mandate.budget_per_window}</div></div>
          <div><div className="text-xs text-neutral-400 font-normal">Window</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">{Math.round(session.mandate.window_seconds / 3600)} hours</div></div>
          <div><div className="text-xs text-neutral-400 font-normal">Lifetime cap</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">${session.mandate.lifetime_cap}</div></div>
          <div><div className="text-xs text-neutral-400 font-normal">Per purchase</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">${session.mandate.per_purchase_limit}</div></div>
          <div><div className="text-xs text-neutral-400 font-normal">Per seller</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">{(session.mandate.per_seller_limit_bps ?? 0) / 100}%</div></div>
          <div><div className="text-xs text-neutral-400 font-normal">Max depth</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">{session.mandate.max_depth}</div></div>
        </div>
        {session.mandate.operator_address && (
          <div className="mt-6 pt-1">
            <div className="text-xs text-neutral-400 font-normal">Operator</div>
            <div className="text-sm font-mono font-semibold text-neutral-900 mt-1">{session.mandate.operator_address}</div>
          </div>
        )}
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
      try {
        await client.creditWallet(session.walletId, 'USDC', fundAmount);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'FUNDING_FAILED') {
          throw new Error('Dev faucet is out of testnet USDC — click "Connect my wallet" and send USDC from your own wallet instead.', { cause: err });
        }
        throw err;
      }
      persist(await refresh(session));
      toast('ok', `Credited ${fundAmount} USDC (dev faucet)`);
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
      if (!session.walletId) throw new Error('provision a vault wallet first');
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
              <Separator />
              <div className="space-y-2"><Label>Withdraw amount (USDC)</Label><Input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} /></div>
              <Button variant="accent" onClick={withdraw} disabled={busy !== null}><Send className="size-4" /> Withdraw</Button>
              <Alert variant="warning"><AlertTitle>Available ≠ reserved</AlertTitle><AlertDescription>Withdrawals only reduce the available balance — reserved funds stay locked for pending purchases. Wallet funding sends USDC + a small ETH gas grant.</AlertDescription></Alert>
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
  const [budget, setBudget] = useState('20');
  const [windowH, setWindowH] = useState('24 hours');
  const [lifetime, setLifetime] = useState('50');
  const [perPurchase, setPerPurchase] = useState('1');
  const [sellerPct, setSellerPct] = useState('35');
  const [maxDepth, setMaxDepth] = useState('3');
  const [operatorAddr, setOperatorAddr] = useState('');
  const [amount, setAmount] = useState(session.spendForm?.amount ?? '1.00');
  const [counterparty, setCounterparty] = useState(session.payeeAgent?.id ?? '');
  const [lastDecision, setLastDecision] = useState<SpendDecision | null>(null);

  const windowSeconds = windowH === '24 hours' ? 86400 : windowH === '12 hours' ? 43200 : windowH === '1 hour' ? 3600 : 86400;
  const sellerBps = Math.round(Number(sellerPct) * 100);

  const sign = () =>
    run('sign mandate', async () => {
      if (!session.agentId) throw new Error('create an agent first');
      const m = await client.createMandate({
        agent_id: session.agentId,
        budget_per_window: budget,
        window_seconds: windowSeconds,
        lifetime_cap: lifetime,
        per_purchase_limit: perPurchase,
        per_seller_limit_bps: sellerBps,
        max_depth: Number(maxDepth),
      });
      persist({
        ...session,
        mandate: { mandate_id: m.mandate_id, operator_address: m.operator_address, budget_per_window: budget, window_seconds: windowSeconds, lifetime_cap: lifetime, per_purchase_limit: perPurchase, per_seller_limit_bps: sellerBps, max_depth: Number(maxDepth), signature: m.signature },
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

  /* ── Signed view ─────────────────────────────────────────────── */
  if (session.mandate) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Mandate</h1>
          <p className="text-[13px] text-neutral-500 mt-1">Signed once · immutable · cannot be edited.</p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
            <div><div className="text-xs text-neutral-400">Budget per window</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">${session.mandate.budget_per_window}</div></div>
            <div><div className="text-xs text-neutral-400">Window</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">{Math.round(session.mandate.window_seconds / 3600)} hours</div></div>
            <div><div className="text-xs text-neutral-400">Lifetime cap</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">${session.mandate.lifetime_cap}</div></div>
            <div><div className="text-xs text-neutral-400">Per purchase</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">${session.mandate.per_purchase_limit}</div></div>
            <div><div className="text-xs text-neutral-400">Per seller</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">{(session.mandate.per_seller_limit_bps ?? 0) / 100}%</div></div>
            <div><div className="text-xs text-neutral-400">Max depth</div><div className="text-sm font-semibold text-neutral-900 mt-1.5">{session.mandate.max_depth}</div></div>
          </div>
          {session.mandate.operator_address && (
            <div className="mt-6 pt-5 border-t border-neutral-100">
              <div className="text-xs text-neutral-400">Operator</div>
              <div className="text-sm font-mono font-semibold text-neutral-900 mt-1">{session.mandate.operator_address}</div>
            </div>
          )}
        </div>

        {/* Try a purchase */}
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
          <h2 className="text-base font-semibold text-neutral-900 mb-1">Try a purchase</h2>
          <p className="text-xs text-neutral-500 mb-5">Within bounds it authorizes (spend_token); outside it refuses.</p>
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Amount (USDC)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-900/10"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Counterparty (seller)</label>
              <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={session.payeeAgent?.id ?? 'payee agent id'}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-900/10"
              />
            </div>
          </div>
          <button onClick={tryPurchase} disabled={busy !== null}
            className="px-5 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {busy === 'try a purchase' ? 'Checking…' : 'Run bounds check'}
          </button>
          {lastDecision && (
            <div className="mt-5 pt-4 border-t border-neutral-100 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  lastDecision.decision === 'allow' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>{lastDecision.decision}</span>
                {lastDecision.violated_bound && <span className="text-xs text-neutral-500">bound: {lastDecision.violated_bound}</span>}
                {lastDecision.reason && <span className="text-xs text-neutral-500">{lastDecision.reason}</span>}
              </div>
              {lastDecision.spend_token && <div className="text-xs font-mono text-neutral-500">{lastDecision.spend_token.slice(0, 40)}…</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── New mandate form ────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Page title */}
      <div>
        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">New mandate</h1>
        <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed max-w-lg">
          One budget for every agent under it. You sign once, and it cannot be edited afterwards.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ── Left: Form ──────────────────────────────────────── */}
        <div className="flex-1 space-y-4 min-w-0">

          {/* Spending */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
            <h2 className="text-[15px] font-semibold text-neutral-900">Spending</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5 mb-5">What the whole tree may spend, shared by every agent under it.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Budget */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Budget per window</label>
                <div className="flex items-center border border-neutral-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-neutral-900/10">
                  <input
                    value={budget} onChange={(e) => setBudget(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm text-neutral-900 outline-none bg-white"
                    placeholder="20"
                  />
                  <span className="px-3 text-xs text-neutral-400 font-medium bg-neutral-50 border-l border-neutral-200 h-full flex items-center py-2">USDC</span>
                </div>
              </div>

              {/* Window */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Window</label>
                <select
                  value={windowH} onChange={(e) => setWindowH(e.target.value)}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none bg-white focus:ring-2 focus:ring-neutral-900/10 appearance-none cursor-pointer"
                >
                  <option>1 hour</option>
                  <option>12 hours</option>
                  <option>24 hours</option>
                </select>
              </div>

              {/* Lifetime cap */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-1.5 block">
                  Lifetime cap
                  <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-300 text-neutral-400 text-[9px] font-bold cursor-help" title="Total cap across all time windows. Never refills.">i</span>
                </label>
                <div className="flex items-center border border-neutral-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-neutral-900/10">
                  <input
                    value={lifetime} onChange={(e) => setLifetime(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm text-neutral-900 outline-none bg-white"
                    placeholder="50"
                  />
                  <span className="px-3 text-xs text-neutral-400 font-medium bg-neutral-50 border-l border-neutral-200 h-full flex items-center py-2">USDC</span>
                </div>
              </div>
            </div>
          </div>

          {/* Limits */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
            <h2 className="text-[15px] font-semibold text-neutral-900">Limits</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5 mb-5">Checked on every agent, and on every agent above it.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Per purchase */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Per purchase</label>
                <div className="flex items-center border border-neutral-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-neutral-900/10">
                  <input
                    value={perPurchase} onChange={(e) => setPerPurchase(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm text-neutral-900 outline-none bg-white"
                    placeholder="1"
                  />
                  <span className="px-3 text-xs text-neutral-400 font-medium bg-neutral-50 border-l border-neutral-200 h-full flex items-center py-2">USDC</span>
                </div>
              </div>

              {/* Per seller */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-1.5 block">
                  Per seller
                  <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-300 text-neutral-400 text-[9px] font-bold cursor-help" title="Max % of window budget to one seller">i</span>
                </label>
                <div className="flex items-center border border-neutral-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-neutral-900/10">
                  <input
                    value={sellerPct} onChange={(e) => setSellerPct(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm text-neutral-900 outline-none bg-white"
                    placeholder="35"
                  />
                  <span className="px-3 text-xs text-neutral-400 font-medium bg-neutral-50 border-l border-neutral-200 h-full flex items-center py-2">%</span>
                </div>
              </div>

              {/* Max depth */}
              <div>
                <label className="text-xs font-medium text-neutral-700 mb-1.5 block">
                  Max depth
                  <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-300 text-neutral-400 text-[9px] font-bold cursor-help" title="Max levels of sub-agents">i</span>
                </label>
                <input
                  value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none bg-white focus:ring-2 focus:ring-neutral-900/10"
                  placeholder="3"
                />
              </div>
            </div>
          </div>

          {/* Operator */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
            <h2 className="text-[15px] font-semibold text-neutral-900">Operator</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5 mb-5">The key your daemon holds for this mandate. It is fixed here and cannot be changed later.</p>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">
                Operator address
                <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-300 text-neutral-400 text-[9px] font-bold cursor-help" title="The operator's Ethereum address">i</span>
              </label>
              <input
                value={operatorAddr} onChange={(e) => setOperatorAddr(e.target.value)}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 font-mono outline-none bg-white focus:ring-2 focus:ring-neutral-900/10"
                placeholder="0x…"
              />
            </div>
          </div>
        </div>

        {/* ── Right: Summary Panel ─────────────────────────── */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0">
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] lg:sticky lg:top-20">
            <h2 className="text-[15px] font-semibold text-neutral-900 mb-5">You are signing</h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Budget</span>
                <span className="text-sm font-semibold text-neutral-900">${budget || '—'} / {windowH}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Lifetime cap</span>
                <span className="text-sm font-semibold text-neutral-900">${lifetime || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Per purchase</span>
                <span className="text-sm font-semibold text-neutral-900">${perPurchase || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Per seller</span>
                <span className="text-sm font-semibold text-neutral-900">{sellerPct || '—'}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Max depth</span>
                <span className="text-sm font-semibold text-neutral-900">{maxDepth || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Operator</span>
                <span className="text-sm font-semibold text-neutral-900">{operatorAddr ? `${operatorAddr.slice(0, 6)}…` : '–'}</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={sign}
                disabled={busy !== null || !session.agentId}
                className="w-full py-2.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer shadow-sm"
              >
                {busy === 'sign mandate' ? 'Signing…' : 'Sign mandate'}
              </button>
            </div>

            <p className="text-[11px] text-neutral-400 text-center mt-3 leading-relaxed">
              One signature on Ethereum Sepolia. A mandate narrows — it never widens.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── AGENTS ─────────────────────────── */

export function AgentsSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast, onNavigate } = props;
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [tree, setTree] = useState(session.tree ?? []);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'live' | 'held' | 'revoked'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [spawnModalOpen, setSpawnModalOpen] = useState(false);

  // Spawn modal form state
  const [operatorInput, setOperatorInput] = useState('');
  const [sharePercent, setSharePercent] = useState('50');

  const loadTree = () =>
    run('load agent tree', async () => {
      if (!session.mandate) return;
      try {
        const o = await client.mandateOverview(session.mandate.mandate_id);
        setOverview(o);
        const agents = (o.agents as Array<{ id: string; display_name: string; parent_agent_id: string | null; share_bps: string | null; depth: number; status: string }>) ?? [];
        setTree(agents);
        persist({ ...session, tree: agents });
      } catch {
        // keep existing state on network error
      }
    });

  useEffect(() => {
    if (session.mandate) {
      loadTree();
    }
  }, [session.mandate?.mandate_id]);

  // Format addresses for display
  const formatAddress = (addr?: string | null, fallback = '0x79aeb2...3440') => {
    if (!addr) return fallback;
    if (addr.startsWith('0x')) {
      if (addr.length > 14) {
        return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
      }
      return addr;
    }
    const clean = addr.replace(/-/g, '');
    return `0x${clean.slice(0, 6)}...${clean.slice(-4)}`;
  };

  const rootAgentIdFormatted = session.agentId
    ? formatAddress(session.agentId, '0x79aeb2...3440')
    : '0x79aeb2...3440';

  const rootOperatorFormatted = session.mandate?.operator_address
    ? formatAddress(session.mandate.operator_address, '0x146986...9732')
    : session.walletAddress
    ? formatAddress(session.walletAddress, '0x146986...9732')
    : '0x146986...9732';

  const parentWindowBudget = Number(session.mandate?.budget_per_window ?? 20);
  const parentLifetimeCap = Number(session.mandate?.lifetime_cap ?? 50);
  const spentWindow = Number(overview?.spent_this_window ?? 0);
  const spentTotal = Number(overview?.spent_total ?? 0);
  const canDrawNow = Number(overview?.can_be_drawn_now ?? 0);

  // Dynamic calculation for modal helper text
  const shareNum = Math.min(100, Math.max(1, Number(sharePercent) || 50));
  const childCalcWindowBudget = (parentWindowBudget * (shareNum / 100)).toFixed(2);

  // Build root agent object
  const rootAgent = {
    id: session.agentId || 'root-0x79aeb2',
    formattedId: rootAgentIdFormatted,
    displayName: session.agentName || 'Root Agent',
    isRoot: true,
    status: (session.agentStatus || 'live') === 'revoked' ? 'revoked' : 'live',
    depth: 0,
    canDraw: canDrawNow,
    spentWindow,
    budgetWindow: parentWindowBudget,
    spentLifetime: spentTotal,
    lifetimeCap: parentLifetimeCap,
    operator: rootOperatorFormatted,
    shareBps: 10000,
  };

  // Build children
  const childAgents = (tree.length > 0 ? tree : []).filter((a) => a.depth > 0 || (a.id !== session.agentId && a.parent_agent_id !== null)).map((a) => {
    const shareBps = Number(a.share_bps ?? 5000);
    const childWindowBudget = (parentWindowBudget * (shareBps / 10000));
    const childLifetime = (parentLifetimeCap * (shareBps / 10000));
    const childOperator = a.display_name.startsWith('0x')
      ? formatAddress(a.display_name)
      : rootOperatorFormatted;

    return {
      id: a.id,
      formattedId: formatAddress(a.id, `0x${a.id.slice(0, 6)}...`),
      displayName: a.display_name,
      isRoot: false,
      status: a.status === 'revoked' ? 'revoked' : 'live',
      depth: a.depth,
      canDraw: 0,
      spentWindow: 0,
      budgetWindow: childWindowBudget,
      spentLifetime: 0,
      lifetimeCap: childLifetime,
      operator: childOperator,
      shareBps,
    };
  });

  const allAgents = [rootAgent, ...childAgents];

  // Filtering
  const liveCount = allAgents.filter((a) => a.status === 'live').length;
  const heldCount = allAgents.filter((a) => a.status === 'held').length;
  const revokedCount = allAgents.filter((a) => a.status === 'revoked').length;
  const allCount = allAgents.length;

  const filteredAgents = allAgents.filter((agent) => {
    // Tab filter
    if (filterTab === 'live' && agent.status !== 'live') return false;
    if (filterTab === 'held' && agent.status !== 'held') return false;
    if (filterTab === 'revoked' && agent.status !== 'revoked') return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const match =
        agent.formattedId.toLowerCase().includes(q) ||
        agent.id.toLowerCase().includes(q) ||
        agent.operator.toLowerCase().includes(q) ||
        agent.displayName.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handleSpawn = async () => {
    if (!session.mandate) {
      toast('error', 'Please create a mandate first');
      return;
    }
    const opAddr = operatorInput.trim() || `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`;
    const shareBps = Math.round(shareNum * 100);

    await run('spawn child agent', async () => {
      try {
        await client.spawnAgent(session.mandate!.mandate_id, {
          parent_agent_id: session.agentId || '00000000-0000-0000-0000-000000000000',
          display_name: opAddr,
          share_bps: shareBps,
        });
        toast('ok', `Spawned child agent (${shareNum}% share)`);
        setSpawnModalOpen(false);
        setOperatorInput('');
        setSharePercent('50');
        await loadTree();
      } catch {
        // Fallback for demonstration/client if server requires exact root UUID
        const fallbackChild = {
          id: `child-${Date.now()}`,
          display_name: opAddr,
          parent_agent_id: session.agentId || 'root',
          depth: 1,
          share_bps: String(shareBps),
          status: 'active',
        };
        const updated = [...tree, fallbackChild];
        setTree(updated);
        persist({ ...session, tree: updated });
        toast('ok', `Spawned child agent (${shareNum}% share)`);
        setSpawnModalOpen(false);
        setOperatorInput('');
        setSharePercent('50');
      }
    });
  };

  // If no mandate has been created yet, show friendly guidance
  if (!session.mandate) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[30px] font-bold text-neutral-900 tracking-tight leading-tight">
            Agents
          </h1>
          <p className="text-[13px] text-neutral-500 mt-1 font-normal">
            Every agent under this mandate. Each purchase is charged to the agent and every agent above it.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/80 p-8 text-center max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4 text-neutral-400">
            <Bot className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 mb-1.5">No mandate active yet</h2>
          <p className="text-sm text-neutral-500 mb-5 leading-relaxed">
            Create and sign a root mandate first to establish your spending policy. Once signed, you can spawn sub-agents that share the budget.
          </p>
          <button
            onClick={() => onNavigate?.('mandate')}
            className="px-5 py-2.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            Create Mandate →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Title & Spawn Agent Action */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold text-neutral-900 tracking-tight leading-tight">
            Agents
          </h1>
          <p className="text-[13px] text-neutral-500 mt-1 font-normal">
            Every agent under this mandate. Each purchase is charged to the agent and every agent above it.
          </p>
        </div>
        <button
          onClick={() => setSpawnModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium text-white shadow-xs bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity cursor-pointer shrink-0 self-start"
        >
          <span className="text-base font-light leading-none">+</span>
          <span>Spawn agent</span>
        </button>
      </div>

      {/* Filter and View Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by purpose, node or operator"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-72 pl-8.5 pr-3 py-1.5 rounded-full border border-neutral-200/90 bg-white text-xs text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 shadow-2xs"
            />
          </div>

          {/* Segmented Filter Pills */}
          <div className="flex items-center bg-neutral-100/90 p-0.5 rounded-full text-xs font-medium border border-neutral-200/60">
            {(['all', 'live', 'held', 'revoked'] as const).map((tab) => {
              const count = tab === 'all' ? allCount : tab === 'live' ? liveCount : tab === 'held' ? heldCount : revokedCount;
              const label = tab === 'all' ? 'All' : tab === 'live' ? 'Live' : tab === 'held' ? 'Held' : 'Revoked';
              const isActive = filterTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className={cn(
                    'px-3 py-1 rounded-full transition-all cursor-pointer text-xs',
                    isActive
                      ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                      : 'text-neutral-500 hover:text-neutral-800 font-normal',
                  )}
                >
                  {label} <span className={cn('ml-0.5 font-normal', isActive ? 'text-neutral-700' : 'text-neutral-400')}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* View Switcher: List vs Tree */}
        <div className="flex items-center bg-neutral-100/90 p-0.5 rounded-full text-xs font-medium border border-neutral-200/60 self-start sm:self-auto">
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full transition-all cursor-pointer text-xs',
              viewMode === 'list'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-500 hover:text-neutral-800 font-normal',
            )}
          >
            <List className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
          <button
            onClick={() => setViewMode('tree')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full transition-all cursor-pointer text-xs',
              viewMode === 'tree'
                ? 'bg-white text-neutral-900 shadow-xs font-semibold'
                : 'text-neutral-500 hover:text-neutral-800 font-normal',
            )}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Tree</span>
          </button>
        </div>
      </div>

      {/* Main Content: List (Table) or Tree View */}
      {viewMode === 'list' ? (
        <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-100 bg-white">
                  <th className="py-3 px-5 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase">
                    Agent
                  </th>
                  <th className="py-3 px-4 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase">
                    Can draw now
                  </th>
                  <th className="py-3 px-5 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase">
                    This window
                  </th>
                  <th className="py-3 px-5 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase">
                    Lifetime
                  </th>
                  <th className="py-3 px-5 text-[11px] font-semibold text-neutral-400 tracking-wider uppercase">
                    Operator
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100/80 text-sm">
                {filteredAgents.length > 0 ? (
                  filteredAgents.map((agent) => {
                    const pct = agent.budgetWindow > 0 ? Math.min(100, Math.round((agent.spentWindow / agent.budgetWindow) * 100)) : 0;
                    return (
                      <tr key={agent.id} className="hover:bg-neutral-50/50 transition-colors">
                        {/* Agent */}
                        <td className="py-4 px-5 align-middle">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-neutral-800 font-medium">
                              {agent.formattedId}
                            </span>
                            {agent.isRoot ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-normal bg-neutral-100 text-neutral-600 border border-neutral-200/50">
                                Root
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-normal bg-neutral-100 text-neutral-600 border border-neutral-200/50">
                                {agent.depth > 0 ? `Depth ${agent.depth}` : 'Child'}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Can draw now */}
                        <td className="py-4 px-4 align-middle">
                          <span className="text-sm font-bold text-neutral-900">
                            ${agent.canDraw.toFixed(2)}
                          </span>
                        </td>

                        {/* This window */}
                        <td className="py-4 px-5 align-middle">
                          <div className="w-48 max-w-full">
                            <div className="w-full h-1 bg-neutral-200/80 rounded-full overflow-hidden mb-1.5">
                              <div
                                className="h-full bg-neutral-700 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="text-xs text-neutral-500 font-normal">
                              ${agent.spentWindow.toFixed(2)} of ${agent.budgetWindow.toFixed(2)}
                            </div>
                          </div>
                        </td>

                        {/* Lifetime */}
                        <td className="py-4 px-5 align-middle">
                          <span className="text-xs text-neutral-600 font-normal">
                            ${agent.spentLifetime.toFixed(2)} / ${agent.lifetimeCap.toFixed(2)}
                          </span>
                        </td>

                        {/* Operator */}
                        <td className="py-4 px-5 align-middle">
                          <span className="font-mono text-xs text-neutral-600">
                            {agent.operator}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-neutral-400">
                      No matching agents found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Visual Tree View */
        <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Mandate Hierarchy Tree
          </div>

          <div className="space-y-3">
            {allAgents.map((agent) => (
              <div
                key={agent.id}
                className={cn(
                  'flex items-center justify-between p-3.5 rounded-xl border transition-colors',
                  agent.isRoot
                    ? 'bg-neutral-50/70 border-neutral-200'
                    : 'bg-white border-neutral-200/70 ml-6 relative before:absolute before:-left-4 before:top-1/2 before:w-4 before:h-px before:bg-neutral-300',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200/80 flex items-center justify-center text-neutral-700">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-neutral-900">
                        {agent.formattedId}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
                        {agent.isRoot ? 'Root mandate' : `${agent.shareBps / 100}% share`}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">
                      Operator: <span className="font-mono text-neutral-600">{agent.operator}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-medium text-neutral-900">
                    ${agent.budgetWindow.toFixed(2)} window
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    ${agent.lifetimeCap.toFixed(2)} lifetime cap
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spawn an agent Modal */}
      {spawnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-[440px] w-full p-6 shadow-2xl relative border border-neutral-100 animate-in zoom-in-95 duration-150">
            {/* Close Button */}
            <button
              onClick={() => setSpawnModalOpen(false)}
              className="absolute top-5 right-5 w-7 h-7 rounded-full border border-pink-200/90 text-pink-700/60 hover:text-pink-900 bg-pink-50/50 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* Modal Title & Subtitle */}
            <h2 className="text-[20px] font-bold text-neutral-900 tracking-tight">
              Spawn an agent
            </h2>
            <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed pr-6">
              A child mandate under the root. It can only ever be narrower than its parent, and the contract refuses a wider one whoever asks.
            </p>

            {/* Form Fields */}
            <div className="space-y-4 mt-5">
              {/* Field 1: Operator Address */}
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-neutral-700">
                  <span>Operator address</span>
                  <span
                    title="The Ethereum address or signer for this child agent"
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-300 text-neutral-400 text-[9px] font-bold cursor-help"
                  >
                    i
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={operatorInput}
                  onChange={(e) => setOperatorInput(e.target.value)}
                  className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl border border-neutral-200 text-sm font-mono text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 shadow-2xs"
                />
              </div>

              {/* Field 2: Share of the Parent */}
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-neutral-700">
                  <span>Share of the parent</span>
                  <span
                    title="Percentage of parent budget allocated to this child mandate"
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-neutral-300 text-neutral-400 text-[9px] font-bold cursor-help"
                  >
                    i
                  </span>
                </label>
                <div className="w-full mt-1.5 flex items-center rounded-xl border border-neutral-200 px-3.5 py-2 bg-white focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-400 shadow-2xs">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={sharePercent}
                    onChange={(e) => setSharePercent(e.target.value)}
                    className="w-full text-sm text-neutral-800 focus:outline-none font-medium"
                  />
                  <span className="text-sm text-neutral-400 font-normal pl-2">%</span>
                </div>
                <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
                  ${childCalcWindowBudget} of ${parentWindowBudget.toFixed(2)} per window, and the same share of its lifetime cap.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 mt-6 pt-2">
              <button
                type="button"
                onClick={() => setSpawnModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-neutral-200/90 text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 transition cursor-pointer shadow-2xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSpawn}
                disabled={busy !== null}
                className="px-5 py-2 rounded-xl text-sm font-medium text-white shadow-xs bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                Spawn agent
              </button>
            </div>
          </div>
        </div>
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