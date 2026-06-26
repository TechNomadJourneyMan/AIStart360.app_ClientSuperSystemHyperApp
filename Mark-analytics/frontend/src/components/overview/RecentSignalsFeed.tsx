import { Briefcase, FileText, Sparkles, UserCog } from 'lucide-react';
import type { SignalItem, SignalKind } from '@/hooks/useAnalytics';
import { cn } from '@/lib/cn';

export interface RecentSignalsFeedProps {
  items: SignalItem[];
  /** When true, the feed is synthesised from another endpoint — show preview badge. */
  preview?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function RecentSignalsFeed({
  items,
  preview = false,
  loading = false,
  error = null,
  onRetry,
}: RecentSignalsFeedProps): JSX.Element {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-[color:var(--border)]',
        'bg-[color:var(--card)] p-5',
        error && 'border-red-300 dark:border-red-800',
      )}
      aria-busy={loading || undefined}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
          Recent signals
        </h3>
        {preview ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            preview
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
            last {items.length}
          </span>
        )}
      </header>

      {loading ? (
        <Skeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <p className="text-xs text-[color:var(--muted-foreground)]">
          No signals yet. Real-time feed activates once the ingest pipeline lands.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <KindIcon kind={s.kind} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-[color:var(--foreground)]">
                  {s.title}
                </span>
                <span className="truncate text-xs text-[color:var(--muted-foreground)]">
                  {s.company_name ?? '—'}
                  {s.occurred_at ? ` · ${formatDate(s.occurred_at)}` : ''}
                </span>
              </div>
              {s.amount != null ? (
                <span className="shrink-0 text-xs tabular-nums text-[color:var(--muted-foreground)]">
                  {formatAmount(s.amount)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function KindIcon({ kind }: { kind: SignalKind }): JSX.Element {
  const cls = 'mt-0.5 h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]';
  switch (kind) {
    case 'registration':
      return <FileText className={cls} aria-hidden />;
    case 'tender_win':
      return <Briefcase className={cls} aria-hidden />;
    case 'executive_change':
      return <UserCog className={cls} aria-hidden />;
    default:
      return <Sparkles className={cls} aria-hidden />;
  }
}

function formatAmount(value: number): string {
  if (value >= 1_000_000_000) return `₸ ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `₸ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₸ ${(value / 1_000).toFixed(1)}K`;
  return `₸ ${value.toFixed(0)}`;
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}

function Skeleton(): JSX.Element {
  return (
    <ul className="flex animate-pulse flex-col gap-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="h-8 rounded bg-neutral-100 dark:bg-neutral-800/60" />
      ))}
    </ul>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
    >
      <span>{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export default RecentSignalsFeed;
