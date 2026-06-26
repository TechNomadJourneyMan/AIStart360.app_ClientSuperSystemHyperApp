import { useCallback, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, RefreshCcw } from 'lucide-react';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { renderWidgetByType } from '@/components/widgets/types';
import { WidgetPicker } from '@/components/widget-builder/WidgetPicker';
import { WidgetEditor } from '@/components/widget-builder/WidgetEditor';
import { useLayoutMigration } from '@/components/widget-builder/useLayoutMigration';
import { useUserWidgets } from '@/hooks/useUserWidgets';
import type { WidgetCatalogEntry, WidgetRead, WidgetType } from '@/types/widgets';

export const Route = createFileRoute('/dashboard')({
  component: DashboardRoute,
});

type EditorMode =
  | { kind: 'create'; type: WidgetType }
  | { kind: 'edit'; widget: WidgetRead }
  | null;

function DashboardRoute(): JSX.Element {
  const { t } = useTranslation();
  const api = useUserWidgets();
  const widgets = useMemo(() => api.query.data ?? [], [api.query.data]);

  // One-shot localStorage → DB layout migration.
  useLayoutMigration(api.query.data, api);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const handlePick = useCallback((entry: WidgetCatalogEntry) => {
    setPickerOpen(false);
    setEditorMode({ kind: 'create', type: entry.type });
  }, []);

  const handleEdit = useCallback((widget: WidgetRead) => {
    setEditorMode({ kind: 'edit', widget });
  }, []);

  const handleDelete = useCallback(
    (widget: WidgetRead) => {
      if (window.confirm(t('widget.builder.confirm_delete', 'Delete this widget?'))) {
        api.remove.mutate(widget.id);
      }
    },
    [api.remove, t],
  );

  const handleReset = useCallback(() => {
    if (
      window.confirm(
        t('widget.builder.confirm_reset', 'Reset dashboard to defaults? This removes all widgets.'),
      )
    ) {
      for (const w of widgets) api.remove.mutate(w.id);
    }
    setMenuOpen(false);
  }, [api.remove, t, widgets]);

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h1 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {t('nav.dashboard', 'Dashboard')}
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
          >
            <Plus className="h-3 w-3" />
            {t('widget.builder.picker.add', 'Add widget')}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Dashboard menu"
              className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded border border-neutral-200 bg-white shadow dark:border-neutral-800 dark:bg-neutral-900"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  <RefreshCcw className="h-3 w-3" />
                  {t('widget.builder.reset_defaults', 'Reset to defaults')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {api.query.isLoading && (
          <div className="p-4 text-sm text-neutral-500" aria-busy>
            {t('common.loading', 'Loading…')}
          </div>
        )}
        {api.query.isError && (
          <div role="alert" className="m-4 flex items-center justify-between rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <span>{api.query.error.message}</span>
            <button
              type="button"
              onClick={() => void api.query.refetch()}
              className="rounded border border-red-300 px-2 py-1 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
            >
              {t('common.retry', 'Retry')}
            </button>
          </div>
        )}
        {!api.query.isLoading && !api.query.isError && widgets.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-neutral-500 dark:text-neutral-400">
            <span>{t('widget.builder.empty', 'No widgets yet — add one to get started.')}</span>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3 w-3" />
              {t('widget.builder.picker.add', 'Add widget')}
            </button>
          </div>
        )}
        {widgets.length > 0 && (
          <WidgetGrid
            widgets={widgets.map((w) =>
              renderWidgetByType(w, {
                onEdit: () => handleEdit(w),
                onDelete: () => handleDelete(w),
              }),
            )}
          />
        )}
      </main>

      <WidgetPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={handlePick} />
      <WidgetEditor open={editorMode !== null} onOpenChange={(o) => !o && setEditorMode(null)} mode={editorMode} />
    </div>
  );
}
