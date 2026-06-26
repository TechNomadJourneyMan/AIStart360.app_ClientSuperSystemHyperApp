import { useTranslation } from 'react-i18next';
import { useWidgetData } from '@/hooks/useWidgetData';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import type { WidgetRead } from '@/types/widgets';
import { WidgetFrame } from './WidgetFrame';

export interface MetricWidgetProps {
  widget: WidgetRead;
  onEdit?: () => void;
  onDelete?: () => void;
}

function renderValue(
  value: number | null,
  format: 'currency' | 'integer' | 'percent' | undefined,
  locale: string,
): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'currency':
      return formatCurrency(value, locale);
    case 'percent':
      return formatPercent(value, 1);
    case 'integer':
    default:
      return formatNumber(value, locale);
  }
}

export function MetricWidget({ widget, onEdit, onDelete }: MetricWidgetProps): JSX.Element {
  const { i18n } = useTranslation();
  const { data, isLoading, isError, error } = useWidgetData(widget);

  const title =
    typeof widget.params.title === 'string' ? widget.params.title : widget.name;

  const metric = data && data.type === 'metric' ? data : null;
  const deltaSign = metric?.delta && metric.delta > 0 ? '+' : '';
  const deltaColor =
    metric?.delta && metric.delta > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : metric?.delta && metric.delta < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-neutral-500 dark:text-neutral-400';

  return (
    <WidgetFrame
      title={title}
      loading={isLoading}
      error={isError ? error.message : null}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
    >
      <div className="flex h-full w-full flex-col items-start justify-center">
        <div className="text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {renderValue(metric?.value ?? null, metric?.format, i18n.language)}
        </div>
        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {metric?.label ?? title}
        </div>
        {metric?.delta != null && (
          <div className={`mt-2 text-xs font-medium ${deltaColor}`}>
            {deltaSign}
            {metric.delta.toFixed(1)}%
            {metric.delta_label && (
              <span className="ml-1 font-normal text-neutral-500 dark:text-neutral-400">
                {metric.delta_label}
              </span>
            )}
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}

export default MetricWidget;
