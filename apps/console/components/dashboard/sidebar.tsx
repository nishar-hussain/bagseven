'use client';

import { cn } from '../../lib/utils';
import { LayoutDashboard, ShieldCheck, Wallet, FileCheck2, Coins, Send, Store, Activity, Settings, ChevronLeft, ChevronRight, CircleDollarSign } from 'lucide-react';
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
  { id: 'wallet', label: 'Wallet & Funds', icon: Wallet },
  { id: 'policy', label: 'Policy', icon: FileCheck2 },
  { id: 'spend', label: 'Spend Intents', icon: Coins },
  { id: 'settle', label: 'Reserve & Settle', icon: Send },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
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
            <CircleDollarSign className="w-5 h-5 text-accent-foreground" />
          </div>
          <span className={cn('font-semibold text-lg text-sidebar-foreground whitespace-nowrap transition-all duration-300', collapsed ? 'opacity-0 w-0' : 'opacity-100 w-auto')}>
            AgentOS
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