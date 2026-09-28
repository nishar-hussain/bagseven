'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleClient } from '../lib/client';
import { EMPTY_SESSION, type LogEntry, type Session, type StepKey, type Toast } from '../lib/types';
import { Card, Copy, KV } from '../components/ui';
import { StepBootstrap, StepWallet, StepPolicy, StepSpend, StepSettle, StepMarketplace, type StepProps } from '../components/steps';

const STEPS: Array<{ key: StepKey; label: string; hint: string }> = [
  { key: 'bootstrap', label: 'Create agent', hint: 'org · guardian · identity' },
  { key: 'wallet', label: 'Wallet & funds', hint: 'provision · credit' },
  { key: 'policy', label: 'Policy', hint: 'limits · thresholds' },
  { key: 'spend', label: 'Spend intents', hint: 'allow · deny · token' },
  { key: 'settle', label: 'Reserve & settle', hint: 'co-sign · receipt' },
  { key: 'marketplace', label: 'Marketplace', hint: 'browse · pay · execute' },
];

const ORDER: StepKey[] = ['bootstrap', 'wallet', 'policy', 'spend', 'settle', 'marketplace'];

function isDone(s: Session, key: StepKey): boolean {
  switch (key) {
    case 'bootstrap':
      return !!s.agentId && s.agentStatus === 'active';
    case 'wallet':
      return !!s.walletId;
    case 'policy':
      return !!s.policy;
    case 'spend':
      return s.spendHistory.length > 0;
    case 'settle':
      return !!s.txHash;
    case 'marketplace':
      return (s.toolExecutions ?? 0) > 0;
  }
}

let toastId = 0;
const UI_KEY = 'agentos-console';

const nextId = () => `${Date.now().toString(36)}-${(++toastId).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default function Page() {
  const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000';
  const client = useMemo(() => new ConsoleClient(gateway), [gateway]);

  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [active, setActive] = useState<StepKey>('bootstrap');
  const [busy, setBusy] = useState<string | null>(null);
  const [feed, setFeed] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [restored, setRestored] = useState(false);

  // Restore the full UI state (session + active step + activity feed) after refresh.
  // If the restored agent no longer exists in the backend (e.g. the DB was reset),
  // clear the stale session automatically so the user starts fresh instead of 404ing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(UI_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { session?: Session; active?: StepKey; feed?: LogEntry[] };
          if (saved.session?.agentId && saved.session.signingKeyPem) {
            client.setAgent(saved.session.agentId, saved.session.signingKeyPem);
            const reset = () => {
              localStorage.removeItem(UI_KEY);
              if (!cancelled) {
                setSession(EMPTY_SESSION);
                setActive('bootstrap');
                setFeed([]);
                setToasts((t) => [...t, { id: nextId(), kind: 'info', message: 'Previous session was wiped — starting fresh.' }]);
              }
            };
            try {
              await client.getAgent(saved.session.agentId);
              // If the session remembers a wallet, make sure it still exists too.
              if (saved.session.walletId) {
                const w = await client.getWallet(saved.session.agentId);
                const walletExists = w.wallets.some((x) => x.wallet.id === saved.session!.walletId);
                if (!walletExists) throw { status: 404 };
              }
            } catch (err) {
              if ((err as { status?: number }).status === 404) {
                reset();
                return;
              }
              // network/other error: keep the restored session; it's not stale.
            }
          }
          if (saved.session) setSession(saved.session);
          if (saved.active) setActive(saved.active);
          // Re-key restored feed entries so ids can never collide across refreshes.
          if (saved.feed) setFeed(saved.feed.map((e) => ({ ...e, id: nextId() })));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Persist everything whenever any of it changes — a refresh restores it all.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ session, active, feed }));
    } catch {
      /* ignore */
    }
  }, [session, active, feed, restored]);

  const persist = useCallback((s: Session) => {
    setSession(s);
  }, []);

  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = nextId();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const pushLog = useCallback((kind: LogEntry['kind'], text: string) => {
    setFeed((f) => [{ id: nextId(), kind, text }, ...f].slice(0, 60));
  }, []);

  const run: StepProps['run'] = useCallback(
    async (name, fn) => {
      setBusy(name);
      pushLog('in', name);
      try {
        await fn();
        pushLog('ok', name);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        pushLog('err', name);
        toast('error', `${e.code ?? 'Error'}: ${e.message ?? String(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [pushLog, toast],
  );

  const onNext = useCallback(() => {
    setActive((cur) => ORDER[Math.min(ORDER.indexOf(cur) + 1, ORDER.length - 1)]!);
  }, []);

  const stepProps: StepProps = { session, client, busy, persist, run, toast, onNext };
  const current = STEPS.find((s) => s.key === active)!;
  const doneCount = ORDER.filter((k) => isDone(session, k)).length;

  const reset = () => {
    localStorage.removeItem(UI_KEY);
    setSession(EMPTY_SESSION);
    setFeed([]);
    setActive('bootstrap');
    toast('info', 'Session reset');
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          AgentOS
          <span className="sub">Console</span>
        </div>
        <div className="spacer" />
        <span className="chip">
          <span className="led" />
          {gateway}
        </span>
      </header>

      <div className="shell">
        <aside className="sidebar">
          <Card title="Setup flow">
            <div className="steps">
              {STEPS.map((s) => (
                <button
                  key={s.key}
                  className={`step-item ${active === s.key ? 'active' : ''} ${isDone(session, s.key) ? 'done' : ''}`}
                  onClick={() => setActive(s.key)}
                >
                  <span className="step-num">{isDone(session, s.key) ? '✓' : ORDER.indexOf(s.key) + 1}</span>
                  <span>
                    <span className="step-label">{s.label}</span>
                    <br />
                    <span className="muted small">{s.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="spread mt-10">
              <span className="small muted">{doneCount}/{STEPS.length} complete</span>
              <button className="copy" onClick={reset}>reset session</button>
            </div>
          </Card>

          {session.agentId && (
            <Card title="Agent">
              <KV k="status" v={session.agentStatus} />
              <KV k="org" v={session.orgName} />
              <KV k="agent_id" v={<span>{session.agentId.slice(0, 12)}… <Copy value={session.agentId} /></span>} />
              <KV k="wallet" v={session.walletAddress ? session.walletAddress.slice(0, 10) + '…' : '—'} />
              <KV k="policy" v={session.policy ? `v${session.policy.version}` : '—'} />
              {session.balances.map((b) => (
                <KV key={b.token} k={`${b.token} balance`} v={`${Number(b.amount).toFixed(2)} (${Number(b.reservedAmount).toFixed(2)} reserved)`} />
              ))}
              <KV k="settlements" v={session.txHash ? '1 ✓' : '0'} />
            </Card>
          )}

          <Card title="Activity">
            <div className="feed">
              {feed.length === 0 && <span className="empty">No activity yet.</span>}
              {feed.map((e) => (
                <div key={e.id} className={`entry ${e.kind === 'ok' ? 'ok' : e.kind === 'err' ? 'err' : ''}`}>
                  <span className="tick">{e.kind === 'in' ? '→' : e.kind === 'ok' ? '✓' : '✗'}</span>
                  <span>{e.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </aside>

        <main>
          {current.key === 'bootstrap' && <StepBootstrap {...stepProps} />}
          {current.key === 'wallet' && <StepWallet {...stepProps} />}
          {current.key === 'policy' && <StepPolicy {...stepProps} />}
          {current.key === 'spend' && <StepSpend {...stepProps} />}
          {current.key === 'settle' && <StepSettle {...stepProps} />}
          {current.key === 'marketplace' && <StepMarketplace {...stepProps} />}
        </main>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'ok' ? 'ok' : t.kind === 'error' ? 'error' : ''}`}>
            <span className="mark">{t.kind === 'ok' ? '✓' : t.kind === 'error' ? '✗' : 'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
}