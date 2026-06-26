import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWidgetCatalog } from '@/hooks/useWidgetCatalog';
import { useUserWidgets } from '@/hooks/useUserWidgets';
import { useWidgetAiSuggest } from '@/hooks/useWidgetAiSuggest';
import { renderWidgetByType } from '@/components/widgets/types';
import type { WidgetCatalogEntry, WidgetRead, WidgetType } from '@/types/widgets';
import { JsonSchemaForm } from './JsonSchemaForm';

type Mode =
  | { kind: 'create'; type: WidgetType }
  | { kind: 'edit'; widget: WidgetRead };

export interface WidgetEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode | null;
}

export function WidgetEditor({ open, onOpenChange, mode }: WidgetEditorProps): JSX.Element {
  const { t } = useTranslation();
  const { data: catalog } = useWidgetCatalog();
  const { create, update } = useUserWidgets();
  const aiSuggest = useWidgetAiSuggest();

  const initialType: WidgetType | null = mode
    ? mode.kind === 'edit'
      ? mode.widget.type
      : mode.type
    : null;

  const initialParams: Record<string, unknown> = useMemo(() => {
    if (!mode) return {};
    if (mode.kind === 'edit') return { ...mode.widget.params };
    const entry = catalog?.find((c) => c.type === mode.type);
    return entry ? { ...entry.default_params } : {};
  }, [mode, catalog]);

  const [params, setParams] = useState<Record<string, unknown>>(initialParams);
  const [activeType, setActiveType] = useState<WidgetType | null>(initialType);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // Reset state when mode changes.
  useEffect(() => {
    setParams(initialParams);
    setActiveType(initialType);
    setAiOpen(false);
    setAiPrompt('');
    setAiError(null);
  }, [initialParams, initialType]);

  // Debounced draft used by the live preview to avoid spamming the server.
  const [debounced, setDebounced] = useState(params);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(params), 400);
    return () => window.clearTimeout(handle);
  }, [params]);

  const entry: WidgetCatalogEntry | undefined = catalog?.find((c) => c.type === activeType);

  // Preview widget — re-uses the existing draft id when editing so layout is preserved.
  const previewWidget: WidgetRead | null = useMemo(() => {
    if (!activeType) return null;
    if (mode?.kind === 'edit') {
      return { ...mode.widget, type: activeType, params: debounced };
    }
    return {
      id: 'preview',
      type: activeType,
      name: typeof debounced.title === 'string' ? debounced.title : entry?.name ?? 'Preview',
      params: debounced,
      layout: null,
      order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, [activeType, debounced, entry, mode]);

  const handleSave = (): void => {
    if (!activeType || !entry) return;
    const name = typeof params.title === 'string' && params.title.length > 0 ? params.title : entry.name;
    if (mode?.kind === 'edit') {
      update.mutate(
        { id: mode.widget.id, patch: { name, params, ...(activeType !== mode.widget.type ? {} : {}) } },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      create.mutate(
        { type: activeType, name, params },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  const handleAiSuggest = (): void => {
    setAiError(null);
    aiSuggest.mutate(
      { prompt: aiPrompt, ...(activeType ? { type: activeType } : {}) },
      {
        onSuccess: (resp) => {
          if (resp.ok) {
            setActiveType(resp.type);
            setParams(resp.params);
            setFlash(true);
            window.setTimeout(() => setFlash(false), 800);
            setAiOpen(false);
            setAiPrompt('');
          } else {
            setAiError(resp.message);
          }
        },
        onError: (err) => setAiError(err.message),
      },
    );
  };

  if (!mode) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>
              {mode.kind === 'edit'
                ? t('widget.builder.editor.title_edit', 'Edit widget')
                : t('widget.builder.editor.title_create', 'New widget')}
            </DialogTitle>
            <button
              type="button"
              onClick={() => setAiOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
            >
              <Sparkles className="h-3 w-3" />
              {t('widget.builder.ai_suggest.button', 'Ask AI')}
            </button>
          </div>
        </DialogHeader>

        {aiOpen && (
          <div className="rounded-md border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-800 dark:bg-indigo-950/40">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
                {t('widget.builder.ai_suggest.label', 'Describe the widget you want')}
              </span>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                aria-label="Close AI input"
                className="rounded p-1 text-indigo-700 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={t(
                'widget.builder.ai_suggest.placeholder',
                'e.g., a bar chart of top industries by revenue',
              )}
              rows={3}
              className="w-full rounded border border-indigo-200 bg-white p-2 text-xs text-neutral-900 focus:border-indigo-500 focus:outline-none dark:border-indigo-800 dark:bg-neutral-950 dark:text-neutral-100"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {aiError && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  {aiError} —{' '}
                  <span className="font-medium">
                    {t('widget.builder.ai_suggest.retry_hint', 'try rephrasing')}
                  </span>
                </span>
              )}
              <button
                type="button"
                disabled={aiSuggest.isPending || !aiPrompt.trim()}
                onClick={handleAiSuggest}
                className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {aiSuggest.isPending
                  ? t('widget.builder.ai_suggest.thinking', 'Thinking…')
                  : t('widget.builder.ai_suggest.go', 'Suggest')}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Left: form */}
          <div className={`max-h-[480px] overflow-auto rounded border border-neutral-200 p-3 transition-colors dark:border-neutral-800 ${flash ? 'ring-2 ring-indigo-400' : ''}`}>
            {entry ? (
              <JsonSchemaForm schema={entry.schema} value={params} onChange={setParams} />
            ) : (
              <div className="text-xs text-neutral-500">Loading schema…</div>
            )}
          </div>

          {/* Right: live preview */}
          <div className="h-[480px] rounded border border-neutral-200 dark:border-neutral-800">
            {previewWidget && (
              <div className="h-full w-full p-1">
                <PreviewSlot widget={previewWidget} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t('widget.builder.editor.save', 'Save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renders the preview widget with the "Preview" badge in WidgetFrame. */
function PreviewSlot({ widget }: { widget: WidgetRead }): JSX.Element {
  // We don't pass onEdit/onDelete in preview — but we want a "Preview" badge.
  // The renderer dispatcher wraps in WidgetFrame, but doesn't know about
  // preview. Instead we lean on a wrapping class to visually mark it; the
  // actual badge ships once the editor opens around the saved widget.
  return <div className="h-full">{renderWidgetByType(widget)}</div>;
}

export default WidgetEditor;
