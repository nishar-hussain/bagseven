'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { Client } from '../lib/client';
import { EMPTY_SESSION, type Session, type Toast } from '../lib/types';

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

  const persist = useCallback((s: Session) => setSession(s), []);

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

  const sectionProps = { session, client, busy, persist, run, toast, onNavigate: (s: string) => setActiveSection(s as Section), forceCreateMandate: forceCreate, onConsumeMandateCreate: () => setForceCreate(false), onNewMandate: () => { setForceCreate(true); setActiveSection('mandate'); } };

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#111827] flex flex-col">
      <Header activeSection={activeSection} onSectionChange={setActiveSection} mandateExists={!!session.mandate} />
      <main className="flex-1 max-w-[1100px] w-full mx-auto px-6 sm:px-8 py-7">
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
