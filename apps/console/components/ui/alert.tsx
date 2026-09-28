import * as React from 'react';
import { cn } from '../../lib/utils';

function Alert({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & { variant?: 'default' | 'destructive' | 'warning' | 'success' }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        'relative w-full rounded-lg border px-4 py-3 text-sm',
        variant === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive',
        variant === 'warning' && 'border-warning/40 bg-warning/10 text-warning',
        variant === 'success' && 'border-success/40 bg-success/10 text-success',
        variant === 'default' && 'border-border bg-card text-foreground',
        className,
      )}
      {...props}
    />
  );
}
function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />;
}
function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm opacity-90 [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };