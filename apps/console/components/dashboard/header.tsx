'use client';

import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { Section } from '../../app/page';
import { ChevronDown } from 'lucide-react';

interface HeaderProps {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  gateway?: string;
  agentStatus?: string;
}

const mainNav: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'refusals', label: 'Refusals' },
  { id: 'resolve', label: 'Resolve' },
];

const moreNav: { id: Section; label: string }[] = [
  { id: 'mandate', label: 'Mandate' },
  { id: 'vault', label: 'Vault' },
  { id: 'identity', label: 'Identity' },
  { id: 'settle', label: 'Reserve & Settle' },
  { id: 'marketplace', label: 'Tool Market' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

export function Header({ activeSection, onSectionChange }: HeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <header className="h-14 bg-white border-b border-neutral-200/80 sticky top-0 z-40 flex items-center justify-between px-6 sm:px-8">
      {/* Left: Brand + Nav */}
      <div className="flex items-center gap-6 sm:gap-7">
        {/* Brand */}
        <div
          onClick={() => onSectionChange('overview')}
          className="flex items-center gap-2.5 cursor-pointer select-none"
        >
          {/* Cordon Red Icon with 6 dots */}
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
          <span className="font-bold text-[15px] tracking-tight text-neutral-900">
            Cordon
          </span>
        </div>

        {/* Separator / Console Pill */}
        <div className="flex items-center gap-4 text-sm">
          <span className="font-semibold text-neutral-900 px-2.5 py-1 rounded-md bg-neutral-100/80 text-[13px]">
            Console
          </span>

          {/* Navigation Links */}
          <nav className="flex items-center gap-5 sm:gap-6 text-[13px]">
            {mainNav.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSectionChange(item.id)}
                  className={cn(
                    'transition-colors font-normal cursor-pointer',
                    isActive
                      ? 'text-neutral-900 font-semibold'
                      : 'text-neutral-500 hover:text-neutral-900',
                  )}
                >
                  {item.label}
                </button>
              );
            })}

            {/* More dropdown for additional sections */}
            <div className="relative">
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className={cn(
                  'flex items-center gap-1 transition-colors font-normal cursor-pointer',
                  moreNav.some((m) => m.id === activeSection)
                    ? 'text-neutral-900 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-900',
                )}
              >
                <span>
                  {moreNav.find((m) => m.id === activeSection)?.label ?? 'More'}
                </span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {moreOpen && (
                <div
                  className="absolute left-0 mt-2 w-44 rounded-xl bg-white border border-neutral-200/90 shadow-lg py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150"
                  onMouseLeave={() => setMoreOpen(false)}
                >
                  {moreNav.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        onSectionChange(item.id);
                        setMoreOpen(false);
                      }}
                      className={cn(
                        'w-full text-left px-3.5 py-1.5 text-xs transition-colors flex items-center justify-between',
                        activeSection === item.id
                          ? 'bg-neutral-100 text-neutral-900 font-semibold'
                          : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
      </div>

      {/* Right: Network + Connect Wallet */}
      <div className="flex items-center gap-3">
        {/* Network pill */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100/90 border border-neutral-200/80 text-xs font-medium text-neutral-700">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
          <span>Ethereum Sepolia</span>
        </div>

        {/* Connect wallet button */}
        <button
          onClick={() => {}}
          className="px-4 py-1.5 rounded-full text-xs font-medium text-white shadow-xs bg-gradient-to-r from-[#9855b9] to-[#c24285] hover:opacity-90 transition-opacity cursor-pointer"
        >
          Connect wallet
        </button>
      </div>
    </header>
  );
}