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
 * unanswered question = 0) are never shown in its place. Before the full
 * questionnaire (PO 2026-11-02) the assessment is preliminary: findings and
 * what to fill in, no numbers at all. Pure.
 */
export const PRELIMINARY_POINT_A_LABEL = 'Снимок бизнеса · предварительно'
export const PRELIMINARY_POINT_A_HINT = 'Отправьте полную анкету — появятся оценка и стадия бизнеса'
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
  /** The full questionnaire is not sent yet: findings only, no numbers (PO 2026-11-02). */
  | { kind: 'preliminary' }
  | { kind: 'too_little'; scored: string[] }
  | { kind: 'primary'; overall: number; scored: string[]; missing: string[] }
  | { kind: 'full'; overall: number }

/** What the snapshot screen says about Point A (v4 snapshot only — never v1). */
export function pointAStatus(snapshot: { overall: number | null; blocks: readonly BlockLike[]; assessment?: 'full' | 'preliminary' | null } | null | undefined): PointAStatus {
  if (!snapshot) return { kind: 'none' }
  // Snapshots before 2026-11-02 have no `assessment`: they keep the status their overall gives.
  if (snapshot.assessment === 'preliminary') return { kind: 'preliminary' }
  const weighed = snapshot.blocks.filter((b) => !b.informational)
  const scored = weighed.filter((b) => b.score !== null && b.status !== 'insufficient_data').map((b) => b.key)
  // No v4 overall: the diagnostics row fell back to v1 — its scores are not shown.
  if (snapshot.overall === null) return { kind: 'too_little', scored }
  const missing = blocksWithoutScore(snapshot.blocks)
  return missing.length ? { kind: 'primary', overall: snapshot.overall, scored, missing } : { kind: 'full', overall: snapshot.overall }
}

/** A block of a preliminary assessment in words — findings, never a score. */
export function blockFindingsText(b: { top_issues?: readonly string[]; coverage?: number }): string {
  const n = b.top_issues?.length ?? 0 // at most 3 (engine)
  if (n > 0) return n === 1 ? '1 находка' : `${n} находки`
  return (b.coverage ?? 0) >= 0.4 ? 'замечаний нет' : 'данных не хватает'
}
