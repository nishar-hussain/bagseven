'use client';

import { useState } from 'react';
import { cn } from '../../lib/utils';
import { shortAddress } from '../../lib/wallet';
import type { Section } from '../../app/page';

interface HeaderProps {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  userWallet?: string;
  onConnectWallet?: () => Promise<void>;
  onDisconnectWallet?: () => void;
  mandateExists?: boolean;
}

const nav: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'mandate', label: 'Mandate' },
  { id: 'agents', label: 'Agents' },
  { id: 'refusals', label: 'Refusals' },
  { id: 'resolve', label: 'Resolve' },
];

export function Header({ activeSection, onSectionChange, userWallet, onConnectWallet, onDisconnectWallet, mandateExists }: HeaderProps) {
  const [busy, setBusy] = useState(false);
  const visibleNav = mandateExists ? nav.filter((n) => n.id !== 'mandate') : nav;
  const connect = async () => {
    setBusy(true);
    try { await onConnectWallet?.(); } catch { /* toast handled upstream */ } finally { setBusy(false); }
  };

  return (
    <header className="h-14 bg-white border-b border-neutral-200/80 sticky top-0 z-40 flex items-center justify-between px-6 sm:px-8">
      <div className="flex items-center gap-6 sm:gap-7">
        <div className="flex items-center gap-2.5 select-none">
          <div className="w-6 h-6 rounded-md bg-[#e0314b] flex items-center justify-center p-1 shadow-xs">
            <div className="grid grid-cols-2 gap-[2.5px] items-center justify-center">
              <span className="w-1.2 h-1.2 rounded-full bg-white block" />
              <span className="w-1.2 h-1.2 rounded-full bg-white block" />
              <span className="w-1.2 h-1.2 rounded-full bg-white block" />
              <span className="w-1.2 h-1.2 rounded-full bg-white block" />
              <span className="w-1.2 h-1.2 rounded-full bg-white block" />
              <span className="w-1.2 h-1.2 rounded-full bg-white block" />
            </div>
          </div>
          <span className="font-bold text-[15px] tracking-tight text-neutral-900">Bagseven</span>
        </div>

        <nav className="flex items-center gap-5 sm:gap-6 text-[13px]">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                'transition-all cursor-pointer text-[13px]',
                activeSection === item.id
                  ? 'text-neutral-900 font-medium border border-neutral-300/90 rounded-full px-3 py-0.5 shadow-2xs bg-white'
                  : 'text-neutral-500 hover:text-neutral-900 px-1 py-0.5 font-normal',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100/90 border border-neutral-200/80 text-xs font-medium text-neutral-700">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
          <span>Local chain</span>
        </div>
        {userWallet ? (
          <button
            onClick={() => onDisconnectWallet?.()}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium border border-neutral-200/80 bg-white text-neutral-700 hover:bg-neutral-50 transition-colors cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {shortAddress(userWallet)}
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={busy}
            className="px-4 py-1.5 rounded-full text-xs font-medium text-white shadow-xs bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity disabled:opacity-60 cursor-pointer"
          >
            {busy ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>
    </header>
  );
}