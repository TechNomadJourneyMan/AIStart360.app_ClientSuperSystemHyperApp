import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMapStore, type RegionMetric } from '../../stores/map';
import { cn } from '../../lib/cn';

const METRICS: RegionMetric[] = ['count', 'revenue', 'employees', 'risk'];

export interface MetricSelectorProps {
  className?: string;
}

export function MetricSelector({ className }: MetricSelectorProps): JSX.Element {
  const { t } = useTranslation();
  const metric = useMapStore((s) => s.metric);
  const setMetric = useMapStore((s) => s.setMetric);

  return (
    <fieldset
      role="radiogroup"
      aria-label={t('region.metric.label') ?? 'Region metric'}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-neutral-200 bg-white/90 p-0.5 shadow-sm backdrop-blur',
        'dark:border-neutral-700 dark:bg-neutral-900/80',
        className,
      )}
    >
      {METRICS.map((m) => {
        const active = m === metric;
        const isRisk = m === 'risk';
        return (
          <label
            key={m}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              'focus-within:ring-2 focus-within:ring-indigo-400',
              active && !isRisk && 'bg-indigo-600 text-white',
              active && isRisk && 'bg-rose-600 text-white',
              !active &&
                'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800',
            )}
          >
            <input
              type="radio"
              name="region-metric"
              value={m}
              checked={active}
              onChange={() => setMetric(m)}
              className="sr-only"
            />
            {isRisk ? <Shield className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {t(`region.metric.${m}`)}
          </label>
        );
      })}
    </fieldset>
  );
}

export default MetricSelector;
