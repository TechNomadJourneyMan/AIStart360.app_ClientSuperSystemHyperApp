import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Pulse-animated skeleton placeholder. Use during async loads. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[color:var(--muted)]',
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}
