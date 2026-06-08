import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border-transparent bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}
