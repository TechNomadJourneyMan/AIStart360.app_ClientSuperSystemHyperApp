import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidgetData } from '@/hooks/useWidgetData';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/format';
import type { WidgetRead } from '@/types/widgets';
import { WidgetFrame } from './WidgetFrame';

export interface ListWidgetProps {
  widget: WidgetRead;
  onEdit?: () => void;
  onDelete?: () => void;
}

function formatCell(
  raw: string | number | null | undefined,
  format: 'currency' | 'integer' | 'percent' | 'date' | undefined,
  locale: string,
): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  switch (format) {
    case 'currency':
      return formatCurrency(Number(raw), locale);
    case 'integer':
      return formatNumber(raw, locale);
    case 'percent':
      return formatPercent(raw, 1);
    case 'date':
      return formatDate(String(raw));
    default:
      return String(raw);
  }
}

export function ListWidget({ widget, onEdit, onDelete }: ListWidgetProps): JSX.Element {
  const { i18n } = useTranslation();
  const { data, isLoading, isError, error } = useWidgetData(widget);
  const title = typeof widget.params.title === 'string' ? widget.params.title : widget.name;

  // ResizeObserver to truncate columns at small widths.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setNarrow(w < 280);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const list = data && data.type === 'list' ? data : null;
  const visibleCols = list
    ? narrow
      ? list.columns.slice(0, 2)
      : list.columns
    : [];

  return (
    <WidgetFrame
      title={title}
      loading={isLoading}
      error={isError ? error.message : null}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
    >
      <div ref={rootRef} className="h-full w-full">
        {list && list.rows.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white dark:bg-neutral-900">
              <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                {visibleCols.map((c) => (
                  <th key={c.key} className="py-1 pr-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row, idx) => (
                <tr
                  key={`row_${idx}`}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60"
                >
                  {visibleCols.map((c) => (
                    <td key={c.key} className="truncate py-1 pr-2 text-neutral-800 dark:text-neutral-200">
                      {formatCell(row[c.key], c.format, i18n.language)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : !isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
            No rows
          </div>
        ) : null}
      </div>
    </WidgetFrame>
  );
}

export default ListWidget;
