import { useTranslation } from 'react-i18next';
import { Widget } from './Widget';
import { useGrowthLeaders } from '../../hooks/useAnalytics';
import { useMapStore } from '../../stores/map';

function formatRevenue(v?: number | null): string {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} K`;
  return String(v);
}

export function TopCompaniesWidget(): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, error } = useGrowthLeaders(10);
  const selectCompany = useMapStore((s) => s.selectCompany);

  const items = data?.items ?? [];

  return (
    <Widget
      title={t('widget.top.title')}
      subtitle="Top 10 · revenue"
      loading={isLoading}
      error={error?.message ?? null}
    >
      {items.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
          No data
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-100 text-xs dark:divide-neutral-800">
          {items.map((c, idx) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => selectCompany(c.id)}
                className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-neutral-50 focus:bg-neutral-100 focus:outline-none dark:hover:bg-neutral-800/50 dark:focus:bg-neutral-800"
              >
                <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-neutral-400">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {c.name}
                </span>
                {c.industry ? (
                  <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {c.industry}
                  </span>
                ) : null}
                {c.region ? (
                  <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">
                    {c.region}
                  </span>
                ) : null}
                <span className="w-16 shrink-0 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                  {formatRevenue(c.revenue)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export default TopCompaniesWidget;
