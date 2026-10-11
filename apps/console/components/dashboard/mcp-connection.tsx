'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildLocalMcpConfig, localMcpUrl } from '../../lib/mcp';
import type { AgentRow, Session } from '../../lib/types';
import { Client } from '../../lib/client';

interface Props {
  session: Session;
  client: Client;
  agents: AgentRow[];
  busy: boolean;
  run: (name: string, fn: () => Promise<void>) => Promise<void>;
  toast: (kind: 'ok' | 'error' | 'info', message: string) => void;
}

type Readiness = {
  state: 'idle' | 'checking' | 'ready' | 'error';
  message?: string;
};

export function McpConnection({ session, client, agents, busy, run, toast }: Props) {
  const activeAgents = useMemo(() => agents.filter((agent) => agent.status === 'active'), [agents]);
  const [selectedId, setSelectedId] = useState('');
  const [readiness, setReadiness] = useState<Readiness>({ state: 'idle' });

  useEffect(() => {
    if (!selectedId || !activeAgents.some((agent) => agent.id === selectedId)) {
      setSelectedId(activeAgents[0]?.id ?? '');
      setReadiness({ state: 'idle' });
    }
  }, [activeAgents, selectedId]);

  const selected = activeAgents.find((agent) => agent.id === selectedId);
  const config = selected ? buildLocalMcpConfig({ workerId: selected.id }) : null;
  const configText = config ? JSON.stringify(config, null, 2) : '';

  const copy = async () => {
    if (!configText) return;
    await navigator.clipboard.writeText(configText);
    toast('ok', 'Local MCP configuration copied');
  };

  const check = () => run('check MCP connection', async () => {
    if (!selected) throw new Error('select an active worker first');
    if (!session.mandate) throw new Error('create a mandate first');
    setReadiness({ state: 'checking', message: 'Checking mandate, vault, and local MCP…' });
    try {
      const resolved = await client.resolveAgent(selected.id) as {
        agent?: { id?: string; status?: string };
        mandate?: { status?: string };
        remaining?: { vault_available?: string; can_draw?: string };
      };
      if (resolved.agent?.status !== 'active') throw new Error('selected worker is not active');
      if (resolved.mandate?.status !== 'active') throw new Error('worker mandate is not active');
      if (Number(resolved.remaining?.vault_available ?? 0) <= 0) throw new Error('vault has no available USDC');

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4000);
      let health: { ok?: boolean; worker?: string };
      try {
        const response = await fetch(localMcpUrl(), { signal: controller.signal });
        health = await response.json() as { ok?: boolean; worker?: string };
        if (!response.ok) throw new Error(`MCP health returned HTTP ${response.status}`);
      } finally {
        window.clearTimeout(timeout);
      }
      if (health.ok !== true || health.worker !== selected.id) throw new Error('MCP is running, but it is bound to a different worker');
      setReadiness({ state: 'ready', message: `MCP is reachable and bound to ${selected.name ?? 'the selected worker'}. Available now: $${resolved.remaining?.can_draw ?? '0.00'}.` });
      toast('ok', 'Worker, mandate, vault, and MCP connection are ready');
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? 'MCP health check timed out' : (error as Error).message;
      setReadiness({ state: 'error', message });
      throw new Error(message);
    }
  });

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/80 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">Connect your custom agent</h2>
          <p className="text-xs text-neutral-500 mt-1 max-w-2xl">This local connection binds one MCP process to one active Bagseven worker. Keys and internal service tokens are never included.</p>
        </div>
        <span className={`text-xs rounded-full px-3 py-1 ${readiness.state === 'ready' ? 'bg-green-50 text-green-700' : readiness.state === 'error' ? 'bg-red-50 text-red-700' : 'bg-neutral-100 text-neutral-600'}`}>
          {readiness.state === 'ready' ? 'Ready' : readiness.state === 'checking' ? 'Checking…' : readiness.state === 'error' ? 'Needs attention' : 'Not checked'}
        </span>
      </div>

      {activeAgents.length === 0 ? (
        <p className="mt-4 text-sm text-amber-700">There is no active worker. Create or activate a worker before connecting an agent.</p>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <label className="text-xs font-medium text-neutral-700 block">Selected worker</label>
            <select className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm text-neutral-900 bg-white" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setReadiness({ state: 'idle' }); }}>
              {activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name ?? `${agent.operator_address.slice(0, 8)}…${agent.operator_address.slice(-4)}`} · {agent.id.slice(0, 8)}…</option>)}
            </select>
            <div className="rounded-xl bg-neutral-50 border border-neutral-100 p-3 text-xs text-neutral-600 space-y-1">
              <div className="flex justify-between"><span>Worker status</span><b className="text-green-700">Active</b></div>
              <div className="flex justify-between"><span>Mandate</span><b>{session.mandate ? 'Selected mandate' : 'Missing'}</b></div>
              <div className="flex justify-between"><span>Local MCP</span><b>127.0.0.1:4009</b></div>
            </div>
            <button onClick={check} disabled={busy || !selected} className="px-5 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">Test connection</button>
            {readiness.message && <p className={`text-xs ${readiness.state === 'error' ? 'text-red-700' : readiness.state === 'ready' ? 'text-green-700' : 'text-neutral-500'}`}>{readiness.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2"><label className="text-xs font-medium text-neutral-700">Generated local configuration</label><button onClick={copy} disabled={!configText} className="text-xs font-medium text-neutral-700 border border-neutral-200 rounded-full px-3 py-1 hover:bg-neutral-50 disabled:opacity-50">Copy configuration</button></div>
            <pre className="rounded-xl bg-neutral-950 text-neutral-100 p-4 text-xs leading-5 overflow-x-auto min-h-[170px]">{configText || 'Select an active worker to generate configuration.'}</pre>
            <p className="text-[11px] text-neutral-400 mt-2">Run the MCP command from the Bagseven repository. The generated block contains only routing settings and the selected worker ID.</p>
          </div>
        </div>
      )}
    </div>
  );
}
