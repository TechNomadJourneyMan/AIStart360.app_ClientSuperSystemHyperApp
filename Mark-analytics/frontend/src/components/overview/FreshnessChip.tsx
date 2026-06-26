import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FreshnessChipProps {
  /** ISO timestamp of the most recent data point, or `null` if unknown. */
  updatedAt?: string | null;
  /** Override the relative-time label (e.g. for testing). */
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Compact pill showing data freshness. Renders "updated 2h ago" style.
 * Goes amber after 30 days, red after 90 days (per §8 of 07-product-redesign).
 */
export function FreshnessChip({
  updatedAt,
  label,
  className,
  size = 'sm',
}: FreshnessChipProps): JSX.Element {
  const computed = label ?? formatRelative(updatedAt);
  const tone = toneFor(updatedAt);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium tabular-nums',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        tone,
        className,
      )}
      title={updatedAt ? `Updated ${updatedAt}` : 'Freshness unknown'}
    >
      <Clock className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      {computed}
    </span>
  );
}

function toneFor(updatedAt?: string | null): string {
  if (!updatedAt) return 'border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400';
  const ageDays = ageInDays(updatedAt);
  if (ageDays == null) return 'border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400';
  if (ageDays > 90) return 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300';
  if (ageDays > 30) return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
}

function ageInDays(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function formatRelative(iso?: string | null): string {
  if (!iso) return 'freshness unknown';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'freshness unknown';
  const deltaSec = Math.max(0, (Date.now() - t) / 1000);
  if (deltaSec < 60) return 'updated just now';
  if (deltaSec < 3600) return `updated ${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `updated ${Math.round(deltaSec / 3600)}h ago`;
  const days = Math.round(deltaSec / 86400);
  if (days < 14) return `updated ${days}d ago`;
  if (days < 60) return `updated ${Math.round(days / 7)}w ago`;
  return `updated ${Math.round(days / 30)}mo ago`;
}

export default FreshnessChip;
