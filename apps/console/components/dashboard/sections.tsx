'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Client } from '../../lib/client';
import type { Session } from '../../lib/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  CHAIN_ID,
  fundFromContract,
  mandateCanonical,
  sendNativeEth,
  shortAddress,
  signMessage,
  signSpendIntent,
  spawnCanonical,
  withdrawFromContract,
} from '../../lib/wallet';

export interface SectionProps {
  session: Session;
  client: Client;
  busy: string | null;
  persist: (s: Session) => void;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
  onNavigate?: (s: string) => void;
  onNewMandate?: () => void;
  forceCreateMandate?: boolean;
  onConsumeMandateCreate?: () => void;
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs">{children}</span>;

const card = 'bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]';
const input = 'w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none bg-white focus:ring-2 focus:ring-neutral-900/10';
const btn = 'px-5 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer';
const btnGhost = 'px-5 py-2 rounded-full text-sm font-medium text-neutral-700 border border-neutral-200/90 bg-white hover:bg-neutral-50 transition disabled:opacity-50 cursor-pointer';
const agentRows = (value: unknown): Session['tree'] => (Array.isArray(value) ? value as Session['tree'] : []);

export function OverviewSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast, onNavigate, onNewMandate } = props;
  const { address: wagmiAddress } = useAccount();
  const owner = wagmiAddress ?? session.ownerAddress;
  const [o, setO] = useState<Record<string, unknown> | null>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [fundAmt, setFundAmt] = useState('1');
  const [withdrawAmt, setWithdrawAmt] = useState('0');
  const [spawnOperator, setSpawnOperator] = useState('');
  const [spawnShare, setSpawnShare] = useState('50');

  const load = () =>
    run('load overview', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const overview = await client.mandateOverview(session.mandate.mandate_id);
      setO(overview);
      persist({ ...session, tree: agentRows(overview.agents), vaultBalance: overview.vault_available as string });
      toast('ok', 'Refreshed');
    });

  const fund = () =>
    run('fund vault', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      // Send USDC from YOUR wallet into the contract (on-chain, no faucet).
      const tx = await fundFromContract(session.mandate.contract_address, fundAmt);
      setFundOpen(false);
      toast('ok', `Funding submitted on-chain — ${tx.slice(0, 14)}…`);
      await load();
    });

  const withdraw = () =>
    run('withdraw', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      // Owner signs + submits the contract withdraw directly on-chain (Polygon Amoy).
      const tx = await withdrawFromContract(session.mandate.contract_address, withdrawAmt, owner);
      persist({ ...session });
      setWithdrawOpen(false);
      toast('ok', `Withdraw submitted on-chain — ${tx.slice(0, 14)}…`);
      await load();
    });

  const spawn = () =>
    run('spawn agent', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      if (!spawnOperator.trim()) throw new Error('enter an operator address');
      const parent = session.mandate.root_agent_id;
      const canonical = spawnCanonical({ mandateId: session.mandate.mandate_id, parentAgentId: parent, operator: spawnOperator, sharePercent: Number(spawnShare) });
      const signature = await signMessage(canonical);
      await client.spawnAgent(session.mandate.mandate_id, { parent_agent_id: parent, operator_address: spawnOperator, share_percent: Number(spawnShare), chain_id: CHAIN_ID, signature });
      setSpawnOpen(false);
      setSpawnOperator('');
      toast('ok', `Spawned agent at 50% — see it in Agents`);
      await load();
    });

  useEffect(() => {
    if (session.mandate) load();
  }, [session.mandate?.mandate_id]);

  if (!session.mandate) {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Overview</h1>
        <div className={`${card} flex flex-col items-center justify-center py-20 text-center`}>
          <p className="text-sm text-neutral-500">No mandate yet.</p>
          <p className="text-xs text-neutral-400 mt-1">Go to <b>Mandate</b> to sign your first one.</p>
        </div>
      </div>
    );
  }

  const data = (o ?? {}) as {
    spent_this_window?: string;
    budget_per_window?: string;
    spent_total?: string;
    lifetime_cap?: string;
    vault_available?: string;
    can_be_drawn_now?: string;
    agents?: Session['tree'];
    recent_refusals?: Array<{ amount?: string; bound?: string; status?: string; requestedAt?: string }>;
  };
  const agents = data.agents ?? session.tree ?? [];
  const live = agents.filter((a) => a.status === 'active').length;
  const revoked = agents.filter((a) => a.status !== 'active').length;
  const levels = Math.max(0, ...agents.map((a) => a.depth)) + 1;
  const refusals = data.recent_refusals ?? [];
  const contract = session.mandate.contract_address;
  const contractShort = contract ? `${contract.slice(0, 8)}…${contract.slice(-4)}` : '';
  const fmt = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '0.00');
  const money = (v: unknown) => `$${fmt(v)}`;

  const stat = (label: string, value: string, hint?: string) => (
    <div className={card}>
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-xl font-semibold text-neutral-900 mt-1.5">{value}</div>
      {hint && <div className="text-[11px] text-neutral-400 mt-1">{hint}</div>}
    </div>
  );

  const termRow = (label: string, value: string) => (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-900">{value}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header + actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-neutral-900 tracking-tight leading-tight">
            Root mandate <Mono>{contractShort}</Mono> · <span className="text-green-600">live</span> · {agents.length} agent{agents.length === 1 ? '' : 's'}
          </h1>
          <p className="text-[13px] text-neutral-500 mt-1">Signed once · cannot be edited.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onNewMandate?.()} className={btnGhost}>＋ New mandate</button>
          <button onClick={() => setSpawnOpen(true)} className={btnGhost}>Spawn agent</button>
          <button onClick={() => setWithdrawOpen(true)} className={btnGhost}>Withdraw</button>
          <button onClick={() => setFundOpen(true)} className={btn}>Fund vault</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stat('Spent this window', `${money(data.spent_this_window)} of ${money(data.budget_per_window)}`, 'Across the whole tree · resets every 24 hours')}
        {stat('Spent in total', `${money(data.spent_total)} of ${money(data.lifetime_cap)}`, 'The lifetime cap never refills')}
        {stat('Can be drawn now', money(data.can_be_drawn_now), 'The tightest bound on the root, including the vault')}
        {stat('Agents', String(agents.length), `${live} live · ${revoked} revoked · ${levels} level${levels > 1 ? 's' : ''}`)}
      </div>

      {/* Spawn agent modal */}
      <Dialog open={spawnOpen} onOpenChange={setSpawnOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Spawn an agent</DialogTitle>
            <DialogDescription>A child mandate under the root. It can only ever be narrower than its parent, and the contract refuses a wider one whoever asks.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Operator address</label>
              <input className={input} value={spawnOperator} onChange={(e) => setSpawnOperator(e.target.value)} placeholder="0x…" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Share of the parent</label>
              <div className="flex items-center gap-2">
                <input className={`${input} flex-1`} value={spawnShare} onChange={(e) => setSpawnShare(e.target.value)} placeholder="50" />
                <span className="text-sm text-neutral-500">%</span>
              </div>
              <p className="text-xs text-neutral-400 mt-1.5">{money((Number(session.mandate?.budget_per_window ?? 0) * Number(spawnShare)) / 100)} of {money(session.mandate?.budget_per_window)} per window, and the same share of its lifetime cap.</p>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setSpawnOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={spawn} disabled={busy !== null || !spawnOperator.trim()} className={btn}>Spawn agent</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw modal */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Withdraw from the vault</DialogTitle>
            <DialogDescription>Agents under this tree draw from what is left. Take everything out and their next purchase is refused for vault balance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">In the vault for <Mono>{contractShort}</Mono>: <b>{money(session.vaultBalance ?? data.vault_available)}</b></p>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Amount</label>
              <div className="flex items-center gap-2">
                <input className={`${input} flex-1`} value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="0" />
                <span className="text-sm text-neutral-500">USDC</span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setWithdrawOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={withdraw} disabled={busy !== null || !owner} className={btn}>Withdraw ${withdrawAmt}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fund vault modal */}
      <Dialog open={fundOpen} onOpenChange={setFundOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Fund the vault</DialogTitle>
            <DialogDescription>USDC moves from your wallet into the vault. Agents never hold it — the vault releases one purchase at a time, and only when every bound allows it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Amount</label>
              <div className="flex items-center gap-2">
                <input className={`${input} flex-1`} value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} placeholder="1" />
                <span className="text-sm text-neutral-500">USDC</span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setFundOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={fund} disabled={busy !== null} className={btn}>Fund ${fundAmt}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agents to watch */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Agents to watch</h2>
          <button onClick={() => onNavigate?.('agents')} className="text-xs text-neutral-500 hover:text-neutral-900 cursor-pointer">All agents →</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-sm">
              <span className="font-mono text-neutral-400">{'· '.repeat(a.depth)}</span>
              <span className="font-medium">{shortAddress(a.operator_address)}</span>
              <span className="text-xs text-neutral-500">{a.depth === 0 ? 'Root' : `Depth ${a.depth}`}</span>
              <span className="ml-auto text-xs text-neutral-500">{Number(a.share_percent)}% of window</span>
              <span className="text-xs font-mono text-neutral-400">$0.00</span>
            </div>
          ))}
          {agents.length === 0 && <p className="text-sm text-neutral-500">No agents yet — spawn one.</p>}
        </div>
      </div>

      {/* Recent refusals */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Recent refusals</h2>
          <button onClick={() => onNavigate?.('refusals')} className="text-xs text-neutral-500 hover:text-neutral-900 cursor-pointer">All refusals →</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {refusals.length > 0 ? (
            refusals.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-sm">
<span className="font-mono font-semibold">{money(r.amount)}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">{r.bound}</span>
                <span className="ml-auto text-xs text-neutral-500">{r.status ?? 'standing'}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-neutral-500">Nothing has been refused. Every purchase so far fit every bound.</p>
          )}
        </div>
      </div>

      {/* Mandate terms */}
      <div className={card}>
        <h2 className="text-base font-semibold text-neutral-900">Mandate terms</h2>
        <p className="text-xs text-neutral-400 mt-0.5 mb-4">Signed once · cannot be edited</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3">
          {termRow('Budget per window', money(session.mandate.budget_per_window))}
          {termRow('Window', `${Math.round(session.mandate.window_seconds / 3600)} hours`)}
          {termRow('Lifetime cap', money(session.mandate.lifetime_cap))}
          {termRow('Per purchase', money(session.mandate.per_purchase_cap))}
          {termRow('Per seller', `${session.mandate.per_seller_pct / 100}%`)}
          {termRow('Max depth', String(session.mandate.max_depth))}
          {termRow('Operator', shortAddress(session.mandate.operator_address))}
        </div>
      </div>
    </div>
  );
}

export function MandateSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast, onNavigate, forceCreateMandate, onConsumeMandateCreate } = props;
  const { address: wagmiAddress } = useAccount();
  const owner = wagmiAddress ?? session.ownerAddress;
  const [creatingNew, setCreatingNew] = useState(false);
  const [budget, setBudget] = useState('20');
  const [windowH, setWindowH] = useState('24 hours');
  const [lifetime, setLifetime] = useState('100');
  const [perPurchase, setPerPurchase] = useState('1');
  const [sellerPct, setSellerPct] = useState('35');
  const [maxDepth, setMaxDepth] = useState('3');
  const [operator, setOperator] = useState('');
  const [fundAmt, setFundAmt] = useState('50');
  const [withdrawAmt, setWithdrawAmt] = useState('10');
  const [spendAmt, setSpendAmt] = useState('0.50');
  const [recipient, setRecipient] = useState('');
  const [last, setLast] = useState<{ decision?: string; bound?: string; tx_hash?: string } | null>(null);

  const windowSeconds = windowH === '24 hours' ? 86400 : windowH === '12 hours' ? 43200 : 3600;
  // The operator must be entered explicitly for every new mandate. It is an
  // address, not a private key, and is immutable after the mandate is signed.
  const effectiveOperator = operator.trim();

  const sign = () =>
    run('sign mandate', async () => {
      if (!owner) throw new Error('connect your wallet first (top right)');
      if (!effectiveOperator) throw new Error('enter the operator address');
      const canonical = mandateCanonical({ owner: owner, operator: effectiveOperator, budgetPerWindow: budget, windowSeconds, lifetimeCap: lifetime, perPurchaseCap: perPurchase, perSellerPct: Math.round(Number(sellerPct) * 100), maxDepth: Number(maxDepth) });
      const signature = await signMessage(canonical);
      const m = await client.createMandate({
        owner_address: owner,
        operator_address: effectiveOperator,
        budget_per_window: budget,
        window_seconds: windowSeconds,
        lifetime_cap: lifetime,
        per_purchase_cap: perPurchase,
        per_seller_pct: Math.round(Number(sellerPct) * 100),
        max_depth: Number(maxDepth),
        chain_id: CHAIN_ID,
        signature,
      });
      persist({ ...session, operatorAddress: effectiveOperator, mandate: { mandate_id: m.mandate_id, root_agent_id: m.root_agent_id, contract_address: m.contract_address, owner_address: owner, operator_address: effectiveOperator, budget_per_window: budget, window_seconds: windowSeconds, lifetime_cap: lifetime, per_purchase_cap: perPurchase, per_seller_pct: Math.round(Number(sellerPct) * 100), max_depth: Number(maxDepth) } });
      toast('ok', `Mandate signed by ${shortAddress(owner)} — immutable`);
      onNavigate?.('overview');
    });

  const fund = () =>
    run('fund vault', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      // Funding is an owner-wallet action: approve the configured USDC token
      // and call the mandate contract directly. The helper waits for both
      // receipts before we read the new vault balance.
      await fundFromContract(session.mandate.contract_address, fundAmt);
      const res = await client.getVault(session.mandate.mandate_id);
      persist({ ...session, vaultBalance: res.vault_balance });
      toast('ok', `Vault funded — balance $${res.vault_balance}`);
    });

  const withdraw = () =>
    run('withdraw', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      const tx = await withdrawFromContract(session.mandate.contract_address, withdrawAmt, owner);
      toast('ok', `Withdraw submitted on-chain — ${tx.slice(0, 14)}…`);
    });

  const spend = () =>
    run('spend intent', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first (it signs the spend)');
      const agentId = session.mandate.root_agent_id;
      const nonce = Math.floor(Date.now() / 1000);
      // The operator is the key you provided (your creator wallet) — MetaMask signs.
      const signature = await signSpendIntent({ agentId, amount: spendAmt, recipient: recipient.trim() as `0x${string}`, nonce, timestamp: nonce, chainId: CHAIN_ID }, owner);
      const res = await client.spendIntent({ agent_id: agentId, amount: spendAmt, recipient: recipient.trim(), nonce, timestamp: nonce, chain_id: CHAIN_ID, signature });
      setLast(res);
      toast(res.decision === 'allow' ? 'ok' : 'info', res.decision === 'allow' ? `Executed on-chain ${res.tx_hash?.slice(0, 14)}…` : `Refused — ${res.bound}`);
    });

  if (forceCreateMandate && !creatingNew) {
    setCreatingNew(true);
    onConsumeMandateCreate?.();
  }
  const showCreate = creatingNew || forceCreateMandate || !session.mandate;

  if (session.mandate && !showCreate) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Mandate</h1>
            <p className="text-[13px] text-neutral-500 mt-1">Signed once · immutable · enforced on-chain.</p>
          </div>
          <button onClick={() => setCreatingNew(true)} className={btnGhost}>＋ New mandate</button>
        </div>
        <div className={card}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
            <div><div className="text-xs text-neutral-400">Budget per window</div><div className="text-sm font-semibold mt-1.5">${session.mandate.budget_per_window}</div></div>
            <div><div className="text-xs text-neutral-400">Window</div><div className="text-sm font-semibold mt-1.5">{Math.round(session.mandate.window_seconds / 3600)} hours</div></div>
            <div><div className="text-xs text-neutral-400">Lifetime cap</div><div className="text-sm font-semibold mt-1.5">${session.mandate.lifetime_cap}</div></div>
            <div><div className="text-xs text-neutral-400">Per purchase</div><div className="text-sm font-semibold mt-1.5">${session.mandate.per_purchase_cap}</div></div>
            <div><div className="text-xs text-neutral-400">Per seller</div><div className="text-sm font-semibold mt-1.5">{session.mandate.per_seller_pct / 100}%</div></div>
            <div><div className="text-xs text-neutral-400">Max depth</div><div className="text-sm font-semibold mt-1.5">{session.mandate.max_depth}</div></div>
          </div>
          <div className="mt-5 pt-4 border-t border-neutral-100 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-neutral-400">Contract</span><Mono>{session.mandate.contract_address}</Mono></div>
            <div className="flex justify-between"><span className="text-neutral-400">Owner</span><Mono>{session.mandate.owner_address}</Mono></div>
            <div className="flex justify-between"><span className="text-neutral-400">Operator</span><Mono>{session.mandate.operator_address}</Mono></div>
          </div>
        </div>

        <div className={`${card} grid gap-6 sm:grid-cols-2`}>
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-neutral-900">Vault</h2>
            <div className="text-3xl font-bold text-neutral-900">${session.vaultBalance ?? '0.00'}</div>
            <div className="flex gap-2">
              <input className={input} value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} placeholder="50" />
              <button onClick={fund} disabled={busy !== null} className={btn}>Fund</button>
            </div>
            <div className="flex gap-2">
              <input className={input} value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="10" />
              <button onClick={withdraw} disabled={busy !== null} className={btnGhost}>Withdraw</button>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-semibold text-neutral-900">Spend intent</h2>
            <p className="text-xs text-neutral-500">Signed by the operator (your creator wallet, EIP-712 via MetaMask). The contract enforces every bound.</p>
            <div className="grid grid-cols-2 gap-2">
              <input className={input} value={spendAmt} onChange={(e) => setSpendAmt(e.target.value)} placeholder="0.50" />
              <input className={input} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x recipient" />
            </div>
            <button onClick={spend} disabled={busy !== null || !owner} className={btn}>Run and pay ${spendAmt}</button>
            {!owner && <p className="text-xs text-amber-600">Connect your wallet to sign spends.</p>}
            {last && (
              <div className="text-xs space-y-1">
                <span className={`inline-flex px-2 py-0.5 rounded-full ${last.decision === 'allow' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{last.decision}</span>
                {last.bound && <span className="ml-1 text-neutral-500">bound: {last.bound}</span>}
                {last.tx_hash && <div className="font-mono text-neutral-500">{last.tx_hash.slice(0, 24)}…</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">New mandate</h1>
          <p className="text-[13px] text-neutral-500 mt-1 max-w-lg">One budget for every agent under it. You sign once, and it cannot be edited afterwards.</p>
        </div>
        {session.mandate && <button onClick={() => setCreatingNew(false)} className={btnGhost}>← Current mandate</button>}
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <div className="flex-1 space-y-4 min-w-0">
          <div className={card}>
            <h2 className="text-[15px] font-semibold text-neutral-900">Spending</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Budget per window (USDC)</label><input className={input} value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
              <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Window</label>
                <select className={`${input} appearance-none cursor-pointer`} value={windowH} onChange={(e) => setWindowH(e.target.value)}>
                  <option>1 hour</option><option>12 hours</option><option>24 hours</option>
                </select></div>
              <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Lifetime cap (USDC)</label><input className={input} value={lifetime} onChange={(e) => setLifetime(e.target.value)} /></div>
            </div>
          </div>

          <div className={card}>
            <h2 className="text-[15px] font-semibold text-neutral-900">Limits</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5 mb-4">Checked on every agent, and on every agent above it.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Per purchase (USDC)</label><input className={input} value={perPurchase} onChange={(e) => setPerPurchase(e.target.value)} /></div>
              <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Per seller (%)</label><input className={input} value={sellerPct} onChange={(e) => setSellerPct(e.target.value)} /></div>
              <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Max depth</label><input className={input} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} /></div>
            </div>
          </div>

          <div className={card}>
            <h2 className="text-[15px] font-semibold text-neutral-900">Operator</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5 mb-4">Enter the operator wallet address explicitly. It is fixed here and cannot be changed after signing.</p>
            <input className={input} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="0x…" />
            {effectiveOperator && <div className="mt-2 text-xs text-neutral-500 font-mono">Operator = {shortAddress(effectiveOperator)}</div>}
          </div>
        </div>

        <div className="w-full lg:w-72 xl:w-80 shrink-0">
          <div className={`${card} lg:sticky lg:top-20`}>
            <h2 className="text-[15px] font-semibold text-neutral-900 mb-5">You are signing</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-neutral-500">Budget</span><span className="font-semibold">${budget || '—'} / {windowH}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Lifetime cap</span><span className="font-semibold">${lifetime || '—'}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Per purchase</span><span className="font-semibold">${perPurchase || '—'}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Per seller</span><span className="font-semibold">{sellerPct || '—'}%</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Max depth</span><span className="font-semibold">{maxDepth || '—'}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Operator</span><span className="font-semibold">{effectiveOperator ? shortAddress(effectiveOperator) : '–'}</span></div>
            </div>
            <div className="mt-6">
              <button onClick={sign} disabled={busy !== null || !owner || !effectiveOperator} className={`${btn} w-full`}>{busy ? 'Signing…' : 'Sign mandate'}</button>
              {!owner && <p className="mt-2 text-xs text-amber-600">Connect your wallet first (top right).</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentsSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const { address: wagmiAddress } = useAccount();
  const owner = wagmiAddress ?? session.ownerAddress;
  type Agent = { id: string; operator_address: string; share_percent: string; depth: number; status: string; parent_agent_id?: string | null; name?: string | null; mcp_endpoint?: string | null };
  const [tree, setTree] = useState<Agent[]>(() => (session.tree ?? []) as Agent[]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'held' | 'revoked'>('all');
  const [view, setView] = useState<'list' | 'tree'>('list');
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnParent, setSpawnParent] = useState('');
  const [spawnOperator, setSpawnOperator] = useState('');
  const [spawnShare, setSpawnShare] = useState('50');
  const [selected, setSelected] = useState<Agent | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [gasOpen, setGasOpen] = useState(false);
  const [gasAmt, setGasAmt] = useState('0.02');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmt, setWithdrawAmt] = useState('0');
  const [nameOpen, setNameOpen] = useState(false);
  const [nameLabel, setNameLabel] = useState('');
  const [nameDomain, setNameDomain] = useState('probe.mira.eth');
  const [nameMcp, setNameMcp] = useState('');

  const statusOf = (s: string) => (s === 'active' ? 'live' : s === 'suspended' ? 'held' : 'revoked');

  const load = () =>
    run('load agents', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const overview = await client.mandateOverview(session.mandate.mandate_id);
      const remoteAgents = agentRows(overview.agents) as Agent[];
      const agents = remoteAgents.length > 0 ? remoteAgents : (session.tree ?? []) as Agent[];
      setTree(agents);
      persist({ ...session, tree: agents });
    });

  useEffect(() => {
    if (session.mandate) load();
  }, [session.mandate?.mandate_id]);

  useEffect(() => {
    if (tree.length === 0 && session.tree && session.tree.length > 0) setTree(session.tree as Agent[]);
  }, [session.tree]);

  const spawn = () =>
    run('spawn agent', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      if (!spawnOperator.trim()) throw new Error('enter an operator address');
      const parent = spawnParent || session.mandate.root_agent_id;
      const canonical = spawnCanonical({ mandateId: session.mandate.mandate_id, parentAgentId: parent, operator: spawnOperator, sharePercent: Number(spawnShare) });
      const signature = await signMessage(canonical);
      await client.spawnAgent(session.mandate.mandate_id, { parent_agent_id: parent, operator_address: spawnOperator, share_percent: Number(spawnShare), chain_id: CHAIN_ID, signature });
      setSpawnOpen(false);
      setSpawnParent('');
      setSpawnOperator('');
      toast('ok', `Spawned agent at ${spawnShare}%`);
      await load();
    });

  const spawnUnder = (a: Agent) => {
    setSpawnParent(a.id);
    setSpawnOpen(true);
  };

  const bindName = () =>
    run('name agent', async () => {
      if (!selected) return;
      const label = nameLabel.trim();
      if (!label) { toast('error', 'Enter a label'); return; }
      const full = `${label}.${nameDomain}`;
      const res = await client.setAgentMeta(selected.id, { name: full, mcp_endpoint: nameMcp.trim() || undefined });
      setTree((t) => t.map((a) => (a.id === selected.id ? { ...a, name: res.agent.name, mcp_endpoint: res.agent.mcp_endpoint } : a)));
      setSelected((s) => (s ? { ...s, name: res.agent.name, mcp_endpoint: res.agent.mcp_endpoint } : s));
      persist({ ...session, names: { ...(session.names ?? {}), [selected.id]: full } });
      setNameOpen(false);
      setNameLabel('');
      toast('ok', `Bound ${full} to the agent`);
    });

  const sendGas = () =>
    run('send gas', async () => {
      if (!owner) throw new Error('connect your wallet first');
      if (!selected) throw new Error('select an agent first');
      const tx = await sendNativeEth(selected.operator_address, gasAmt);
      setGasOpen(false);
      toast('ok', `Sent ${gasAmt} ETH gas to the operator — ${tx.slice(0, 14)}…`);
    });

  const withdrawVault = () =>
    run('withdraw', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!owner) throw new Error('connect your wallet first');
      const tx = await withdrawFromContract(session.mandate.contract_address, withdrawAmt, owner);
      setWithdrawOpen(false);
      toast('ok', `Withdraw submitted on-chain — ${tx.slice(0, 14)}…`);
      await load();
    });

  const budget = Number(session.mandate?.budget_per_window ?? 0);
  const lifetime = Number(session.mandate?.lifetime_cap ?? 0);
  const money = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '0.00');

  const filtered = (tree ?? []).filter((a) => {
    const matchFilter = filter === 'all' || statusOf(a.status) === filter;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || a.operator_address.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });
  const counts = {
    all: (tree ?? []).length,
    live: (tree ?? []).filter((a) => statusOf(a.status) === 'live').length,
    held: (tree ?? []).filter((a) => statusOf(a.status) === 'held').length,
    revoked: (tree ?? []).filter((a) => statusOf(a.status) === 'revoked').length,
  };

  const agentCell = (a: Agent) => (
    <div className="flex items-center gap-2">
      <span className="font-mono text-neutral-400">{'· '.repeat(a.depth)}</span>
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{shortAddress(a.operator_address)}</span>
          <span className="text-xs text-neutral-400">{a.depth === 0 ? 'Root' : `Depth ${a.depth}`}</span>
        </div>
        <span className="text-[11px] text-neutral-400 font-mono">node {a.id.slice(0, 8)}…</span>
      </div>
    </div>
  );
  const windowCap = (a: Agent) => (budget * Number(a.share_percent)) / 100;
  const lifetimeCap = (a: Agent) => (lifetime * Number(a.share_percent)) / 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold text-neutral-900 tracking-tight leading-tight">Agents</h1>
          <p className="text-[13px] text-neutral-500 mt-1">Every agent under this mandate. Each purchase is charged to the agent and every agent above it.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} disabled={busy !== null} className={btnGhost}>Refresh</button>
          <button onClick={() => setSpawnOpen(true)} className={btn}>Spawn agent</button>
        </div>
      </div>

      <div className="flex items-start gap-5">
        <div className="flex-1 min-w-0">
      <div className={card}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <input className={`${input} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by purpose, node or operator" />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">⌕</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {(['all', 'live', 'held', 'revoked'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full ${filter === f ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
                {f} <span className="opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-0.5 text-xs">
            {(['list', 'tree'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded-full ${view === v ? 'bg-white shadow-sm font-medium' : 'text-neutral-500'}`}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* List table */}
        {view === 'list' ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Can draw now</th>
                  <th className="pb-2 font-medium">This window</th>
                  <th className="pb-2 font-medium">Lifetime</th>
                  <th className="pb-2 font-medium">Operator</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} onClick={() => setSelected(a)} className={`border-b border-neutral-50 last:border-0 cursor-pointer transition-colors ${selected?.id === a.id ? 'bg-neutral-50' : 'hover:bg-neutral-50/60'}`}>
                    <td className="py-2.5">{agentCell(a)}</td>
                    <td className="py-2.5 font-mono">${money(0)}</td>
                    <td className="py-2.5 font-mono">${money(0)} of ${money(windowCap(a))}</td>
                    <td className="py-2.5 font-mono">${money(0)} / ${money(lifetimeCap(a))}</td>
                    <td className="py-2.5 font-mono text-neutral-500">{a.operator_address.slice(0, 10)}…{a.operator_address.slice(-4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="py-8 text-center text-sm text-neutral-500"><p>No agents{filter !== 'all' ? ` (${filter})` : ''}.</p><button onClick={() => load()} className="mt-2 text-xs text-neutral-700 underline">Reload agents</button></div>}
          </div>
        ) : (
          <div className="mt-4 space-y-1.5">
            {filtered.map((a) => (
              <div key={a.id} onClick={() => setSelected(a)} className={`flex items-center gap-3 rounded-lg border border-neutral-100 px-3 py-2 text-sm cursor-pointer transition-colors ${selected?.id === a.id ? 'bg-neutral-50 border-neutral-200' : 'hover:bg-neutral-50/60'}`}>
                {agentCell(a)}
                <span className={`ml-auto text-xs ${a.status === 'active' ? 'text-green-600' : a.status === 'suspended' ? 'text-amber-600' : 'text-neutral-400'}`}>{statusOf(a.status)}</span>
                <span className="text-xs font-mono text-neutral-500">${money(windowCap(a))}/window</span>
              </div>
            ))}
            {filtered.length === 0 && <div className="py-8 text-center text-sm text-neutral-500"><p>No agents.</p><button onClick={() => load()} className="mt-2 text-xs text-neutral-700 underline">Reload agents</button></div>}
          </div>
        )}
      </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-[340px] shrink-0 space-y-4">
            <div className={card}>
              <div className="text-xs text-neutral-400">Agent</div>
              <div className="text-sm font-semibold mt-1 break-all">{selected.operator_address}</div>
              <div className="text-3xl font-bold text-neutral-900 mt-3">${money(0)}</div>
              <div className="text-xs text-neutral-400 mt-1">Left to draw. Its window allows more than the vault holds.</div>
            </div>

            <div className={card}>
              <div className="grid gap-3 text-sm">
                <div><div className="text-xs text-neutral-400">Name</div><div className="mt-0.5">{selected.name ?? session.names?.[selected.id] ?? 'Unnamed — a name is bound from the console, not by the contract'}</div></div>
                {selected.mcp_endpoint && <div><div className="text-xs text-neutral-400">MCP endpoint</div><div className="mt-0.5 font-mono text-xs break-all">{selected.mcp_endpoint}</div></div>}
                <div><div className="text-xs text-neutral-400">Purpose</div><div className="mt-0.5">None stated</div></div>
                <div><div className="text-xs text-neutral-400">This window</div><div className="mt-0.5 font-mono">{money(0)} of {money(windowCap(selected))} · 0%</div></div>
                <div><div className="text-xs text-neutral-400">Lifetime</div><div className="mt-0.5 font-mono">{money(0)} of {money(lifetimeCap(selected))}</div></div>
                <div className="flex justify-between"><span className="text-neutral-500">Per purchase</span><span className="font-semibold">{money(session.mandate?.per_purchase_cap)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Per seller</span><span className="font-semibold">{(session.mandate?.per_seller_pct ?? 0) / 100}% of a window</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Window length</span><span className="font-semibold">{Math.round((session.mandate?.window_seconds ?? 0) / 3600)} hours</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Depth</span><span className="font-semibold">{selected.depth} of {session.mandate?.max_depth}</span></div>
                <div><div className="text-xs text-neutral-400">Operator</div><div className="mt-0.5 font-mono break-all">{selected.operator_address}</div></div>
                <div className="flex justify-between"><span className="text-neutral-500">Parent</span><span className="font-semibold">{selected.parent_agent_id ? shortAddress(selected.parent_agent_id) : 'None — root'}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Children</span><span className="font-semibold">{(() => { const c = (tree ?? []).filter((x) => x.parent_agent_id === selected.id).length; return c === 0 ? 'None' : c; })()}</span></div>
                <div><div className="text-xs text-neutral-400">Node id</div><div className="mt-0.5 font-mono text-xs break-all">{selected.id}</div></div>
              </div>
            </div>

            <div className={card}>
              <button onClick={() => spawnUnder(selected)} className={`${btn} w-full`}>＋ Spawn under this agent</button>
              <div className="relative mt-2">
                <button onClick={() => setMoreOpen(!moreOpen)} className={`${btnGhost} w-full`}>More ▾</button>
                {moreOpen && (
                  <div className="absolute left-0 right-0 mt-1 rounded-xl border border-neutral-200 bg-white shadow-lg py-1 z-20">
                    {([
                      ['Send gas to the operator', ''], // opens gas modal
                      ['Name this agent', ''], // opens the naming modal
                      ['Withdraw from the vault', ''], // opens withdraw modal
                      ['Revoke this branch', 'Revoke is an owner action on-chain — coming soon.'],
                    ] as [string, string][]).map(([label, hint]) => (
                      <button key={label} onClick={() => { setMoreOpen(false); if (label === 'Send gas to the operator') setGasOpen(true); else if (label === 'Name this agent') setNameOpen(true); else if (label === 'Withdraw from the vault') setWithdrawOpen(true); else toast('info', hint); }} className="w-full text-left px-3.5 py-2 text-xs text-neutral-600 hover:bg-neutral-50">{label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Spawn agent modal */}
      <Dialog open={spawnOpen} onOpenChange={setSpawnOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Spawn an agent</DialogTitle>
            <DialogDescription>A child mandate under the root. It can only ever be narrower than its parent, and the contract refuses a wider one whoever asks.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Operator address</label>
              <input className={input} value={spawnOperator} onChange={(e) => setSpawnOperator(e.target.value)} placeholder="0x…" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Share of the parent</label>
              <div className="flex items-center gap-2">
                <input className={`${input} flex-1`} value={spawnShare} onChange={(e) => setSpawnShare(e.target.value)} placeholder="50" />
                <span className="text-sm text-neutral-500">%</span>
              </div>
              <p className="text-xs text-neutral-400 mt-1.5">{money((budget * Number(spawnShare)) / 100)} of {money(budget)} per window, and the same share of its lifetime cap.</p>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setSpawnOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={spawn} disabled={busy !== null || !spawnOperator.trim()} className={btn}>Spawn agent</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Name the agent modal */}
      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Name the agent</DialogTitle>
            <DialogDescription>An ENSv2 subname bound to this mandate. A seller that resolves it reads what the contract allows right now, never a figure copied into a record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Label</label>
              <input className={input} value={nameLabel} onChange={(e) => setNameLabel(e.target.value)} placeholder="worker2" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Under which name</label>
              <input className={input} value={nameDomain} onChange={(e) => setNameDomain(e.target.value)} placeholder="probe.mira.eth" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">MCP endpoint</label>
              <input className={input} value={nameMcp} onChange={(e) => setNameMcp(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setNameOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={bindName} disabled={!nameLabel.trim()} className={btn}>Issue and bind</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send gas modal */}
      <Dialog open={gasOpen} onOpenChange={setGasOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Send gas to this operator</DialogTitle>
            <DialogDescription>ETH from your own wallet, to the key that signs for this agent. It pays for the transaction that draws a tranche — never for a purchase, and the vault cannot send it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">Operator for this agent: <Mono>{selected ? shortAddress(selected.operator_address) : ''}</Mono></p>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Amount</label>
              <div className="flex items-center gap-2">
                <input className={`${input} flex-1`} value={gasAmt} onChange={(e) => setGasAmt(e.target.value)} placeholder="0.02" />
                <span className="text-sm text-neutral-500">ETH</span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setGasOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={sendGas} disabled={busy !== null || !owner} className={btn}>Send {gasAmt} ETH</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw from vault modal */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Withdraw from the vault</DialogTitle>
            <DialogDescription>Agents under this tree draw from what is left. Take everything out and their next purchase is refused for vault balance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">In the vault for <Mono>{session.mandate?.contract_address ? `${session.mandate.contract_address.slice(0, 8)}…${session.mandate.contract_address.slice(-4)}` : ''}</Mono>: <b>{money(session.vaultBalance ?? '0')}</b> · TreeVault.treasury6(root)</p>
            <div>
              <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Amount</label>
              <div className="flex items-center gap-2">
                <input className={`${input} flex-1`} value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="0" />
                <span className="text-sm text-neutral-500">USDC</span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <button onClick={() => setWithdrawOpen(false)} className={btnGhost}>Cancel</button>
            <button onClick={withdrawVault} disabled={busy !== null || !owner} className={btn}>Withdraw ${withdrawAmt}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RefusalsSection(props: SectionProps) {
  const { session, client, busy, run, toast } = props;
  const [scope, setScope] = useState<'all' | 'standing' | 'released'>('all');
  const [rows, setRows] = useState<Array<{ id: string; amount: string; bound: string; status: string }>>([]);

  const load = () =>
    run('load refusals', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const res = await client.listRefusals(session.mandate.root_agent_id, scope);
      setRows(res.refusals as unknown as { id: string; amount: string; bound: string; status: string }[]);
      toast('info', `${res.refusals.length} refusals`);
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Refusals</h1>
        <p className="text-[13px] text-neutral-500 mt-1">Every purchase that violated a bound, logged for audit.</p>
      </div>
      <div className={card}>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {(['all', 'standing', 'released'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`px-3 py-1 rounded-full text-xs ${scope === s ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}>{s}</button>
            ))}
          </div>
          <button onClick={load} disabled={busy !== null} className={btnGhost}>{busy ? '…' : 'Load'}</button>
        </div>
        <div className="mt-4 space-y-1.5">
          {rows.slice(0, 20).map((r, i) => (
            <div key={`${r.id}-${i}`} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-sm">
              <span className="font-mono font-semibold">${r.amount}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">{r.bound}</span>
              <span className={`ml-auto text-xs ${r.status === 'released' ? 'text-green-600' : 'text-amber-600'}`}>{r.status}</span>
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-neutral-500">Every purchase so far fit every bound.</p>}
        </div>
      </div>
    </div>
  );
}

export function ResolveSection(props: SectionProps) {
  const { client, busy, run, toast } = props;
  const [ref, setRef] = useState('');
  const [r, setR] = useState<{ agent: { operator_address: string; share_percent: string; depth: number }; remaining: { can_draw: string; remaining_window: string; remaining_lifetime: string; vault_available: string }; mandate: { id: string; per_purchase_cap: string; per_seller_pct: number; max_depth: number } } | null>(null);

  const resolve = () =>
    run('resolve', async () => {
      if (!ref.trim()) throw new Error('enter a name or an address');
      const res = await client.resolveAgent(ref.trim());
      setR(res as unknown as { agent: { operator_address: string; share_percent: string; depth: number }; remaining: { can_draw: string; remaining_window: string; remaining_lifetime: string; vault_available: string }; mandate: { id: string; per_purchase_cap: string; per_seller_pct: number; max_depth: number } });
      toast('ok', 'Resolved');
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold text-neutral-900 tracking-tight leading-tight">Resolve an agent</h1>
        <p className="text-[13px] text-neutral-500 mt-1 max-w-xl leading-relaxed">A name, or the address in a payment. The name says which contract to ask; the contract says what the agent may still spend. On Polygon Amoy, where this testnet deployment lives.</p>
      </div>
      <div className={card}>
        <div className="flex items-center gap-2">
          <input className={input} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="sentinel.mira.eth" onKeyDown={(e) => e.key === 'Enter' && resolve()} />
          <button onClick={resolve} disabled={busy !== null} className={btn}>Look it up</button>
        </div>
        {r && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{shortAddress(r.agent.operator_address)}</span>
              <span className="text-xs text-neutral-500">{Number(r.agent.share_percent)}% · {r.agent.depth === 0 ? 'Root' : `Depth ${r.agent.depth}`}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                ['Can be drawn now', `$${r.remaining.can_draw}`],
                ['Window left', `$${r.remaining.remaining_window}`],
                ['Lifetime left', `$${r.remaining.remaining_lifetime}`],
                ['Vault available', `$${r.remaining.vault_available}`],
              ].map(([label, value]) => (
                <div key={label}><div className="text-xs text-neutral-400">{label}</div><div className="text-lg font-semibold mt-1">{value}</div></div>
              ))}
            </div>
            <div className="text-xs text-neutral-500 space-y-1">
              <div>mandate <Mono>{r.mandate.id}</Mono></div>
              <div>per purchase <b className="text-neutral-900">${r.mandate.per_purchase_cap}</b> · per seller <b className="text-neutral-900">{r.mandate.per_seller_pct / 100}%</b> · max depth <b className="text-neutral-900">{r.mandate.max_depth}</b></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
