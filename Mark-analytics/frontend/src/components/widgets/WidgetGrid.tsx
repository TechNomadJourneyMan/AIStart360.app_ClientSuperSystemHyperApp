import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import { RotateCcw } from 'lucide-react';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

export interface WidgetGridProps {
  widgets: ReactNode[];
  /** Optional aria-label for the grid section. */
  ariaLabel?: string;
}

const ResponsiveGridLayout = WidthProvider(Responsive);

// v2: macro indicators moved to a full-width TOP row. Bumping the key
// migrates/resets any layout saved under the previous (v1) schema once.
const STORAGE_KEY = 'mk-widget-layout-v2';

/**
 * Phase 2 widget grid: drag + resize, with layout persisted to localStorage.
 *
 * - Powered by react-grid-layout (Responsive + WidthProvider).
 * - Each child's React `key` is used as the layout `i` so callers don't have
 *   to change their props shape.
 * - Defaults target ~40vh container: rowHeight is small (28px) and item heights
 *   are tuned so 7 widgets in lg/md/sm all fit without forcing scroll on first
 *   paint.
 */

// Breakpoints + columns used by ResponsiveGridLayout.
const BREAKPOINTS = { lg: 1200, md: 768, sm: 0 } as const;
const COLS = { lg: 4, md: 4, sm: 2 } as const;
const ROW_HEIGHT = 28;
const MARGIN: [number, number] = [8, 8];

/** Default tile spec per known widget key. Order matters for fallback packing. */
interface TileSpec {
  i: string;
  // lg/md (4-col)
  w: number;
  h: number;
  // sm (2-col override)
  sw?: number;
  sh?: number;
  minW?: number;
  minH?: number;
}

const DEFAULT_TILES: TileSpec[] = [
  // Макропоказатели — full-width TOP row by default (v2 layout).
  { i: 'macro', w: 4, h: 4, sw: 2, sh: 5, minW: 2, minH: 3 },
  { i: 'ticker', w: 2, h: 4, sw: 2, sh: 3, minW: 1, minH: 2 },
  { i: 'heatmap', w: 2, h: 4, sw: 2, sh: 4, minW: 1, minH: 2 },
  { i: 'top', w: 2, h: 4, sw: 2, sh: 4, minW: 1, minH: 2 },
  { i: 'size', w: 2, h: 4, sw: 2, sh: 4, minW: 1, minH: 2 },
  { i: 'tenders', w: 2, h: 4, sw: 2, sh: 4, minW: 1, minH: 2 },
  { i: 'news', w: 4, h: 4, sw: 2, sh: 4, minW: 1, minH: 2 },
];

function packLayout(specs: TileSpec[], cols: number, useSmall: boolean): Layout[] {
  let x = 0;
  let y = 0;
  let rowMaxH = 0;
  const out: Layout[] = [];
  for (const spec of specs) {
    const w = Math.min(useSmall && spec.sw ? spec.sw : spec.w, cols);
    const h = useSmall && spec.sh ? spec.sh : spec.h;
    if (x + w > cols) {
      x = 0;
      y += rowMaxH;
      rowMaxH = 0;
    }
    out.push({ i: spec.i, x, y, w, h, minW: spec.minW, minH: spec.minH });
    x += w;
    rowMaxH = Math.max(rowMaxH, h);
  }
  return out;
}

function buildDefaultLayouts(ids: string[]): Layouts {
  // Filter+order DEFAULT_TILES by the actual children ids; unknown ids get a
  // generic 2x4 spec appended.
  const specs: TileSpec[] = ids.map((id) => {
    const known = DEFAULT_TILES.find((t) => t.i === id);
    return known ?? { i: id, w: 2, h: 4, sw: 2, sh: 4, minW: 1, minH: 2 };
  });
  return {
    lg: packLayout(specs, COLS.lg, false),
    md: packLayout(specs, COLS.md, false),
    sm: packLayout(specs, COLS.sm, true),
  };
}

function isLayoutItem(value: unknown): value is Layout {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.i === 'string' &&
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.w === 'number' &&
    typeof v.h === 'number'
  );
}

function isLayouts(value: unknown): value is Layouts {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (['lg', 'md', 'sm'] as const).every(
    (bp) => Array.isArray(v[bp]) && (v[bp] as unknown[]).every(isLayoutItem),
  );
}

function readStoredLayouts(): Layouts | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLayouts(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function reconcileLayouts(stored: Layouts, ids: string[]): Layouts {
  const idSet = new Set(ids);
  const defaults = buildDefaultLayouts(ids);
  const out: Layouts = {};
  for (const bp of ['lg', 'md', 'sm'] as const) {
    const kept = (stored[bp] ?? []).filter((item) => idSet.has(item.i));
    const keptIds = new Set(kept.map((k) => k.i));
    const missing = (defaults[bp] ?? []).filter((d) => !keptIds.has(d.i));
    out[bp] = [...kept, ...missing];
  }
  return out;
}

export function WidgetGrid({
  widgets,
  ariaLabel = 'Dashboard widgets',
}: WidgetGridProps): JSX.Element {
  // Extract a stable id per widget from its React key.
  const items = useMemo(() => {
    const out: { id: string; node: ReactNode }[] = [];
    Children.forEach(widgets, (child, idx) => {
      let id: string;
      if (isValidElement(child) && child.key != null) {
        id = String(child.key);
      } else {
        id = `widget-${idx}`;
      }
      out.push({ id, node: child });
    });
    return out;
  }, [widgets]);

  const ids = useMemo(() => items.map((it) => it.id), [items]);
  const defaults = useMemo(() => buildDefaultLayouts(ids), [ids]);

  const [layouts, setLayouts] = useState<Layouts>(() => {
    const stored = readStoredLayouts();
    if (stored) return reconcileLayouts(stored, ids);
    return defaults;
  });

  // If the set of ids changes after mount, make sure layouts cover all of them.
  useEffect(() => {
    setLayouts((prev) => reconcileLayouts(prev, ids));
  }, [ids]);

  const saveTimerRef = useRef<number | null>(null);
  const handleLayoutChange = useCallback(
    (_current: Layout[], allLayouts: Layouts): void => {
      setLayouts(allLayouts);
      if (typeof window === 'undefined') return;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allLayouts));
        } catch {
          // localStorage may be unavailable (quota, privacy mode) — ignore.
        }
      }, 250);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const handleReset = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    setLayouts(buildDefaultLayouts(ids));
  }, [ids]);

  return (
    <section aria-label={ariaLabel} className="relative w-full h-full p-1">
      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white/90 px-2 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:bg-neutral-800"
          aria-label="Reset widget layout"
          title="Reset widget layout"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          <span>Reset layout</span>
        </button>
      </div>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        containerPadding={[4, 4]}
        draggableCancel="button, a, input, select, textarea, [data-no-drag]"
        compactType="vertical"
        isBounded
        onLayoutChange={handleLayoutChange}
      >
        {items.map(({ id, node }) => (
          <div key={id} className="min-w-0 min-h-0 overflow-hidden">
            {node}
          </div>
        ))}
      </ResponsiveGridLayout>
    </section>
  );
}

export default WidgetGrid;
