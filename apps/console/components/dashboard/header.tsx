'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { cn } from '../../lib/utils';
import type { Section } from '../../app/page';
import type { MandateSummary } from '../../lib/types';

interface HeaderProps {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  mandateExists?: boolean;
  mandates: MandateSummary[];
  selectedMandateId?: string;
  onMandateChange: (id: string) => void;
}

const nav: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'mandate', label: 'Mandate' },
  { id: 'agents', label: 'Agents' },
  { id: 'refusals', label: 'Refusals' },
  { id: 'resolve', label: 'Resolve' },
];

export function Header({ activeSection, onSectionChange, mandateExists, mandates, selectedMandateId, onMandateChange }: HeaderProps) {
  const visibleNav = mandateExists ? nav.filter((n) => n.id !== 'mandate') : nav;

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
        {mandates.length > 0 && (
          <select
            aria-label="Select mandate"
            value={selectedMandateId ?? ''}
            onChange={(event) => onMandateChange(event.target.value)}
            className="max-w-[220px] rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700"
          >
            {mandates.map((mandate, index) => (
              <option key={mandate.id} value={mandate.id}>
                Mandate {index + 1} · {mandate.status ?? 'active'}
              </option>
            ))}
          </select>
        )}
        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, mounted }) => {
            const ready = mounted;
            return (
              <div {...(!ready && { 'aria-hidden': true, style: { opacity: 0, pointerEvents: 'none' } })}>
                {(() => {
                  if (!ready) return null;
                  if (!account) {
                    return (
                      <button
                        onClick={openConnectModal}
                        className="px-4 py-1.5 rounded-full text-xs font-medium text-white shadow-xs bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        Connect wallet
                      </button>
                    );
                  }
                  return (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-100/90 border border-neutral-200/80 text-xs font-medium text-neutral-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        {chain?.name ?? 'Polygon Amoy'}
                      </div>
                      <button
                        onClick={openConnectModal}
                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium border border-neutral-200/80 bg-white text-neutral-700 hover:bg-neutral-50 transition-colors cursor-pointer"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        {account.displayName}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}
