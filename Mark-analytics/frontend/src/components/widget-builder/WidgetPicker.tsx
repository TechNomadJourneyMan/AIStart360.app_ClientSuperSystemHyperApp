import { useTranslation } from 'react-i18next';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWidgetCatalog } from '@/hooks/useWidgetCatalog';
import type { WidgetCatalogEntry } from '@/types/widgets';

export interface WidgetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (entry: WidgetCatalogEntry) => void;
}

function CatalogIcon({ name, ...props }: { name: string } & LucideProps): JSX.Element {
  const Lookup = Icons as unknown as Record<string, React.ComponentType<LucideProps>>;
  const Comp = Lookup[name] ?? Icons.Square;
  return <Comp {...props} />;
}

const TIER_STYLE: Record<string, string> = {
  free: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pro: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  team: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  enterprise: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
};

export function WidgetPicker({ open, onOpenChange, onPick }: WidgetPickerProps): JSX.Element {
  const { t } = useTranslation();
  const { data: catalog, isLoading, isError, error, refetch } = useWidgetCatalog();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('widget.builder.picker.title', 'Add a widget')}</DialogTitle>
          <DialogDescription>
            {t('widget.builder.picker.description', 'Pick a widget type to add to your dashboard.')}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`skeleton_${i}`} className="h-28 animate-pulse rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900" />
            ))}
          </div>
        )}

        {isError && (
          <div role="alert" className="flex items-center justify-between rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <span>{error.message}</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded border border-red-300 px-2 py-1 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
            >
              {t('common.retry', 'Retry')}
            </button>
          </div>
        )}

        {!isLoading && !isError && catalog && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {catalog.map((entry) => (
              <button
                key={entry.type}
                type="button"
                onClick={() => onPick(entry)}
                className="flex flex-col items-start gap-2 rounded-md border border-neutral-200 bg-white p-3 text-left transition hover:border-indigo-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-500"
              >
                <div className="flex w-full items-center justify-between">
                  <CatalogIcon name={entry.icon} className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TIER_STYLE[entry.tier] ?? ''}`}>
                    {entry.tier}
                  </span>
                </div>
                <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{entry.name}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">{entry.description}</div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default WidgetPicker;
