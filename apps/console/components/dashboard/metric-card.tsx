'use client';

import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  icon: LucideIcon;
  delay?: number;
}

export function MetricCard({ title, value, hint, tone = 'default', icon: Icon, delay = 0 }: MetricCardProps) {
  return (
    <div
      className="group relative bg-card border border-border rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-neutral-300 transition-all duration-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${delay * 80}ms`, animationFillMode: 'both' }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-950/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <span className="text-sm text-muted-foreground font-medium">{title}</span>
          <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-neutral-100 transition-colors duration-200">
            <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors duration-200" />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <span
            className={cn(
              'text-2xl lg:text-3xl font-bold tracking-tight',
              tone === 'success' && 'text-success',
              tone === 'warning' && 'text-warning',
              tone === 'destructive' && 'text-destructive',
              tone === 'default' && 'text-foreground',
            )}
          >
            {value}
          </span>
          {hint && <span className="flex items-center gap-1 text-sm font-medium mb-1 text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </div>
  );
}
