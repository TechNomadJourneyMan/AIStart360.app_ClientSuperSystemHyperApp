import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Widget } from '../Widget';

export interface WidgetFrameProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
  preview?: boolean;
  children: ReactNode;
}

/**
 * Thin wrapper around the existing `Widget` shell that adds standard
 * edit/delete affordances and an optional "preview" badge. Every Track G
 * renderer composes itself inside a `WidgetFrame` so loading and error
 * states stay consistent across the dashboard.
 */
export function WidgetFrame({
  title,
  subtitle,
  loading = false,
  error = null,
  onEdit,
  onDelete,
  preview = false,
  children,
}: WidgetFrameProps): JSX.Element {
  const actions = (
    <>
      {preview && (
        <span className="rounded-sm bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
          Preview
        </span>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit widget"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete widget"
          className="rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-300"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </>
  );

  return (
    <Widget
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      loading={loading}
      error={error ?? null}
      actions={actions}
    >
      {children}
    </Widget>
  );
}

export default WidgetFrame;
