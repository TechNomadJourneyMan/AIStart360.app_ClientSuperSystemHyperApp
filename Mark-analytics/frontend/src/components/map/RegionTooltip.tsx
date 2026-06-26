import { useTranslation } from 'react-i18next';
import { useClusterStats } from '../../hooks/useRegions';
import { cn } from '../../lib/cn';

export interface RegionTooltipProps {
  /** KATO code of the hovered region. */
  katoCode: string;
  /** Display name (region.name_ru / name_en / name_kz already resolved upstream). */
  regionName: string;
  /** Cursor position in CSS pixels relative to the map container. */
  x: number;
  y: number;
  className?: string;
}

const TOOLTIP_OFFSET = 14;

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return new Intl.NumberFormat().format(Math.round(n));
}

export function RegionTooltip({
  katoCode,
  regionName,
  x,
  y,
  className,
}: RegionTooltipProps): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, error } = useClusterStats({ katoCode });

  const top3Industries = (data?.by_industry ?? []).slice(0, 3);
  const top5Companies = (data?.top_5 ?? []).slice(0, 5);
  const sizeRows = (data?.by_size ?? []).slice(0, 4);

  return (
    <div
      role="tooltip"
      aria-live="polite"
      style={{ left: x + TOOLTIP_OFFSET, top: y + TOOLTIP_OFFSET }}
      className={cn(
        'pointer-events-none absolute z-30 max-w-xs min-w-[220px] rounded-lg border border-neutral-200 bg-white/95 p-3 text-xs text-neutral-800 shadow-lg backdrop-blur',
        'dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100',
        className,
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold leading-tight">{regionName}</span>
        <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {katoCode}
        </span>
      </div>

      {isLoading && (
        <div className="space-y-1.5" aria-label={t('common.loading') ?? 'Loading'}>
          <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      )}

      {error && (
        <div className="text-rose-600 dark:text-rose-400">
          {t('common.error') ?? 'Error'}
        </div>
      )}

      {data && !isLoading && !error && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-neutral-500 dark:text-neutral-400">
              {t('region.tooltip.companies')}
            </span>
            <span className="font-medium tabular-nums">
              {formatNumber(data.total_companies)}
            </span>
          </div>

          {top3Industries.length > 0 && (
            <div>
              <div className="mb-1 text-neutral-500 dark:text-neutral-400">
                {t('region.tooltip.byIndustry')}
              </div>
              <ul className="space-y-0.5">
                {top3Industries.map((row) => (
                  <li
                    key={row.code}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="truncate">{row.label ?? row.code}</span>
                    <span className="tabular-nums">{formatNumber(row.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sizeRows.length > 0 && (
            <div>
              <div className="mb-1 text-neutral-500 dark:text-neutral-400">
                {t('region.tooltip.bySize')}
              </div>
              <ul className="flex flex-wrap gap-1">
                {sizeRows.map((row) => (
                  <li
                    key={row.bucket}
                    className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800"
                  >
                    <span className="uppercase">{row.bucket}</span>{' '}
                    <span className="tabular-nums">{formatNumber(row.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {top5Companies.length > 0 && (
            <div>
              <div className="mb-1 text-neutral-500 dark:text-neutral-400">
                {t('region.tooltip.topCompanies')}
              </div>
              <ul className="space-y-0.5">
                {top5Companies.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.revenue_usd !== null && c.revenue_usd !== undefined && (
                      <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                        {formatNumber(c.revenue_usd)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RegionTooltip;
