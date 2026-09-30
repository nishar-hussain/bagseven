'use client';

import { useEffect, useState } from 'react';
import { Client } from '../../lib/client';
import type { Session } from '../../lib/types';
import {
  CHAIN_ID,
  mandateCanonical,
  shortAddress,
  signMessage,
  signSpendIntent,
  spawnCanonical,
  withdrawCanonical,
} from '../../lib/wallet';

export interface SectionProps {
  session: Session;
  client: Client;
  busy: string | null;
  persist: (s: Session) => void;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
  onNavigate?: (s: string) => void;
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs">{children}</span>;

const card = 'bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]';
const input = 'w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none bg-white focus:ring-2 focus:ring-neutral-900/10';
const btn = 'px-5 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer';
const btnGhost = 'px-5 py-2 rounded-full text-sm font-medium text-neutral-700 border border-neutral-200/90 bg-white hover:bg-neutral-50 transition disabled:opacity-50 cursor-pointer';

export function OverviewSection(props: SectionProps) {
  const { session, client, persist, run, toast, onNavigate } = props;
  const [o, setO] = useState<Record<string, unknown> | null>(null);

  const load = () =>
    run('load overview', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const overview = await client.mandateOverview(session.mandate.mandate_id);
      setO(overview);
      persist({ ...session, tree: (overview.agents as Session['tree']) ?? [], vaultBalance: overview.vault_available as string });
      toast('ok', 'Refreshed');
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
          <button onClick={() => onNavigate?.('agents')} className={btnGhost}>Spawn agent</button>
          <button onClick={() => onNavigate?.('mandate')} className={btnGhost}>Withdraw</button>
          <button onClick={() => onNavigate?.('mandate')} className={btn}>Fund vault</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stat('Spent this window', `$${data.spent_this_window ?? '0.00'} of $${data.budget_per_window ?? '0'}`, 'Across the whole tree · resets every 24 hours')}
        {stat('Spent in total', `$${data.spent_total ?? '0.00'} of $${data.lifetime_cap ?? '0'}`, 'The lifetime cap never refills')}
        {stat('Can be drawn now', `$${data.can_be_drawn_now ?? '0.00'}`, 'The tightest bound on the root, including the vault')}
        {stat('Agents', String(agents.length), `${live} live · ${revoked} revoked · ${levels} level${levels > 1 ? 's' : ''}`)}
      </div>

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
                <span className="font-mono font-semibold">${r.amount}</span>
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
          {termRow('Budget per window', `$${session.mandate.budget_per_window}`)}
          {termRow('Window', `${Math.round(session.mandate.window_seconds / 3600)} hours`)}
          {termRow('Lifetime cap', `$${session.mandate.lifetime_cap}`)}
          {termRow('Per purchase', `$${session.mandate.per_purchase_cap}`)}
          {termRow('Per seller', `${session.mandate.per_seller_pct / 100}%`)}
          {termRow('Max depth', String(session.mandate.max_depth))}
          {termRow('Operator', shortAddress(session.mandate.operator_address))}
        </div>
      </div>
    </div>
  );
}

export function MandateSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [budget, setBudget] = useState('20');
  const [windowH, setWindowH] = useState('24 hours');
  const [lifetime, setLifetime] = useState('100');
  const [perPurchase, setPerPurchase] = useState('1');
  const [sellerPct, setSellerPct] = useState('35');
  const [maxDepth, setMaxDepth] = useState('3');
  const [operator, setOperator] = useState(session.operatorAddress ?? '');
  const [fundAmt, setFundAmt] = useState('50');
  const [withdrawAmt, setWithdrawAmt] = useState('10');
  const [spendAmt, setSpendAmt] = useState('0.50');
  const [recipient, setRecipient] = useState('');
  const [last, setLast] = useState<{ decision?: string; bound?: string; tx_hash?: string } | null>(null);

  const windowSeconds = windowH === '24 hours' ? 86400 : windowH === '12 hours' ? 43200 : 3600;
  // The typed value is the operator; if left empty it falls back to your creator wallet.
  const effectiveOperator = operator.trim() || session.ownerAddress || '';

  // Restore the persisted operator into the field after a refresh.
  useEffect(() => {
    if (!operator && session.operatorAddress) setOperator(session.operatorAddress);
  }, [operator, session.operatorAddress]);

  const sign = () =>
    run('sign mandate', async () => {
      if (!session.ownerAddress) throw new Error('connect your wallet first (top right)');
      if (!effectiveOperator) throw new Error('enter an operator address (or connect your wallet)');
      const canonical = mandateCanonical({ owner: session.ownerAddress, operator: effectiveOperator, budgetPerWindow: budget, windowSeconds, lifetimeCap: lifetime, perPurchaseCap: perPurchase, perSellerPct: Math.round(Number(sellerPct) * 100), maxDepth: Number(maxDepth) });
      const signature = await signMessage(canonical);
      const m = await client.createMandate({
        owner_address: session.ownerAddress,
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
      persist({ ...session, operatorAddress: effectiveOperator, mandate: { mandate_id: m.mandate_id, root_agent_id: m.root_agent_id, contract_address: m.contract_address, owner_address: session.ownerAddress, operator_address: effectiveOperator, budget_per_window: budget, window_seconds: windowSeconds, lifetime_cap: lifetime, per_purchase_cap: perPurchase, per_seller_pct: Math.round(Number(sellerPct) * 100), max_depth: Number(maxDepth) } });
      toast('ok', `Mandate signed by ${shortAddress(session.ownerAddress)} — immutable`);
    });

  const fund = () =>
    run('fund vault', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const res = await client.fundVault(session.mandate.mandate_id, fundAmt);
      persist({ ...session, vaultBalance: res.vault_balance });
      toast('ok', `Vault funded — balance $${res.vault_balance}`);
    });

  const withdraw = () =>
    run('withdraw', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!session.ownerAddress) throw new Error('connect your wallet first');
      const canonical = withdrawCanonical({ mandateId: session.mandate.mandate_id, amount: withdrawAmt, to: session.ownerAddress });
      const signature = await signMessage(canonical);
      const res = await client.withdrawVault(session.mandate.mandate_id, { amount: withdrawAmt, to_address: session.ownerAddress, chain_id: CHAIN_ID, signature });
      persist({ ...session, vaultBalance: res.vault_balance });
      toast('ok', `Withdrew $${withdrawAmt} — balance $${res.vault_balance}`);
    });

  const spend = () =>
    run('spend intent', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!session.ownerAddress) throw new Error('connect your wallet first (it signs the spend)');
      const agentId = session.mandate.root_agent_id;
      const nonce = Math.floor(Date.now() / 1000);
      // The operator is the key you provided (your creator wallet) — MetaMask signs.
      const signature = await signSpendIntent({ agentId, amount: spendAmt, recipient: recipient.trim() as `0x${string}`, nonce, timestamp: nonce, chainId: CHAIN_ID }, session.ownerAddress);
      const res = await client.spendIntent({ agent_id: agentId, amount: spendAmt, recipient: recipient.trim(), nonce, timestamp: nonce, chain_id: CHAIN_ID, signature });
      setLast(res);
      toast(res.decision === 'allow' ? 'ok' : 'info', res.decision === 'allow' ? `Executed on-chain ${res.tx_hash?.slice(0, 14)}…` : `Refused — ${res.bound}`);
    });

  if (session.mandate) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Mandate</h1>
          <p className="text-[13px] text-neutral-500 mt-1">Signed once · immutable · enforced on-chain.</p>
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
            <button onClick={spend} disabled={busy !== null || !session.ownerAddress} className={btn}>Run and pay ${spendAmt}</button>
            {!session.ownerAddress && <p className="text-xs text-amber-600">Connect your wallet to sign spends.</p>}
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
      <div>
        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">New mandate</h1>
        <p className="text-[13px] text-neutral-500 mt-1 max-w-lg">One budget for every agent under it. You sign once, and it cannot be edited afterwards.</p>
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
            <p className="text-[12px] text-neutral-400 mt-0.5 mb-4">The key you provide — defaults to your connected wallet. Fixed here and cannot be changed later.</p>
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
              <button onClick={sign} disabled={busy !== null || !session.ownerAddress || !effectiveOperator} className={`${btn} w-full`}>{busy ? 'Signing…' : 'Sign mandate'}</button>
              {!session.ownerAddress && <p className="mt-2 text-xs text-amber-600">Connect your wallet first (top right).</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentsSection(props: SectionProps) {
  const { session, client, busy, persist, run, toast } = props;
  const [parentId, setParentId] = useState('');
  const [operator, setOperator] = useState('');
  const [share, setShare] = useState('50');

  const load = () =>
    run('load agents', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      const overview = await client.mandateOverview(session.mandate.mandate_id);
      const tree = (overview.agents as Session['tree']) ?? [];
      persist({ ...session, tree });
      if (!parentId && tree[0]) setParentId(tree[0].id);
    });

  const spawn = () =>
    run('spawn agent', async () => {
      if (!session.mandate) throw new Error('sign a mandate first');
      if (!session.ownerAddress) throw new Error('connect your wallet first');
      const parent = parentId || session.mandate.root_agent_id;
      const canonical = spawnCanonical({ mandateId: session.mandate.mandate_id, parentAgentId: parent, operator, sharePercent: Number(share) });
      const signature = await signMessage(canonical);
      const child = await client.spawnAgent(session.mandate.mandate_id, { parent_agent_id: parent, operator_address: operator, share_percent: Number(share), chain_id: CHAIN_ID, signature });
      toast('ok', `Spawned agent at depth ${child.depth} (${share}%)`);
      await load();
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Agents</h1>
        <p className="text-[13px] text-neutral-500 mt-1">A child can only ever be narrower than its parent.</p>
      </div>
      <div className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Agent tree</h2>
          <button onClick={load} disabled={busy !== null} className={btnGhost}>{busy ? '…' : 'Load'}</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {(session.tree ?? []).map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-sm">
              <span className="font-mono text-neutral-400">{'· '.repeat(a.depth)}</span>
              <span className="font-medium">{shortAddress(a.operator_address)}</span>
              <span className="text-xs text-neutral-500">{Number(a.share_percent)}% · depth {a.depth}</span>
              <span className={`ml-auto text-xs ${a.status === 'active' ? 'text-green-600' : 'text-amber-600'}`}>{a.status}</span>
            </div>
          ))}
          {(session.tree ?? []).length === 0 && <p className="text-sm text-neutral-500">No agents yet.</p>}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-base font-semibold text-neutral-900 mb-4">Spawn an agent</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-neutral-700 mb-1.5 block">Parent</label>
            <select className={`${input} appearance-none cursor-pointer`} value={parentId || session.mandate?.root_agent_id || ''} onChange={(e) => setParentId(e.target.value)}>
              {(session.tree ?? []).map((a) => <option key={a.id} value={a.id}>{'·'.repeat(a.depth)} {shortAddress(a.operator_address)}</option>)}
              <option value={session.mandate?.root_agent_id}>root</option>
            </select>
          </div>
          <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Operator address</label><input className={input} value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="0x…" /></div>
          <div><label className="text-xs font-medium text-neutral-700 mb-1.5 block">Share of parent (%)</label><input className={input} value={share} onChange={(e) => setShare(e.target.value)} /></div>
        </div>
        <button onClick={spawn} disabled={busy !== null || !operator} className={`${btn} mt-4`}>{busy === 'spawn agent' ? 'Spawning…' : 'Spawn'}</button>
      </div>
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
      if (!ref.trim()) throw new Error('enter an agent id or operator address');
      const res = await client.resolveAgent(ref.trim());
      setR(res as unknown as { agent: { operator_address: string; share_percent: string; depth: number }; remaining: { can_draw: string; remaining_window: string; remaining_lifetime: string; vault_available: string }; mandate: { id: string; per_purchase_cap: string; per_seller_pct: number; max_depth: number } });
      toast('ok', 'Resolved');
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight leading-tight">Resolve</h1>
        <p className="text-[13px] text-neutral-500 mt-1">Look up an agent and read exactly what it may still spend.</p>
      </div>
      <div className={card}>
        <div className="flex items-center gap-2">
          <input className={input} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="agent id or 0x operator address" />
          <button onClick={resolve} disabled={busy !== null} className={btn}>Lookup</button>
        </div>
        {r && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{shortAddress(r.agent.operator_address)}</span>
              <span className="text-xs text-neutral-500">{Number(r.agent.share_percent)}% · depth {r.agent.depth}</span>
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