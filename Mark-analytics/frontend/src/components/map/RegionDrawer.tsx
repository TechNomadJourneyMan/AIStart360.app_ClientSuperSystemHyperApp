import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from 'recharts';

import { useMapStore } from '../../stores/map';
import {
  useClusterStats,
  useRegionRisk,
  useRegionsGeo,
  type RegionRiskSubscoreKey,
} from '../../hooks/useRegions';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/format';

const RISK_SUBSCORE_ORDER: RegionRiskSubscoreKey[] = [
  'liquidations_3m',
  'court_cases_6m',
  'sanctions_hits',
  'complaints_count',
];

export interface RegionDrawerProps {
  className?: string;
  onOpenIndustryHeatmap?: (katoCode: string) => void;
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return new Intl.NumberFormat().format(Math.round(n));
}

function resolveRegionName(
  geo: ReturnType<typeof useRegionsGeo>['data'],
  kato: string | null,
  lang: string,
): string {
  if (!geo || !kato) return kato ?? '';
  const f = geo.features.find(
    (feat) => (feat.properties?.kato2 ?? feat.properties?.kato_code) === kato,
  );
  if (!f) return kato;
  const p = f.properties;
  if (lang.startsWith('kz') || lang.startsWith('kk')) return p.name_kz ?? p.name_ru ?? p.name_en ?? kato;
  if (lang.startsWith('en')) return p.name_en ?? p.name_ru ?? kato;
  return p.name_ru ?? p.name_en ?? kato;
}

export function RegionDrawer({
  className,
  onOpenIndustryHeatmap,
}: RegionDrawerProps): JSX.Element | null {
  const { t, i18n } = useTranslation();
  const selectedKato = useMapStore((s) => s.selectedRegionKato);
  const metric = useMapStore((s) => s.metric);
  const regionDrawerOpen = useMapStore((s) => s.regionDrawerOpen);
  const setRegionDrawerOpen = useMapStore((s) => s.setRegionDrawerOpen);

  const { data: geo } = useRegionsGeo();
  const { data, isLoading, error, refetch } = useClusterStats({
    katoCode: selectedKato,
  });
  const { data: riskRows } = useRegionRisk({ enabled: metric === 'risk' });
  const riskRow = useMemo(
    () =>
      metric === 'risk' && selectedKato && riskRows
        ? riskRows.find((r) => r.kato_code === selectedKato) ?? null
        : null,
    [metric, selectedKato, riskRows],
  );

  const regionName = useMemo(
    () => resolveRegionName(geo, selectedKato, i18n.language),
    [geo, selectedKato, i18n.language],
  );

  const top10 = useMemo(() => {
    if (!data?.by_industry) return [];
    return [...data.by_industry]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((row) => ({
        name: row.label ?? row.code,
        count: row.count,
      }));
  }, [data?.by_industry]);

  // The drawer is the deep-dive: only shown once the user explicitly opens it
  // from the compact RegionMarketPopup ("Подробнее"). A region click alone
  // selects the region but leaves the drawer closed.
  if (!selectedKato || !regionDrawerOpen) return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={t('region.drawer.title') ?? 'Region details'}
      className={cn(
        'absolute z-20 flex flex-col overflow-hidden border bg-white/95 text-neutral-900 shadow-2xl backdrop-blur',
        'dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100',
        // Desktop: left drawer.
        'md:left-0 md:top-0 md:bottom-0 md:w-[380px] md:border-r md:border-neutral-200',
        // Mobile: bottom sheet.
        'left-0 right-0 bottom-0 max-h-[70vh] border-t md:max-h-none md:rounded-none rounded-t-xl',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t('region.drawer.title')}
          </div>
          <h2 className="text-base font-semibold leading-tight">{regionName}</h2>
          <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            KATO {selectedKato}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRegionDrawerOpen(false)}
          aria-label={t('common.close') ?? 'Close'}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          {'×'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {isLoading && (
          <div className="space-y-2" aria-label={t('common.loading') ?? 'Loading'}>
            <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-32 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        )}

        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
            <p className="mb-2">{t('common.error') ?? 'Error'}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700"
            >
              {t('common.retry') ?? 'Retry'}
            </button>
          </div>
        )}

        {riskRow && (
          <section
            aria-label={t('region.risk.title') ?? 'Risk breakdown'}
            className="mb-4 rounded border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/30"
          >
            <header className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                {t('region.risk.title')}
              </h3>
              <span className="tabular-nums text-base font-semibold text-rose-700 dark:text-rose-200">
                {riskRow.score.toFixed(1)}
                <span className="ml-1 text-[10px] font-normal text-rose-500 dark:text-rose-400">
                  /100
                </span>
              </span>
            </header>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-rose-200/70 dark:divide-rose-900/50">
                {RISK_SUBSCORE_ORDER.map((key) => {
                  const v = riskRow.subscores[key];
                  const degraded = v === null;
                  return (
                    <tr key={key}>
                      <td className="py-1 pr-2 text-rose-900 dark:text-rose-100">
                        {t(`region.risk.subscore.${key}`)}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {degraded ? (
                          <span
                            className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200"
                            title={t('region.risk.degraded') ?? 'Not yet wired'}
                          >
                            {t('region.risk.degraded')}
                          </span>
                        ) : (
                          formatNumber(v)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {data && !isLoading && !error && (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded bg-neutral-100 px-2 py-2 dark:bg-neutral-800">
                <dt className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t('region.tooltip.companies')}
                </dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums">
                  {formatNumber(data.total_companies)}
                </dd>
              </div>
              <div className="rounded bg-neutral-100 px-2 py-2 dark:bg-neutral-800">
                <dt className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t('region.metric.revenue')}
                </dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums">
                  {formatCurrency(data.total_revenue ?? 0, i18n.language)}
                </dd>
              </div>
              <div className="rounded bg-neutral-100 px-2 py-2 dark:bg-neutral-800">
                <dt className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t('region.metric.employees')}
                </dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums">
                  {formatNumber(data.total_employees)}
                </dd>
              </div>
            </dl>

            {top10.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t('region.drawer.topIndustries')}
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={top10}
                      layout="vertical"
                      margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fontSize: 11 }}
                      />
                      <RTooltip
                        cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
                        formatter={(v: number) => formatNumber(v)}
                      />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {data.by_size.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t('region.tooltip.bySize')}
                </h3>
                <ul className="grid grid-cols-2 gap-1.5">
                  {data.by_size.map((row) => (
                    <li
                      key={row.bucket}
                      className="flex items-baseline justify-between rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800"
                    >
                      <span className="uppercase">{row.bucket}</span>
                      <span className="tabular-nums font-medium">
                        {formatNumber(row.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.top_5.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t('region.tooltip.topCompanies')}
                </h3>
                <ul className="divide-y divide-neutral-200 text-xs dark:divide-neutral-800">
                  {data.top_5.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-baseline justify-between gap-2 py-1.5"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                        {formatCurrency(c.revenue_usd ?? 0, i18n.language)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <button
              type="button"
              onClick={() => onOpenIndustryHeatmap?.(selectedKato)}
              disabled={!onOpenIndustryHeatmap}
              className="w-full rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/70"
            >
              {t('region.drawer.openHeatmap')}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default RegionDrawer;
