import { useEffect, useRef } from 'react';
import type { WidgetLayout, WidgetRead } from '@/types/widgets';
import type { useUserWidgets } from '@/hooks/useUserWidgets';

const LOCAL_STORAGE_KEY = 'mk-widget-layout-v1';

interface LegacyLayoutEntry {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/**
 * One-shot migration of layouts from the Phase 2 localStorage store into
 * persisted per-widget `layout` columns. Only runs when:
 *
 *  - localStorage has the legacy key
 *  - the user already has ≥ 1 widget on the server
 *  - none of those widgets have a persisted layout yet
 *
 * Match key is `entry.i === widget.name`. On success we clear the key so
 * the migration never runs again, and log a count in dev.
 */
export function useLayoutMigration(
  widgets: WidgetRead[] | undefined,
  api: ReturnType<typeof useUserWidgets>,
): void {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (!widgets || widgets.length === 0) return;
    if (widgets.some((w) => w.layout !== null)) return;

    let raw: string | null;
    try {
      raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;

    let parsed: LegacyLayoutEntry[] | null = null;
    try {
      parsed = JSON.parse(raw) as LegacyLayoutEntry[];
    } catch {
      console.warn('[widgets] localStorage layout was invalid JSON, ignoring');
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed)) return;

    done.current = true;

    let migrated = 0;
    for (const entry of parsed) {
      const match = widgets.find((w) => w.name === entry.i || w.id === entry.i);
      if (!match) continue;
      const layout: WidgetLayout = {
        i: match.id,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        ...(entry.minW !== undefined ? { minW: entry.minW } : {}),
        ...(entry.minH !== undefined ? { minH: entry.minH } : {}),
      };
      api.update.mutate({ id: match.id, patch: { layout } });
      migrated += 1;
    }

    try {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // ignore
    }

    if (import.meta.env.DEV) {
      console.info(`[widgets] migrated ${migrated} layout entries from localStorage`);
    }
  }, [widgets, api]);
}
