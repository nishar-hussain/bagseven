'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { Client } from '../lib/client';
import { EMPTY_SESSION, type MandateSummary, type Session, type Toast } from '../lib/types';

import { Header } from '../components/dashboard/header';
import { OverviewSection, MandateSection, AgentsSection, RefusalsSection, ResolveSection } from '../components/dashboard/sections';

export type Section = 'overview' | 'mandate' | 'agents' | 'refusals' | 'resolve';

let toastId = 0;
const nextId = () => `${Date.now().toString(36)}-${(++toastId).toString(36)}`;

export default function Page() {
  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';
  const client = useMemo(() => new Client(gateway), [gateway]);
  const { address } = useAccount();

  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [forceCreate, setForceCreate] = useState(false);
  const [restored, setRestored] = useState(false);
  const [mandates, setMandates] = useState<MandateSummary[]>([]);

  const persist = useCallback((s: Session) => setSession(s), []);

  const refreshMandates = useCallback(async () => {
    if (!address) return;
    try {
      const { mandates: rows } = await client.listMandates(address, 'all');
      setMandates(rows);
    } catch {
      // Older policy processes do not know the development-only `all` scope.
      // Fall back to owner scope so the selector can still update immediately.
      const { mandates: rows } = await client.listMandates(address, 'owner');
      setMandates(rows);
    }
  }, [address, client]);

  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = nextId();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const run = useCallback(
    async (name: string, fn: () => Promise<void>) => {
      setBusy(name);
      try { await fn(); } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'NOT_FOUND' && /mandate|agent/i.test(e.message ?? '') && session.mandate) {
          const fresh = { ...EMPTY_SESSION, ownerAddress: address ?? undefined };
          setSession(fresh);
          setForceCreate(true);
          setActiveSection('mandate');
          try { localStorage.removeItem('bagseven-session'); } catch { /* ignore */ }
          toast('info', 'The saved mandate no longer exists. The console was reset for a fresh mandate.');
          return;
        }
        toast('error', `${e.code ?? 'Error'}: ${e.message ?? String(err)}`);
      } finally { setBusy(null); }
    },
    [address, session.mandate, toast],
  );

  // Restore the persisted session on load BEFORE any persistence happens, so an
  // empty initial render can never clobber the saved mandate/tree/names.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bagseven-session');
      if (raw) setSession({ ...EMPTY_SESSION, ...JSON.parse(raw) });
    } catch { /* ignore */ } finally {
      setRestored(true);
    }
  }, []);

  // RainbowKit owns the connection — sync the connected account to the owner.
  useEffect(() => {
    if (address) setSession((s) => ({ ...s, ownerAddress: address }));
    else setSession((s) => (s.ownerAddress ? { ...s, ownerAddress: undefined } : s));
  }, [address]);

  // Persist the session so a refresh keeps the mandate + operator key + tree.
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem('bagseven-session', JSON.stringify(session)); } catch { /* ignore */ }
  }, [session, restored]);

  // Discover every mandate for the connected owner. Refreshing when the
  // active mandate ID changes also makes a newly-created mandate appear in
  // the selector immediately instead of leaving the old list in memory.
  useEffect(() => {
    if (!restored || !address) return;
    client.listMandates(address, 'all').then(({ mandates: rows }) => {
      setMandates(rows);
      if (rows.length === 0) return;
      if (!session.mandate || !rows.some((row) => row.id === session.mandate?.mandate_id)) {
        const latest = rows[0];
        if (latest) void selectMandate(latest.id);
      }
    }).catch(() => { /* the existing dashboard error handling remains available */ });
  // Refresh when the wallet changes or after the initial session restoration.
  }, [address, restored, session.mandate?.mandate_id]);

  const selectMandate = useCallback(async (id: string) => {
    const payload = await client.getMandate(id) as { mandate: Record<string, unknown>; agents?: Array<Record<string, unknown>>; vault_balance?: string };
    const m = payload.mandate;
    const root = payload.agents?.find((agent) => Number(agent.depth) === 0) ?? payload.agents?.[0];
    if (!root || typeof m.id !== 'string') throw new Error('mandate has no root agent');
    setSession((current) => ({
      ...current,
      ownerAddress: String(m.owner_address),
      operatorAddress: String(m.operator_address),
      vaultBalance: payload.vault_balance,
      tree: payload.agents as Session['tree'],
      mandate: {
        mandate_id: String(m.id),
        root_agent_id: String(root.id),
        contract_address: String(m.contract_address),
        owner_address: String(m.owner_address),
        operator_address: String(m.operator_address),
        budget_per_window: String(m.budget_per_window),
        window_seconds: Number(m.window_seconds),
        lifetime_cap: String(m.lifetime_cap),
        per_purchase_cap: String(m.per_purchase_cap),
        per_seller_pct: Number(m.per_seller_pct),
        max_depth: Number(m.max_depth),
      },
    }));
    setActiveSection('overview');
  }, [client]);

  const sectionProps = { session, client, busy, persist, run, toast, onNavigate: (s: string) => setActiveSection(s as Section), onMandateCreated: () => refreshMandates(), forceCreateMandate: forceCreate, onConsumeMandateCreate: () => setForceCreate(false), onNewMandate: () => { setForceCreate(true); setActiveSection('mandate'); } };

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#111827] flex flex-col lg:pl-64">
      <Header activeSection={activeSection} onSectionChange={setActiveSection} mandateExists={!!session.mandate} mandates={mandates} selectedMandateId={session.mandate?.mandate_id} onMandateChange={(id) => void selectMandate(id)} onRefreshMandates={() => void refreshMandates()} />
      <main className="flex-1 max-w-[1320px] w-full mx-auto px-4 sm:px-8 lg:px-10 py-8">
        <div key={activeSection} className="animate-in fade-in duration-200">
          {activeSection === 'overview' && <OverviewSection {...sectionProps} />}
          {activeSection === 'mandate' && <MandateSection {...sectionProps} />}
          {activeSection === 'agents' && <AgentsSection {...sectionProps} />}
          {activeSection === 'refusals' && <RefusalsSection {...sectionProps} />}
          {activeSection === 'resolve' && <ResolveSection {...sectionProps} />}
        </div>
      </main>

      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm shadow-lg">
            <span className="font-bold">{t.kind === 'ok' ? '✓' : t.kind === 'error' ? '✗' : 'ℹ'} </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
