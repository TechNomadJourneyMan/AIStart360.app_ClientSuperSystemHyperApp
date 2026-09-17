/**
 * lib/gri-assessment/score.ts — the canonical GRI math (0..10).
 *
 * The widget and POST /api/v1/gri/assessment each had their own copy and had
 * already drifted (the client averaged a stored 0, the server skipped it).
 * Both now import this file, so the number on screen is the number in the DB.
 */
export type GriScores = Record<string, Record<string, number>>

const roundTo2 = (n: number) => Math.round(n * 100) / 100

/** Mean of the answered (> 0) criteria per section; 0 when nothing is answered. */
export function computeSectionAvgs(scores: GriScores | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!scores || typeof scores !== 'object') return out
  for (const [sectionId, criteria] of Object.entries(scores)) {
    if (!criteria || typeof criteria !== 'object') {
      out[sectionId] = 0
      continue
    }
    const values: number[] = []
    for (const v of Object.values(criteria)) {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n) && n > 0) values.push(n)
    }
    out[sectionId] = values.length === 0 ? 0 : roundTo2(values.reduce((a, b) => a + b, 0) / values.length)
  }
  return out
}

/** Overall index = mean of the section averages that have data. */
export function computeGriIndex(sectionAvgs: Record<string, number>): number {
  const positive = Object.values(sectionAvgs).filter((v) => Number.isFinite(v) && v > 0)
  if (positive.length === 0) return 0
  return roundTo2(positive.reduce((a, b) => a + b, 0) / positive.length)
}

/**
 * Order-independent fingerprint of a score set. Used to avoid storing the same
 * completed assessment twice (re-opening the results screen used to re-POST it,
 * adding a duplicate row and burning a run of the free-tier quota).
 */
export function scoresFingerprint(scores: GriScores | null | undefined): string {
  if (!scores || typeof scores !== 'object') return ''
  const parts: string[] = []
  for (const sectionId of Object.keys(scores).sort()) {
    const criteria = scores[sectionId]
    if (!criteria || typeof criteria !== 'object') continue
    for (const criterionId of Object.keys(criteria).sort()) {
      const n = Number(criteria[criterionId])
      if (Number.isFinite(n) && n > 0) parts.push(`${sectionId}/${criterionId}=${n}`)
    }
  }
  return parts.join('|')
}
