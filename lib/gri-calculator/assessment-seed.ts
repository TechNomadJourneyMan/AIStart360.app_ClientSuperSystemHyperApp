// lib/gri-calculator/assessment-seed.ts — the GRI assessment's section
// averages mapped onto the calculator's seven categories, and the score
// allowlist for the GRI AI routes.
//
// The calculator starts from DEFAULT_SCORES (slider positions, not a client's
// data). Anything that presents scores as the client's — the AI strategy, the
// analyst prompt — needs either a full set from the saved assessment or the
// client's own slider input.

import { CATEGORIES } from './gri-data'

/** Assessment section id → calculator category («Owner Readiness» is «Founder Ready» there). */
export const SECTION_TO_CATEGORY: Record<string, string> = {
  'product-demand': 'Product & Demand',
  'trust-positioning': 'Trust & Positioning',
  'business-model': 'Business Model',
  'cash-stability': 'Cash Stability',
  operations: 'Operations',
  team: 'Team',
  'owner-readiness': 'Founder Ready',
}

/** Section average → slider value (0–10, whole numbers). */
export function sliderValue(avg: number): number {
  return Math.max(0, Math.min(10, Math.round(avg)))
}

/**
 * Calculator scores from the assessment's section averages, or null unless
 * every category has a positive average — a partial set would leave template
 * values standing in for the missing ones.
 */
export function scoresFromSectionAvgs(sectionAvgs: unknown): Record<string, number> | null {
  if (!sectionAvgs || typeof sectionAvgs !== 'object') return null
  const avgs = sectionAvgs as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [sectionId, category] of Object.entries(SECTION_TO_CATEGORY)) {
    const v = avgs[sectionId]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
    out[category] = sliderValue(v)
  }
  return CATEGORIES.every((c) => c in out) ? out : null
}

/**
 * Scores from a request body as they may enter a prompt: only the seven
 * categories, each a number 0–10. Other keys (free text a client could put
 * there) and other values are dropped.
 */
export function knownScores(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const bag = raw as Record<string, unknown>
  for (const c of CATEGORIES) {
    const v = bag[c]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10) out[c] = Math.round(v * 10) / 10
  }
  return out
}

export function hasAllScores(scores: Record<string, number>): boolean {
  return CATEGORIES.every((c) => typeof scores[c] === 'number')
}
