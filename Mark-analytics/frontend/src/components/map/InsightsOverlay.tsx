/**
 * InsightsOverlay — floating panel docked bottom-left over the map that
 * visually surfaces the AIStart360 «Чек-лист 50 вопросов» market Q&A.
 *
 * Data arrives from the portal via the `aistart360:insights` window message
 * (handled in `main.tsx` → {@link useMarketInsightsStore}). This panel renders
 * the top-ranked answers (see {@link selectTopInsights}) as compact cards and
 * lets the user jump back to the portal's checklist tab via a `navigate`
 * message. Styling matches the map's other controls (MapControls / MapLegend):
 * rounded, bordered, dark, backdrop-blurred.
 *
 * Collapsible like the «Отрасли» legend. Empty state shows a single pill.
 */

import { useMemo, useState, useCallback } from 'react';

import { cn } from '@/lib/cn';
import {
  useMarketInsightsStore,
  selectTopInsights,
  type MarketInsight,
  type InsightBlock,
  type InsightSource,
} from '@/stores/marketInsights';

/** How many cards to show in the expanded panel. */
const MAX_CARDS = 5;

/** Allowed portal origins to which the navigate message is posted. Mirrors the
 * PORTAL_ORIGINS set in `main.tsx` (we iterate known origins — never '*'). */
const PORTAL_ORIGINS: string[] = [
  'http://localhost:53000',
  'http://localhost:3000',
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_PORTAL_ORIGIN,
].filter((o): o is string => Boolean(o));

/** Per-block accent colors for the block-letter badge. */
const BLOCK_COLOR: Record<InsightBlock, string> = {
  A: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  B: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  C: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  D: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  E: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  F: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
};

interface SourceMeta {
  label: string;
  className: string;
}

const SOURCE_META: Record<InsightSource, SourceMeta> = {
  expert: {
    label: 'Эксперт',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  user: {
    label: 'Владелец',
    className: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/40',
  },
  ai: {
    label: 'AI',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
};

/** Post the «open checklist» navigate intent to every known portal origin. */
function postOpenChecklist(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  for (const origin of PORTAL_ORIGINS) {
    try {
      window.parent.postMessage(
        { type: 'aistart360:navigate', tab: 'checklist' },
        origin,
      );
    } catch {
      /* origin mismatch — ignore and try the next known origin */
    }
  }
}

function InsightCard({ insight }: { insight: MarketInsight }): JSX.Element {
  const source = SOURCE_META[insight.source];
  const isDraft = insight.status === 'draft';
  return (
    <li className="rounded-md border border-neutral-700/70 bg-neutral-800/50 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold',
            BLOCK_COLOR[insight.block],
          )}
          title={insight.block_title}
          aria-label={`Блок ${insight.block}: ${insight.block_title}`}
        >
          {insight.block}
        </span>
        <p
          className="truncate text-[11px] font-medium leading-tight text-neutral-200"
          title={insight.question}
        >
          {insight.question}
        </p>
      </div>
      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-neutral-400">
        {insight.answer}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium',
            source.className,
          )}
        >
          {source.label}
        </span>
        {isDraft ? (
          <span className="inline-flex items-center rounded-full border border-neutral-600 px-1.5 py-px text-[10px] font-medium text-neutral-400">
            черновик
          </span>
        ) : null}
      </div>
    </li>
  );
}

export interface InsightsOverlayProps {
  className?: string;
  defaultExpanded?: boolean;
}

export function InsightsOverlay({
  className,
  defaultExpanded = true,
}: InsightsOverlayProps): JSX.Element {
  const items = useMarketInsightsStore((s) => s.items);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const top = useMemo(() => selectTopInsights(items).slice(0, MAX_CARDS), [items]);
  const count = items.length;
  const isEmpty = count === 0;

  const handleToggle = useCallback(() => setExpanded((v) => !v), []);

  const footer = (
    <button
      type="button"
      onClick={postOpenChecklist}
      className="mt-1.5 inline-flex w-full items-center justify-center rounded border border-indigo-500/50 bg-indigo-500/15 px-2 py-1 text-[11px] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      Открыть чек-лист 50 →
    </button>
  );

  // Collapsed pill — used in both empty and non-empty states.
  if (!expanded) {
    return (
      <div
        className={cn(
          'pointer-events-auto select-none rounded-md border border-neutral-700 bg-neutral-900/80 text-neutral-100 shadow-sm backdrop-blur',
          className,
        )}
      >
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={false}
          aria-controls="insights-overlay-body"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <span>Инсайты рынка</span>
          <span className="text-neutral-500">·</span>
          <span className="text-neutral-400">{count}</span>
          <span aria-hidden="true" className="ml-0.5 text-neutral-500">
            ▾
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'pointer-events-auto w-[260px] select-none rounded-md border border-neutral-700 bg-neutral-900/80 text-neutral-100 shadow-sm backdrop-blur',
        className,
      )}
      role="region"
      aria-label="Инсайты рынка"
    >
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded
        aria-controls="insights-overlay-body"
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <span className="flex items-center gap-1.5">
          Инсайты рынка
          {count > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
              {count}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-neutral-400">
          ▴
        </span>
      </button>

      <div id="insights-overlay-body" className="px-3 pb-2 pt-0.5">
        {isEmpty ? (
          <p className="text-[11px] leading-snug text-neutral-400">
            Инсайты появятся после заполнения чек-листа 50 вопросов
          </p>
        ) : (
          <ul className="flex max-h-[42vh] flex-col gap-1.5 overflow-auto">
            {top.map((insight) => (
              <InsightCard key={insight.key} insight={insight} />
            ))}
          </ul>
        )}
        {footer}
      </div>
    </div>
  );
}

export default InsightsOverlay;
