import type { ReactNode } from 'react';

export interface WidgetProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Hide the scroll area's overflow (e.g. for ticker / pie that manages its own clipping). */
  noScroll?: boolean;
}

/**
 * Base widget wrapper used by every dashboard tile.
 *
 * - 36px monochrome header with title + subtitle + actions slot.
 * - Body has padding + scroll-area by default.
 * - `loading`: renders a skeleton.
 * - `error`: red border + inline error region.
 */
export function Widget({
  title,
  subtitle,
  actions,
  loading = false,
  error = null,
  children,
  noScroll = false,
}: WidgetProps): JSX.Element {
  const borderClass = error
    ? 'border-red-400 dark:border-red-700'
    : 'border-neutral-200 dark:border-neutral-800';

  return (
    <article
      className={`flex h-full w-full flex-col overflow-hidden rounded-md border bg-white shadow-sm dark:bg-neutral-900 ${borderClass}`}
      aria-busy={loading || undefined}
    >
      <header
        className="flex items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800"
        style={{ height: 36, minHeight: 36 }}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-200">
            {title}
          </h3>
          {subtitle ? (
            <span className="truncate text-[10px] text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </span>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>

      <div
        className={`relative flex-1 min-h-0 ${noScroll ? 'overflow-hidden' : 'overflow-auto'} p-3`}
      >
        {loading ? (
          <WidgetSkeleton />
        ) : error ? (
          <div role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : (
          children
        )}
      </div>
    </article>
  );
}

function WidgetSkeleton(): JSX.Element {
  return (
    <div className="flex h-full w-full animate-pulse flex-col gap-2" aria-hidden>
      <div className="h-3 w-1/3 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="mt-2 flex-1 rounded bg-neutral-100 dark:bg-neutral-800/60" />
    </div>
  );
}

export default Widget;
