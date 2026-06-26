import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { industryLegend, type Theme } from '../../lib/colorScheme';
import { cn } from '@/lib/cn';
import { useMapFilterStore } from './mapFilterStore';

export interface MapLegendProps {
  theme?: Theme;
  defaultExpanded?: boolean;
  className?: string;
}

export function MapLegend({
  theme = 'light',
  defaultExpanded = true,
  className,
}: MapLegendProps): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const entries = useMemo(() => industryLegend(theme), [theme]);

  const selectedIndustries = useMapFilterStore((s) => s.selectedIndustries);
  const toggleIndustry = useMapFilterStore((s) => s.toggleIndustry);
  const clearIndustries = useMapFilterStore((s) => s.clearIndustries);
  const activeCount = selectedIndustries.size;

  const handleToggle = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  return (
    <div
      className={cn(
        'rounded-md border border-neutral-200 bg-white/95 text-neutral-800 shadow-sm backdrop-blur',
        'dark:border-neutral-700 dark:bg-neutral-900/85 dark:text-neutral-100',
        'text-xs select-none',
        className,
      )}
      role="region"
      aria-label={t('map.legend.title')}
    >
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-1.5 font-semibold',
          'rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        )}
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-controls="map-legend-body"
      >
        <span className="flex items-center gap-1.5">
          {t('map.legend.title')}
          {activeCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-neutral-500 dark:text-neutral-400">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded ? (
        <div id="map-legend-body" className="px-3 pb-2 pt-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
              {activeCount > 0
                ? 'Фильтр по отраслям активен'
                : 'Нажмите отрасль, чтобы отфильтровать'}
            </span>
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={clearIndustries}
                className="shrink-0 rounded-full border border-neutral-300 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                сбросить
              </button>
            ) : null}
          </div>
          <ul className="grid max-h-[40vh] grid-cols-1 gap-0.5 overflow-auto sm:grid-cols-2">
            {entries.map((entry) => {
              const active = selectedIndustries.has(entry.section);
              const dimmed = activeCount > 0 && !active;
              return (
                <li key={entry.section}>
                  <button
                    type="button"
                    onClick={() => toggleIndustry(entry.section)}
                    aria-pressed={active}
                    title={`${entry.section} — ${entry.label}`}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left leading-tight transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                      active && 'bg-indigo-50 dark:bg-indigo-950/50',
                      !active && 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      dimmed && 'opacity-45',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-block h-2.5 w-2.5 shrink-0 rounded-full border',
                        active
                          ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-neutral-900'
                          : 'border-black/10 dark:border-white/15',
                      )}
                      style={{ backgroundColor: entry.hex }}
                    />
                    <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                      {entry.section}
                    </span>
                    <span className="truncate">{entry.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default MapLegend;
