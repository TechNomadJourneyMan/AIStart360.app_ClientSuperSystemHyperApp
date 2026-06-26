import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useRecentNews, type NewsItem } from '../../hooks/useNews';
import { Widget } from './Widget';

export function NewsFeedWidget(): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useRecentNews(15);

  const items = data?.items ?? [];
  const degraded = Boolean(data?.degraded);
  const showError = isError || degraded;
  const showEmpty = !isLoading && !showError && items.length === 0;

  return (
    <Widget title={t('widget.news.title')} loading={isLoading}>
      {showError ? (
        <EmptyState message={t('widget.news.error', 'Could not load news right now')} />
      ) : showEmpty ? (
        <EmptyState message={t('widget.news.empty', 'No recent news')} />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
          {items.map((item) => (
            <NewsRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Widget>
  );
}

function NewsRow({ item }: { item: NewsItem }): JSX.Element {
  const published = safeDate(item.published_at);
  const relative = published
    ? formatDistanceToNow(published, { addSuffix: true })
    : null;

  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group block focus:outline-none"
      >
        <div
          className="text-[12px] font-medium leading-snug text-neutral-800 group-hover:text-blue-600 dark:text-neutral-100 dark:group-hover:text-blue-400"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={item.title}
        >
          {item.title}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
          <span className="inline-flex items-center rounded-sm bg-neutral-100 px-1.5 py-[1px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            {item.source}
          </span>
          {relative ? <span>{relative}</span> : null}
        </div>
      </a>
    </li>
  );
}

function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-xs text-neutral-500 dark:text-neutral-400">
      {message}
    </div>
  );
}

function safeDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default NewsFeedWidget;
