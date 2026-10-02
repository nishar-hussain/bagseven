'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Client } from '../lib/client';
import { EMPTY_SESSION, type Session, type Toast } from '../lib/types';
import { connectWallet, getWalletAccounts, hasWallet, shortAddress, watchAccountChanges } from '../lib/wallet';

import { Header } from '../components/dashboard/header';
import { OverviewSection, MandateSection, AgentsSection, RefusalsSection, ResolveSection } from '../components/dashboard/sections';

export type Section = 'overview' | 'mandate' | 'agents' | 'refusals' | 'resolve';

let toastId = 0;
const nextId = () => `${Date.now().toString(36)}-${(++toastId).toString(36)}`;

export default function Page() {
  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';
  const client = useMemo(() => new Client(gateway), [gateway]);

  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [forceCreate, setForceCreate] = useState(false);

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
        toast('error', `${e.code ?? 'Error'}: ${e.message ?? String(err)}`);
      } finally { setBusy(null); }
    },
    [toast],
  );

  const onConnectWallet = useCallback(async () => {
    if (!hasWallet()) throw new Error('No browser wallet (MetaMask) detected.');
    const address = await connectWallet();
    setSession((s) => ({ ...s, ownerAddress: address }));
    toast('ok', 'Wallet connected');
  }, [toast]);

  const onDisconnectWallet = useCallback(() => {
    setSession((s) => ({ ...s, ownerAddress: undefined }));
    toast('info', 'Wallet disconnected');
  }, [toast]);

  // Keep the connection across refreshes: restore the persisted session, reconcile
// the owner against the wallet's authorized accounts (never claim a stale one),
// and follow live account switches via accountsChanged.
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const raw = localStorage.getItem('bagseven-session');
      if (raw) setSession({ ...EMPTY_SESSION, ...JSON.parse(raw) });
    } catch { /* ignore */ }
    const accounts = await getWalletAccounts();
    if (cancelled) return;
    if (accounts.length > 0) {
      setSession((s) => {
        const cur = s.ownerAddress?.toLowerCase();
        if (!cur || !accounts.some((a) => a.toLowerCase() === cur)) {
          return { ...s, ownerAddress: accounts[0] };
        }
        return s;
      });
    }
  })();
  const off = watchAccountChanges((accounts) => {
    if (cancelled) return;
    const account = accounts[0];
    if (account) {
      setSession((s) => ({ ...s, ownerAddress: account }));
      toast('info', `Account switched → ${shortAddress(account)}`);
    } else {
      setSession((s) => ({ ...s, ownerAddress: undefined }));
    }
  });
  return () => {
    cancelled = true;
    off();
  };
}, [toast]);

// Persist the session so a refresh keeps the wallet connection + operator key.
useEffect(() => {
  try { localStorage.setItem('bagseven-session', JSON.stringify(session)); } catch { /* ignore */ }
}, [session]);

const sectionProps = { session, client, busy, persist, run, toast, onNavigate: (s: string) => setActiveSection(s as Section), forceCreateMandate: forceCreate, onConsumeMandateCreate: () => setForceCreate(false), onNewMandate: () => { setForceCreate(true); setActiveSection('mandate'); } };

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#111827] flex flex-col">
      <Header activeSection={activeSection} onSectionChange={setActiveSection} userWallet={session.ownerAddress} onConnectWallet={onConnectWallet} onDisconnectWallet={onDisconnectWallet} mandateExists={!!session.mandate} />
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