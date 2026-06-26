import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persisted dashboard widget layout.
 *
 * Holds the user's chosen widget order and which widgets are hidden on the
 * main dashboard (`/`). Drag-to-reorder writes `order`; the settings popover
 * writes `hidden`. Both survive reloads via localStorage.
 *
 * localStorage key: `mk-dashboard-layout`.
 *
 * Forward-compat: `mergeWithDefaults` reconciles a persisted layout with the
 * current set of widget ids, so adding/removing a widget in code never breaks
 * an older saved layout (new ids append, dropped ids are filtered out).
 */

/** Canonical default widget id order. Single source of truth for new users. */
export const DEFAULT_WIDGET_ORDER = [
  'macro',
  'heatmap',
  'top',
  'size',
  'tenders',
  'news',
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];

export const DASHBOARD_LAYOUT_STORAGE_KEY = 'mk-dashboard-layout';

export interface DashboardLayoutState {
  /** Widget ids in display order (left→right, top→bottom). */
  order: string[];
  /** Widget ids the user has hidden. */
  hidden: string[];

  /** Replace the full order (called on drag end). */
  setOrder: (order: string[]) => void;
  /** Show/hide a single widget. */
  toggleHidden: (id: string) => void;
  /** Restore the default order and clear all hidden widgets. */
  reset: () => void;
}

/**
 * Reconcile a (possibly stale) persisted order with the known widget ids.
 *
 * - Keeps persisted ordering for ids that still exist.
 * - Appends any known ids missing from the persisted order (new widgets).
 * - Drops persisted ids no longer known (removed widgets).
 */
export function mergeWithDefaults(
  persistedOrder: readonly string[],
  knownIds: readonly string[],
): string[] {
  const known = new Set(knownIds);
  const kept = persistedOrder.filter((id) => known.has(id));
  const seen = new Set(kept);
  const appended = knownIds.filter((id) => !seen.has(id));
  return [...kept, ...appended];
}

export const useDashboardLayoutStore = create<DashboardLayoutState>()(
  persist(
    (set) => ({
      order: [...DEFAULT_WIDGET_ORDER],
      hidden: [],

      setOrder: (order) => set({ order }),
      toggleHidden: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id)
            ? s.hidden.filter((x) => x !== id)
            : [...s.hidden, id],
        })),
      reset: () => set({ order: [...DEFAULT_WIDGET_ORDER], hidden: [] }),
    }),
    {
      name: DASHBOARD_LAYOUT_STORAGE_KEY,
      // Persist only data, not the action functions.
      partialize: (s) => ({ order: s.order, hidden: s.hidden }),
    },
  ),
);
