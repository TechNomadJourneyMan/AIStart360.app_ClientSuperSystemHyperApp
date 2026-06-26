import { useMemo } from 'react';
import type { CountryDistributionBucket } from '@/hooks/useAnalytics';

export interface CountryBarChartProps {
  buckets: CountryDistributionBucket[];
  /** Fallback when backend returns no country data. */
  fallback?: CountryDistributionBucket[];
  height?: number;
}

const NEIGHBOURS = ['KZ', 'UZ', 'KG', 'TJ', 'TM'] as const;

/**
 * Horizontal bar chart, KZ vs CIS neighbours.
 * Always shows the 5 reference countries, missing values render as 0.
 */
export function CountryBarChart({
  buckets,
  fallback,
  height = 240,
}: CountryBarChartProps): JSX.Element {
  const indexed = useMemo(() => {
    const source = buckets.length > 0 ? buckets : (fallback ?? []);
    const map = new Map<string, CountryDistributionBucket>();
    for (const b of source) map.set(b.country.toUpperCase(), b);
    return NEIGHBOURS.map((code) => ({
      code,
      bucket: map.get(code) ?? {
        country: code,
        companies: 0,
        active: 0,
        revenue_usd: null,
      },
    }));
  }, [buckets, fallback]);

  const max = useMemo(
    () => Math.max(1, ...indexed.map((row) => row.bucket.companies)),
    [indexed],
  );

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5"
      style={{ minHeight: height }}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
          Companies by country
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
          KZ vs CIS neighbours
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {indexed.map(({ code, bucket }) => {
          const pct = (bucket.companies / max) * 100;
          const isKz = code === 'KZ';
          return (
            <li key={code} className="flex items-center gap-3">
              <span
                className={
                  'w-10 shrink-0 text-xs font-semibold tabular-nums ' +
                  (isKz
                    ? 'text-[color:var(--primary)]'
                    : 'text-[color:var(--muted-foreground)]')
                }
              >
                {code}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-[color:var(--muted)]">
                <div
                  className={
                    'h-full rounded transition-all duration-500 ' +
                    (isKz ? 'bg-[color:var(--primary)]' : 'bg-neutral-400 dark:bg-neutral-600')
                  }
                  style={{ width: `${pct.toFixed(1)}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-[color:var(--foreground)]">
                {bucket.companies.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default CountryBarChart;
