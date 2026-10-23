/**
 * lib/point-a/v4/primary.ts — «Первичная Точка А» (spec 2026-10-23 §7.2).
 *
 * After the express flow Point A v4 scores only the blocks the 26 quick
 * answers reach; the rest stay «данных не хватает». While at least one weighed
 * block is in that state the assessment is shown as «Первичная · по быстрым
 * данным» with «Уточните блоки ниже, чтобы оценка стала полной» — in the
 * business snapshot, in the Point A header and in the cabinet. The reliability
 * stays the existing v4 scale (confidence = coverage × 0.9).
 *
 * No v4 overall at all → «Данных пока мало для общей оценки»: v1 scores (an
 * unanswered question = 0) are never shown in its place. Pure.
 */
export const PRIMARY_POINT_A_LABEL = 'Первичная · по быстрым данным'
export const PRIMARY_POINT_A_HINT = 'Уточните блоки ниже, чтобы оценка стала полной'
export const POINT_A_TOO_LITTLE_DATA = 'Данных пока мало для общей оценки'

interface BlockLike { key: string; status?: string; score: number | null; informational?: boolean }

/** Weighed blocks without a score. */
export function blocksWithoutScore(blocks: readonly BlockLike[]): string[] {
  return blocks.filter((b) => !b.informational && (b.status === 'insufficient_data' || b.score === null)).map((b) => b.key)
}

/** The assessment is primary: at least one weighed block has no data. */
export function isPrimaryPointA(blocks: readonly BlockLike[] | null | undefined): boolean {
  return !!blocks && blocks.length > 0 && blocksWithoutScore(blocks).length > 0
}

export type PointAStatus =
  | { kind: 'none' }
  | { kind: 'too_little'; scored: string[] }
  | { kind: 'primary'; overall: number; scored: string[]; missing: string[] }
  | { kind: 'full'; overall: number }

/** What the snapshot screen says about Point A (v4 snapshot only — never v1). */
export function pointAStatus(snapshot: { overall: number | null; blocks: readonly BlockLike[] } | null | undefined): PointAStatus {
  if (!snapshot) return { kind: 'none' }
  const weighed = snapshot.blocks.filter((b) => !b.informational)
  const scored = weighed.filter((b) => b.score !== null && b.status !== 'insufficient_data').map((b) => b.key)
  // No v4 overall: the diagnostics row fell back to v1 — its scores are not shown.
  if (snapshot.overall === null) return { kind: 'too_little', scored }
  const missing = blocksWithoutScore(snapshot.blocks)
  return missing.length ? { kind: 'primary', overall: snapshot.overall, scored, missing } : { kind: 'full', overall: snapshot.overall }
}
