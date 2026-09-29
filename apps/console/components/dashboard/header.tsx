'use client';

import { cn } from '../../lib/utils';
import type { Section } from '../../app/page';

interface HeaderProps {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  gateway?: string;
  agentStatus?: string;
}

const nav: { id: Section; label: string }[] = [
  { id: 'mandate', label: 'Mandate' },
  { id: 'agents', label: 'Agents' },
  { id: 'refusals', label: 'Refusals' },
  { id: 'resolve', label: 'Resolve' },
  { id: 'marketplace', label: 'Tool Market' },
];

export function Header({ activeSection, onSectionChange }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-neutral-200/80 sticky top-0 z-40 flex items-center justify-between px-6 sm:px-8">
      {/* Left: Brand + Nav */}
      <div className="flex items-center gap-6 sm:gap-7">
        {/* Brand */}
        <div className="flex items-center gap-2.5 cursor-pointer select-none">
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

        {/* Console Pill + Nav */}
        <div className="flex items-center gap-4 text-sm">
          <span className="font-semibold text-neutral-900 px-2.5 py-1 rounded-md bg-neutral-100/80 text-[13px]">
            Console
          </span>

          <nav className="flex items-center gap-5 sm:gap-6 text-[13px]">
            {nav.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSectionChange(item.id)}
                  className={cn(
                    'transition-all cursor-pointer text-[13px]',
                    isActive
                      ? 'text-neutral-900 font-medium border border-neutral-300/90 rounded-full px-3 py-0.5 shadow-2xs bg-white'
                      : 'text-neutral-500 hover:text-neutral-900 px-1 py-0.5 font-normal',
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Right: Network */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100/90 border border-neutral-200/80 text-xs font-medium text-neutral-700">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
          <span>Ethereum Sepolia</span>
        </div>
      </div>
    </header>
  );
}