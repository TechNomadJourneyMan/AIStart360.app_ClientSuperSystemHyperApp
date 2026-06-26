import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { HeuristicInsight, InsightSeverity } from '@/hooks/useAnalytics';
import { cn } from '@/lib/cn';

export interface HeuristicInsightsCardProps {
  items: HeuristicInsight[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/**
 * §2 of `07-product-redesign.md`: backend insights are rule-based, so we
 * label this card honestly as "Heuristic insights" rather than "AI insights".
 * Shows up to 3 bullets.
 */
export function HeuristicInsightsCard({
  items,
  loading = false,
  error = null,
  onRetry,
}: HeuristicInsightsCardProps): JSX.Element {
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
          Heuristic insights
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
          rule-based · not AI
        </span>
      </header>

      {loading ? (
        <Skeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <p className="text-xs text-[color:var(--muted-foreground)]">
          No insights surfaced for the current dataset.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.slice(0, 3).map((insight, idx) => (
            <li key={`${insight.title}-${idx}`} className="flex items-start gap-3">
              <SeverityIcon severity={insight.severity} />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-[color:var(--foreground)]">
                  {insight.title}
                </span>
                <span className="text-xs text-[color:var(--muted-foreground)]">
                  {insight.body}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function SeverityIcon({ severity }: { severity: InsightSeverity }): JSX.Element {
  const cls = 'mt-0.5 h-4 w-4 shrink-0';
  switch (severity) {
    case 'critical':
      return <AlertCircle className={cn(cls, 'text-red-600 dark:text-red-400')} aria-hidden />;
    case 'warn':
      return (
        <TriangleAlert className={cn(cls, 'text-amber-600 dark:text-amber-400')} aria-hidden />
      );
    case 'success':
      return (
        <CheckCircle2 className={cn(cls, 'text-emerald-600 dark:text-emerald-400')} aria-hidden />
      );
    case 'info':
    default:
      return <Info className={cn(cls, 'text-sky-600 dark:text-sky-400')} aria-hidden />;
  }
}

function Skeleton(): JSX.Element {
  return (
    <div className="flex animate-pulse flex-col gap-2" aria-hidden>
      <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
    </div>
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

export default HeuristicInsightsCard;
