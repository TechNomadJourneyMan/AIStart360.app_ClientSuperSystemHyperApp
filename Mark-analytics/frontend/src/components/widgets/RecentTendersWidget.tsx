import { useTranslation } from 'react-i18next';
import { Widget } from './Widget';
import { useRecentTenders } from '../../hooks/useAnalytics';

function formatAmount(v?: number | null): string {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} B ₸`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M ₸`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} K ₸`;
  return `${v} ₸`;
}

function formatDate(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

export function RecentTendersWidget(): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useRecentTenders(10);
  const items = data?.items ?? [];

  const showEmpty = !isLoading && (isError || items.length === 0);

  return (
    <Widget title={t('widget.tenders.title')} loading={isLoading}>
      {showEmpty ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">
            {isError ? 'Не удалось загрузить тендеры' : 'Тендеров пока нет в каталоге'}
          </span>
          <span className="text-[10px]">
            {isError ? 'Попробуйте позже' : 'Загляните позже'}
          </span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 text-xs">
          {items.map((tender) => {
            const href = tender.url ?? tender.source_url ?? null;
            const titleNode = href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                title={tender.title}
              >
                {tender.title}
              </a>
            ) : (
              <span
                className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100"
                title={tender.title}
              >
                {tender.title}
              </span>
            );
            return (
              <li
                key={tender.id}
                className="flex flex-col gap-0.5 border-b border-neutral-100 pb-2 last:border-none dark:border-neutral-800"
              >
                <div className="flex items-start justify-between gap-2">
                  {titleNode}
                  <span className="shrink-0 tabular-nums text-neutral-700 dark:text-neutral-200">
                    {formatAmount(tender.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400">
                  <span className="truncate">{tender.customer ?? '—'}</span>
                  <span>{formatDate(tender.deadline)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}

export default RecentTendersWidget;
