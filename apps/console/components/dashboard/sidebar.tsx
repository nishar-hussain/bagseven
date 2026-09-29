'use client';

import { cn } from '../../lib/utils';
import { LayoutDashboard, ShieldCheck, FileCheck2, Bot, Wallet, XCircle, Search, Send, Store, Activity, Settings, ChevronLeft, ChevronRight } from 'lucide-react';

function PaperBagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="16 14 66 74"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 1. Rolled top cylinder */}
      {/* Top horizontal curve of the roll */}
      <path d="M 28 20 C 38 18 54 18 64 20" />
      {/* Left rounded end-cap of the roll */}
      <path d="M 28 20 C 24 23 24 30 31 33" />
      {/* Front flap bottom edge */}
      <path d="M 31 33 L 60 36.5" />
      {/* Front flap right vertical cut */}
      <path d="M 60 36.5 L 59 25" />
      {/* Outer curve of roll on right side */}
      <path d="M 64 20 C 69 21 71.5 24 71.5 29 C 71.5 33 69 35 65 36" />
      {/* Roll inner opening / spiral detail */}
      <path d="M 59 25 C 61 22.5 66 22 67.5 25.5 C 68.5 28.5 66.5 31.5 62 31.5" />
      <path d="M 60 28.5 L 63.5 28.5 L 63.5 25" />

      {/* 2. Bag front body */}
      {/* Left silhouette */}
      <path d="M 31 33 C 29.5 45 26.5 61 23.5 74.5" />
      {/* Bottom curved/creased edge */}
      <path d="M 23.5 74.5 C 34 73 48 78 62.5 83" />
      {/* Front right seam line */}
      <path d="M 60 36.5 C 61 48 61.8 66 62.5 83" />

      {/* 3. Right side gusset */}
      {/* Outer right silhouette line */}
      <path d="M 71 28.5 C 72.5 42 75 61 77 75" />
      {/* Bottom seam of side panel */}
      <path d="M 77 75 L 62.5 83" />
      {/* Middle crease down side panel */}
      <path d="M 69.5 35 L 69 70.5" />
      {/* Bottom triangle folds */}
      <path d="M 69 70.5 L 62.5 83" />
      <path d="M 69 70.5 L 77 75" />
    </svg>
  );
}
import type { Section } from '../../app/page';

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
  collapsed: boolean;
  onCollapsedChange: (c: boolean) => void;
}

const navItems: { id: Section; label: string; icon: React.ElementType; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'identity', label: 'Identity', icon: ShieldCheck },
  { id: 'mandate', label: 'Mandate', icon: FileCheck2 },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'vault', label: 'Vault', icon: Wallet },
  { id: 'refusals', label: 'Refusals', icon: XCircle },
  { id: 'resolve', label: 'Resolve', icon: Search },
  { id: 'settle', label: 'Reserve & Settle', icon: Send },
  { id: 'marketplace', label: 'Tool Market', icon: Store },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ activeSection, onSectionChange, collapsed, onCollapsedChange }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-out flex flex-col',
        collapsed ? 'w-[72px]' : 'w-[260px]',
      )}
    >
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-white">
            <PaperBagIcon className="w-6 h-6 text-accent-foreground" />

          </div>
          <span className={cn('font-semibold text-lg text-sidebar-foreground whitespace-nowrap transition-all duration-300', collapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto')}>
            bagseven
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative',
                isActive ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50',
              )}
            >
              <span className={cn('absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-accent transition-all duration-300', isActive ? 'opacity-100' : 'opacity-0')} />
              <Icon className={cn('w-5 h-5 shrink-0 transition-transform duration-200', isActive ? 'text-accent' : 'group-hover:scale-110')} />
              <span className={cn('whitespace-nowrap transition-all duration-300', collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100')}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : (<><ChevronLeft className="w-5 h-5" /><span>Collapse</span></>)}
        </button>
      </div>
    </aside>
  );
}