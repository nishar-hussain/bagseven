'use client';

import { cn } from '../../lib/utils';
import type { Section } from '../../app/page';
import { Bell, Server, ShieldCheck } from 'lucide-react';

const sectionTitles: Record<Section, string> = {
  overview: 'Overview',
  identity: 'Identity',
  treasury: 'Treasury',
  settle: 'Reserve & Settle',
  marketplace: 'Marketplace',
  activity: 'Activity',
  settings: 'Settings',
};

interface HeaderProps {
  activeSection: Section;
  gateway: string;
  agentStatus?: string;
}

export function Header({ activeSection, gateway, agentStatus }: HeaderProps) {
  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-semibold text-foreground">{sectionTitles[activeSection]}</h1>
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
          <Server className="w-4 h-4" />
          <span className="font-mono">{gateway}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {agentStatus && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-sm">
            <ShieldCheck className={cn('w-4 h-4', agentStatus === 'active' ? 'text-success' : 'text-warning')} />
            <span className="text-foreground">{agentStatus}</span>
          </div>
        )}
        <button className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent rounded-full animate-pulse" />
        </button>
        <div className="w-9 h-9 rounded-lg overflow-hidden bg-secondary">
          <div className="w-full h-full bg-gradient-to-br from-accent/80 to-chart-1 flex items-center justify-center text-xs font-semibold text-accent-foreground">
            BS
          </div>
        </div>
      </div>
    </header>
  );
}