import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClusterStats } from '../../hooks/useRegions';
import { useMapStore } from '../../stores/map';
import { cn } from '../../lib/cn';
import { formatCurrency, formatNumber } from '../../lib/format';
import {
  getRegionStats,
  STATS_SOURCE,
  STATS_YEAR,
  type KzRegionStat,
} from '../../data/kzRegionStats';

export interface RegionMarketPopupProps {
  /** 2-digit `kato2` of the clicked region — the cluster-stats lookup key. */
  katoCode: string;
  /** Region display name resolved upstream (name_ru / name_en / name_kz). */
  regionName: string;
  /** Click position in CSS pixels relative to the map container. */
  x: number;
  y: number;
  /** Map container width/height in CSS pixels — used to flip the anchor near edges. */
  containerWidth: number;
  containerHeight: number;
  /** Dismiss the popup (✕ / Escape / map background click). */
  onClose: () => void;
  /** Open the full RegionDrawer deep-dive ("Подробнее"). */
  onOpenDetails: () => void;
  className?: string;
}

const POPUP_WIDTH = 320;
const POPUP_MAX_HEIGHT = 460;
const ANCHOR_OFFSET = 14;

/**
 * Compute an anchored position that keeps the card inside the map bounds.
 * Prefers down-right of the click, flipping when too close to an edge.
 */
function computePlacement(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
): { left: number; top: number } {
  let left = x + ANCHOR_OFFSET;
  if (containerWidth > 0 && left + POPUP_WIDTH > containerWidth) {
    left = Math.max(8, x - ANCHOR_OFFSET - POPUP_WIDTH);
  }
  let top = y + ANCHOR_OFFSET;
  if (containerHeight > 0 && top + POPUP_MAX_HEIGHT > containerHeight) {
    top = Math.max(8, containerHeight - POPUP_MAX_HEIGHT - 8);
  }
  return { left: Math.max(8, left), top: Math.max(8, top) };
}

/** Format млрд тенге → "13,9 трлн ₸" / "850 млрд ₸". */
function formatGrp(blnKzt: number, locale: string): string {
  if (blnKzt >= 1000) {
    const trln = blnKzt / 1000;
    return `${formatNumber(Math.round(trln * 10) / 10, locale)} трлн ₸`;
  }
  return `${formatNumber(Math.round(blnKzt), locale)} млрд ₸`;
}

/** Format тенге per-capita → "11,0 млн ₸" / "842 тыс ₸". */
function formatPerCapita(kzt: number, locale: string): string {
  if (kzt >= 1_000_000) {
    return `${formatNumber(Math.round((kzt / 1_000_000) * 10) / 10, locale)} млн ₸`;
  }
  if (kzt >= 1000) {
    return `${formatNumber(Math.round(kzt / 1000), locale)} тыс ₸`;
  }
  return `${formatNumber(kzt, locale)} ₸`;
}

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded bg-neutral-100 px-2 py-1.5 dark:bg-neutral-800">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function RegionMarketPopup({
  katoCode,
  regionName,
  x,
  y,
  containerWidth,
  containerHeight,
  onClose,
  onOpenDetails,
  className,
}: RegionMarketPopupProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const selectCompany = useMapStore((s) => s.selectCompany);
  const { data, isLoading, error, refetch } = useClusterStats({ katoCode });

  const stats: KzRegionStat | undefined = useMemo(
    () => getRegionStats(katoCode),
    [katoCode],
  );

  // Dismiss on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { left, top } = useMemo(
    () => computePlacement(x, y, containerWidth, containerHeight),
    [x, y, containerWidth, containerHeight],
  );

  const topIndustries = useMemo(
    () => (data?.by_industry ?? []).slice(0, 3),
    [data?.by_industry],
  );
  const topCompanies = useMemo(
    () => (data?.top_5 ?? []).slice(0, 3),
    [data?.top_5],
  );

  // Live company-catalog numbers (honest — may be 0 for sparse regions).
  const catalogCompanies = data?.total_companies ?? 0;
  const catalogRevenue = data?.total_revenue ?? null;
  const noCompanies = !isLoading && !error && catalogCompanies === 0;

  // Display name: prefer reference name (consistent официальное наименование),
  // fall back to the geojson-resolved name passed from the map.
  const displayName = stats?.name_ru ?? regionName;

  return (
    <div
      role="dialog"
      aria-label={t('region.popup.title') ?? 'Локальный рынок'}
      style={{
        left,
        top,
        width: POPUP_WIDTH,
        maxHeight: POPUP_MAX_HEIGHT,
      }}
      // pointer-events-auto so the card is interactive, while the wrapper in
      // MapShell stays pointer-events-none and never blocks map gestures.
      className={cn(
        'pointer-events-auto absolute z-30 flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white/95 text-xs text-neutral-800 shadow-xl backdrop-blur',
        'dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex items-start justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t('region.popup.title')}
          </div>
          <h2 className="truncate text-sm font-semibold leading-tight">{displayName}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
            Стат. {STATS_YEAR}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close') ?? 'Закрыть'}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            {'×'}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        <div className="space-y-3">
          {/* Reference macro stats (official statistics). */}
          {stats ? (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Экономика региона
              </h3>
              <dl className="grid grid-cols-2 gap-2">
                <StatTile
                  label="Население"
                  value={`${formatNumber(stats.population, lang)} чел.`}
                />
                <StatTile label="ВРП" value={formatGrp(stats.grp_bln_kzt, lang)} />
                <StatTile
                  label="ВРП на душу"
                  value={formatPerCapita(stats.grp_per_capita_kzt, lang)}
                />
                <StatTile
                  label="Доля в ВРП страны"
                  value={`${formatNumber(stats.share_of_national_grp_pct, lang)}%`}
                />
                {typeof stats.avg_salary_kzt === 'number' ? (
                  <StatTile
                    label="Ср. зарплата"
                    value={`${formatNumber(stats.avg_salary_kzt, lang)} ₸`}
                  />
                ) : null}
                {typeof stats.unemployment_pct === 'number' ? (
                  <StatTile
                    label="Безработица"
                    value={`${formatNumber(stats.unemployment_pct, lang)}%`}
                  />
                ) : null}
              </dl>
            </section>
          ) : (
            <p className="rounded bg-neutral-100 px-2 py-1.5 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              Справочная статистика по региону недоступна.
            </p>
          )}

          {/* Live company-catalog data. */}
          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Каталог компаний
            </h3>

            {isLoading && (
              <div className="space-y-2" aria-label={t('common.loading') ?? 'Загрузка'}>
                <div className="h-8 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
              </div>
            )}

            {error && !isLoading && (
              <div className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
                <p className="mb-1.5">{t('common.error') ?? 'Ошибка'}</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
                >
                  {t('common.retry') ?? 'Повторить'}
                </button>
              </div>
            )}

            {!isLoading && !error && (
              <dl className="grid grid-cols-2 gap-2">
                <StatTile
                  label="Компаний в каталоге"
                  value={formatNumber(catalogCompanies, lang)}
                />
                <StatTile
                  label="Выручка каталога"
                  value={
                    catalogRevenue !== null ? formatCurrency(catalogRevenue, lang) : '—'
                  }
                />
              </dl>
            )}

            {noCompanies && (
              <p className="mt-2 text-neutral-500 dark:text-neutral-400">
                Компании этого региона ещё не загружены в каталог.
              </p>
            )}
          </section>

          {topIndustries.length > 0 && (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {t('region.popup.topIndustries')}
              </h3>
              <ul className="space-y-0.5">
                {topIndustries.map((row) => (
                  <li key={row.code} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{row.label ?? row.code}</span>
                    <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                      {formatNumber(row.count, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {topCompanies.length > 0 && (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {t('region.popup.topCompanies')}
              </h3>
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {topCompanies.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectCompany(c.id)}
                      className="flex w-full items-baseline justify-between gap-2 py-1 text-left hover:text-indigo-600 focus:outline-none focus-visible:text-indigo-600 dark:hover:text-indigo-400 dark:focus-visible:text-indigo-400"
                    >
                      <span className="truncate">{c.name}</span>
                      {c.revenue_usd !== null && c.revenue_usd !== undefined && (
                        <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                          {formatCurrency(c.revenue_usd, lang)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <footer className="space-y-1.5 border-t border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <button
          type="button"
          onClick={onOpenDetails}
          className="w-full rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/70"
        >
          {t('region.popup.details')} {'→'}
        </button>
        <p className="text-[9px] leading-snug text-neutral-400 dark:text-neutral-500">
          Население/ВРП: {STATS_SOURCE}, {STATS_YEAR} · Компании: каталог Mark-analytics
        </p>
      </footer>
    </div>
  );
}

export default RegionMarketPopup;
