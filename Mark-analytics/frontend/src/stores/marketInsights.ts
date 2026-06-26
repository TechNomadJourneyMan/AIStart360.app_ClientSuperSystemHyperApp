/**
 * marketInsights — store for the «Чек-лист 50 вопросов» market Q&A insights
 * surfaced by the AIStart360 portal.
 *
 * The portal (which embeds this SPA in its /market iframe) owns the 50-question
 * checklist (blocks A–F). After the iframe loads — and on every subsequent
 * update — it posts the authored answers here via a window message
 * ({ type: 'aistart360:insights', items: [...] }), handled in `main.tsx`. The
 * map's {@link InsightsOverlay} reads this store to visually surface the Q&A on
 * the map, per the owner's requirement
 * («Вопросы и динамические инсайты нужно вывести визуально на карту»).
 *
 * This store holds only inbound state; it has no fetch of its own.
 */

import { create } from 'zustand';

export type InsightBlock = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type InsightSource = 'ai' | 'user' | 'expert';
export type InsightStatus = 'draft' | 'confirmed' | 'disputed';

export interface MarketInsight {
  /** Stable key for the question (used as React key + dedupe). */
  key: string;
  block: InsightBlock;
  block_title: string;
  question: string;
  answer: string;
  source: InsightSource;
  status: InsightStatus;
  /** 0..1 model/author confidence, when known. */
  confidence?: number | null;
  /** ISO timestamp of the last edit; drives recency sort. */
  updated_at: string;
}

export interface MarketInsightsState {
  items: MarketInsight[];
  setItems: (items: MarketInsight[]) => void;
}

export const useMarketInsightsStore = create<MarketInsightsState>((set) => ({
  items: [],
  setItems: (items) => set({ items: Array.isArray(items) ? items : [] }),
}));

/** Source priority for ranking confirmed insights: expert > user (owner) > ai. */
const SOURCE_RANK: Record<InsightSource, number> = {
  expert: 0,
  user: 1,
  ai: 2,
};

function updatedAtMs(insight: MarketInsight): number {
  const t = Date.parse(insight.updated_at);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Selector: the «top insights» to surface on the map.
 *
 * Ordering:
 *   1. Confirmed answers first, ranked by source (expert > owner > ai).
 *   2. Then drafts that clear a confidence bar (>= 0.5).
 * Within each tier, most-recently-updated first. Disputed and low-confidence
 * drafts are excluded.
 */
export function selectTopInsights(items: MarketInsight[]): MarketInsight[] {
  const confirmed: MarketInsight[] = [];
  const drafts: MarketInsight[] = [];

  for (const item of items) {
    if (item.status === 'confirmed') {
      confirmed.push(item);
    } else if (item.status === 'draft' && (item.confidence ?? 0) >= 0.5) {
      drafts.push(item);
    }
  }

  confirmed.sort((a, b) => {
    const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (bySource !== 0) return bySource;
    return updatedAtMs(b) - updatedAtMs(a);
  });

  drafts.sort((a, b) => updatedAtMs(b) - updatedAtMs(a));

  return [...confirmed, ...drafts];
}
