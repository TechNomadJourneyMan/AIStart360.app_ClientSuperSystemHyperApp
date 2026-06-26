import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  KZ_MACRO_INDICATORS,
  MACRO_CATEGORIES,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type IndicatorPriority,
  type MacroIndicatorEntry,
} from '@/data/kzMacroIndicators';

interface EconomyIndicatorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatValue(entry: MacroIndicatorEntry): string {
  if (entry.latest_value === null) return '—';
  // tabular numbers, keep up to 2 decimals but drop trailing zeros sensibly.
  const v = entry.latest_value;
  const str =
    Number.isInteger(v) ? v.toLocaleString('ru-RU') : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return `${str} ${entry.unit}`.trim();
}

const PRIORITY_BADGE: Record<IndicatorPriority, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  low: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

export function EconomyIndicatorsModal({
  open,
  onOpenChange,
}: EconomyIndicatorsModalProps): JSX.Element {
  // category filter: null = все категории
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [highOnly, setHighOnly] = useState(false);

  const sortedCategories = useMemo(
    () => [...MACRO_CATEGORIES].sort((a, b) => a.order - b.order),
    [],
  );

  const grouped = useMemo(() => {
    return sortedCategories
      .filter((cat) => activeCategory === null || cat.id === activeCategory)
      .map((cat) => {
        const items = KZ_MACRO_INDICATORS.filter(
          (i) => i.category === cat.id && (!highOnly || i.priority === 'high'),
        ).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
        return { category: cat, items };
      })
      .filter((g) => g.items.length > 0);
  }, [sortedCategories, activeCategory, highOnly]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          aria-describedby="economy-indicators-desc"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold tracking-tight">
                Экономика и рынок: все показатели
              </Dialog.Title>
              <Dialog.Description
                id="economy-indicators-desc"
                className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400"
              >
                Факторы, влияющие на экономику и рынок Казахстана — по категориям и приоритетам.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="shrink-0 rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
            <FilterChip
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            >
              Все
            </FilterChip>
            {sortedCategories.map((cat) => (
              <FilterChip
                key={cat.id}
                active={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.name_ru}
              </FilterChip>
            ))}
            <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" aria-hidden />
            <FilterChip active={highOnly} onClick={() => setHighOnly((v) => !v)}>
              Только high
            </FilterChip>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {grouped.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Нет показателей под выбранный фильтр.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {grouped.map(({ category, items }) => (
                  <section key={category.id}>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                      {category.name_ru}
                    </h3>
                    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
                      <table className="w-full border-collapse text-xs">
                        <tbody>
                          {items.map((entry, idx) => (
                            <tr
                              key={entry.id}
                              className={
                                idx % 2 === 0
                                  ? 'bg-white dark:bg-neutral-900'
                                  : 'bg-neutral-50 dark:bg-neutral-950'
                              }
                            >
                              <td className="px-3 py-2 align-top">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex shrink-0 items-center rounded px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide ${PRIORITY_BADGE[entry.priority]}`}
                                    title={`Приоритет: ${PRIORITY_LABELS[entry.priority]}`}
                                  >
                                    {PRIORITY_LABELS[entry.priority]}
                                  </span>
                                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                                    {entry.name_ru}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                                  {entry.impact_note}
                                </p>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                                {entry.latest_value === null ? (
                                  <div className="flex flex-col items-end">
                                    <span className="text-sm font-semibold tabular-nums text-neutral-400 dark:text-neutral-500">
                                      —
                                    </span>
                                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                                      нет данных
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-end">
                                    <span className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
                                      {formatValue(entry)}
                                    </span>
                                    {entry.period ? (
                                      <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                                        {entry.period}
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                                <span className="inline-flex items-center rounded-sm bg-neutral-100 px-1.5 py-[1px] text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                                  {entry.source}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-neutral-200 px-5 py-3 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Источники: НБРК, БНС АСПиР РК, KASE · Статичные данные, обновление вручную
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
        active
          ? 'border-indigo-500 bg-indigo-500 text-white'
          : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export default EconomyIndicatorsModal;
