import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Check, Pencil, X } from 'lucide-react';
import { useUserWidgets } from '@/hooks/useUserWidgets';
import { useWidgetData } from '@/hooks/useWidgetData';
import type { WidgetRead } from '@/types/widgets';
import { WidgetFrame } from './WidgetFrame';

export interface NoteWidgetProps {
  widget: WidgetRead;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function NoteWidget({ widget, onEdit, onDelete }: NoteWidgetProps): JSX.Element {
  const { data, isLoading, isError, error } = useWidgetData(widget);
  const { update } = useUserWidgets();

  const title = typeof widget.params.title === 'string' ? widget.params.title : widget.name;
  const note = data && data.type === 'note' ? data : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');

  useEffect(() => {
    if (note) setDraft(note.markdown);
  }, [note]);

  const inlineEditButton = (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit note inline"
      className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      <Pencil className="h-3 w-3" />
    </button>
  );

  return (
    <WidgetFrame
      title={title}
      loading={isLoading}
      error={isError ? error.message : null}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
    >
      {editing ? (
        <div className="flex h-full flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 resize-none rounded border border-neutral-300 bg-white p-2 text-xs font-mono text-neutral-900 focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            aria-label="Note markdown editor"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                update.mutate(
                  { id: widget.id, patch: { params: { ...widget.params, markdown: draft } } },
                  { onSuccess: () => setEditing(false) },
                );
              }}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500"
            >
              <Check className="h-3 w-3" />
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="relative h-full">
          <div className="absolute right-0 top-0 z-10">{inlineEditButton}</div>
          <div className="prose prose-sm max-w-none text-xs text-neutral-800 dark:prose-invert dark:text-neutral-200">
            <ReactMarkdown>{note?.markdown ?? ''}</ReactMarkdown>
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}

export default NoteWidget;
