'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { cn } from '../../lib/utils';
import type { Section } from '../../app/page';
import type { MandateSummary } from '../../lib/types';
import { CHAIN_ID, CHAIN_NAME } from '../../lib/wallet';

interface HeaderProps {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  mandateExists?: boolean;
  mandates: MandateSummary[];
  selectedMandateId?: string;
  onMandateChange: (id: string) => void;
  onRefreshMandates: () => void;
}

const nav: { id: Section; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '⌂' },
  { id: 'mandate', label: 'Mandate', icon: '◇' },
  { id: 'agents', label: 'Agents', icon: '◉' },
  { id: 'refusals', label: 'Refusals', icon: '⊘' },
  { id: 'resolve', label: 'Resolve', icon: '✓' },
];

function Brand() {
  return (
    <div className="flex items-center gap-4 px-2">
      <img src="/icon.svg" alt="" aria-hidden="true" className="h-12 w-12 shrink-0 rounded-xl shadow-[0_2px_6px_rgba(15,23,42,0.08)]" />
      <div className="min-w-0"><div className="text-[22px] font-bold leading-none tracking-[-0.04em] text-neutral-950">Bagseven</div></div>
    </div>
  );
}

function MandatePicker({ mandates, selectedMandateId, onMandateChange, onRefreshMandates }: Pick<HeaderProps, 'mandates' | 'selectedMandateId' | 'onMandateChange' | 'onRefreshMandates'>) {
  if (mandates.length === 0) return null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Workspace</span><button onClick={onRefreshMandates} className="rounded-md px-1.5 py-1 text-xs text-neutral-400 hover:bg-white hover:text-neutral-800" title="Refresh mandates" aria-label="Refresh mandates">↻</button></div>
      <select aria-label="Select mandate" value={selectedMandateId ?? ''} onChange={(event) => onMandateChange(event.target.value)} className="w-full truncate rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-800 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200">
        {mandates.map((mandate, index) => <option key={mandate.id} value={mandate.id}>Mandate {index + 1} · {mandate.contract_address?.slice(0, 8) ?? 'pending'}</option>)}
      </select>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{mandates.find((mandate) => mandate.id === selectedMandateId)?.status ?? 'active'}</div>
    </div>
  );
}

function WalletControl({ compact = false }: { compact?: boolean }) {
  return <ConnectButton.Custom>{({ account, chain, openConnectModal, mounted }) => {
    if (!mounted) return null;
    if (!account) return <button onClick={openConnectModal} className="w-full rounded-xl bg-neutral-950 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-neutral-800">Connect wallet</button>;
    return <button onClick={openConnectModal} className={cn('flex items-center gap-2 rounded-xl border border-neutral-200 bg-white text-left text-xs text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50', compact ? 'px-3 py-2' : 'w-full px-3 py-2.5')}><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><span className="min-w-0 flex-1 truncate">{account.displayName}</span>{!compact && <span className="text-[10px] text-neutral-400">{chain?.name ?? CHAIN_NAME}</span>}</button>;
  }}</ConnectButton.Custom>;
}

function Navigation({ activeSection, onSectionChange, mandateExists, mobile = false }: Pick<HeaderProps, 'activeSection' | 'onSectionChange' | 'mandateExists'> & { mobile?: boolean }) {
  const visibleNav = mandateExists ? nav.filter((item) => item.id !== 'mandate') : nav;
  return <nav className={mobile ? 'flex min-w-max gap-1' : 'space-y-1'}>{!mobile && <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Navigation</div>}{visibleNav.map((item) => <button key={item.id} onClick={() => onSectionChange(item.id)} className={cn('flex items-center gap-3 rounded-xl text-sm transition', mobile ? 'w-auto whitespace-nowrap px-3 py-2' : 'w-full px-3 py-2.5', activeSection === item.id ? 'bg-neutral-950 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950')}>{!mobile && <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg text-sm', activeSection === item.id ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-500')}>{item.icon}</span>}{item.label}</button>)}</nav>;
}

export function Header(props: HeaderProps) {
  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-neutral-200 bg-white px-4 py-5 lg:flex">
      <Brand /><div className="mt-8"><MandatePicker {...props} /></div><div className="mt-7"><Navigation {...props} /></div>
      <div className="mt-auto space-y-4 border-t border-neutral-100 pt-4"><div className="flex items-center gap-2 px-2 text-xs text-neutral-500"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span>{CHAIN_NAME}</span><span className="ml-auto text-[10px] text-neutral-400">{CHAIN_ID}</span></div><WalletControl /><div className="px-2 text-[10px] leading-4 text-neutral-400">Local development workspace<br />Keys stay outside the agent.</div></div>
    </aside>
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden"><div className="flex items-center justify-between gap-3"><Brand /><WalletControl compact /></div><div className="mt-3 overflow-x-auto"><Navigation {...props} mobile /></div><div className="mt-3"><MandatePicker {...props} /></div></header>
  </>;
}
