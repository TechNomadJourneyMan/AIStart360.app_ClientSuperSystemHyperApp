import type { ReactNode } from 'react';
import { Sparkline } from '@/components/widgets/Sparkline';
import { FreshnessChip } from './FreshnessChip';
import { cn } from '@/lib/cn';

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Optional small line below the value (e.g. "+3.2% MoM"). */
  delta?: string;
  /** Optional sparkline series (12 latest values). */
  sparkline?: number[];
  /** ISO timestamp of latest data point feeding this KPI. */
  updatedAt?: string | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function KpiCard({
  label,
  value,
  delta,
  sparkline,
  updatedAt,
  loading = false,
  error = null,
  className,
}: KpiCardProps): JSX.Element {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-[color:var(--border)]',
        'bg-[color:var(--card)] p-5 shadow-sm',
        error && 'border-red-300 dark:border-red-800',
        className,
      )}
      aria-busy={loading || undefined}
    >
      <header className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          {label}
        </span>
        <FreshnessChip updatedAt={updatedAt} />
      </header>

      {loading ? (
        <KpiSkeleton />
      ) : error ? (
        <div role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-[color:var(--foreground)]">
              {value}
            </span>
            {delta ? (
              <span className="text-xs tabular-nums text-[color:var(--muted-foreground)]">
                {delta}
              </span>
            ) : null}
          </div>
          <div className="text-[color:var(--muted-foreground)]">
            <Sparkline
              values={sparkline ?? []}
              width={180}
              height={36}
              strokeWidth={1.5}
              ariaLabel={`${label} trend`}
            />
          </div>
        </>
      )}
    </article>
  );
}

function KpiSkeleton(): JSX.Element {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-hidden>
      <div className="h-8 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-9 w-44 rounded bg-neutral-100 dark:bg-neutral-800/60" />
    </div>
  );
}

export default KpiCard;
