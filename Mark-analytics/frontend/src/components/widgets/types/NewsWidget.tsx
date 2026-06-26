import { formatDistanceToNow, parseISO } from 'date-fns';
import { useWidgetData } from '@/hooks/useWidgetData';
import type { WidgetRead } from '@/types/widgets';
import { WidgetFrame } from './WidgetFrame';

export interface NewsWidgetProps {
  widget: WidgetRead;
  onEdit?: () => void;
  onDelete?: () => void;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function NewsWidget({ widget, onEdit, onDelete }: NewsWidgetProps): JSX.Element {
  const { data, isLoading, isError, error } = useWidgetData(widget);
  const title = typeof widget.params.title === 'string' ? widget.params.title : widget.name;
  const news = data && data.type === 'news' ? data : null;

  return (
    <WidgetFrame
      title={title}
      loading={isLoading}
      error={isError ? error.message : null}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
    >
      <ul className="flex flex-col gap-2">
        {news?.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-0.5 border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-800/60">
            <a
              href={item.url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-neutral-900 hover:underline dark:text-neutral-100"
            >
              {item.title}
            </a>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 dark:text-neutral-400">
              <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                {item.source}
              </span>
              <span>{relativeTime(item.published_at)}</span>
            </div>
          </li>
        ))}
        {news && news.items.length === 0 && !isLoading && (
          <li className="text-xs text-neutral-500 dark:text-neutral-400">No news yet.</li>
        )}
      </ul>
    </WidgetFrame>
  );
}

export default NewsWidget;
