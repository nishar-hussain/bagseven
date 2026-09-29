'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleClient } from '../lib/client';
import { EMPTY_SESSION, type Session, type Toast } from '../lib/types';
import { connectWallet, ensureSepolia, hasWallet } from '../lib/wallet';

import { Header } from '../components/dashboard/header';
import { MandateSection, AgentsSection, RefusalsSection, ResolveSection, MarketplaceSection } from '../components/dashboard/sections';

export type Section = 'mandate' | 'agents' | 'refusals' | 'resolve' | 'marketplace';

let toastId = 0;
const UI_KEY = 'agentos-console';
const nextId = () => `${Date.now().toString(36)}-${(++toastId).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default function Page() {
  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';
  const client = useMemo(() => new ConsoleClient(gateway), [gateway]);

  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [activeSection, setActiveSection] = useState<Section>('mandate');

  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [restored, setRestored] = useState(false);

  // Restore the full UI state after refresh; if the agent/wallet no longer exist
  // in the backend (e.g. DB reset), clear the stale session automatically.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(UI_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { session?: Session; active?: Section };
          if (saved.session?.agentId && saved.session.signingKeyPem) {
            client.setAgent(saved.session.agentId, saved.session.signingKeyPem);
            const reset = () => {
              localStorage.removeItem(UI_KEY);
              if (!cancelled) {
                setSession(EMPTY_SESSION);
                setToasts((t) => [...t, { id: nextId(), kind: 'info', message: 'Previous session was wiped — starting fresh.' }]);
              }
            };
            try {
              await client.getAgent(saved.session.agentId);
              if (saved.session.walletId) {
                const w = await client.getWallet(saved.session.agentId);
                const exists = w.wallets.some((x) => x.wallet.id === saved.session!.walletId);
                if (!exists) throw { status: 404 };
              }
            } catch (err) {
              if ((err as { status?: number }).status === 404) { reset(); return; }
            }
          }
          if (saved.session) setSession(saved.session);
          if (saved.active) setActiveSection(saved.active);
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ session, active: activeSection })); } catch { /* ignore */ }
  }, [session, activeSection, restored]);

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
    await ensureSepolia();
    setSession((s) => ({ ...s, userWallet: address }));
    toast('ok', `Wallet connected`);
  }, [toast]);

  const onDisconnectWallet = useCallback(() => {
    setSession((s) => ({ ...s, userWallet: undefined }));
    toast('info', 'Wallet disconnected');
  }, [toast]);

  const sectionProps = { session, client, busy, persist, run, toast };

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#111827] flex flex-col">
      <Header activeSection={activeSection} onSectionChange={setActiveSection} gateway={gateway} agentStatus={session.agentStatus} userWallet={session.userWallet} onConnectWallet={onConnectWallet} onDisconnectWallet={onDisconnectWallet} />
      <main className="flex-1 max-w-[1240px] w-full mx-auto px-6 sm:px-8 py-7">
        <div key={activeSection} className="animate-in fade-in duration-200">
          {activeSection === 'mandate' && <MandateSection {...sectionProps} />}
          {activeSection === 'agents' && <AgentsSection {...sectionProps} />}
          {activeSection === 'refusals' && <RefusalsSection {...sectionProps} />}
          {activeSection === 'resolve' && <ResolveSection {...sectionProps} />}
          {activeSection === 'marketplace' && <MarketplaceSection {...sectionProps} />}
        </div>
      </main>

      {/* toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg">
            <span className="font-bold">{t.kind === 'ok' ? '✓' : t.kind === 'error' ? '✗' : 'ℹ'} </span>
            <span className="text-foreground">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}