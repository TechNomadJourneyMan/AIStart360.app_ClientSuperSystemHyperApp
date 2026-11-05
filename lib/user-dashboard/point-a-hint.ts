/**
 * lib/user-dashboard/point-a-hint.ts — the hint under the «Точка А» tile of
 * /client/home (survey Ф5): after the express Point A is primary — «Первичная
 * · по быстрым данным» like the snapshot and the Point A header (spec §7.2,
 * lib/point-a/v4/primary.ts). Pure.
 */
import { PRELIMINARY_POINT_A_LABEL, PRIMARY_POINT_A_LABEL, isPrimaryPointA } from '@/lib/point-a/v4/primary'

/** The latest v4 snapshot row → is the assessment primary? */
export function snapshotIsPrimary(snapshot: { overall: unknown; blocks?: unknown } | null | undefined): boolean {
  if (!snapshot || snapshot.overall === null || snapshot.overall === undefined) return false
  return isPrimaryPointA(Array.isArray(snapshot.blocks) ? (snapshot.blocks as Parameters<typeof isPrimaryPointA>[0]) : null)
}

/** The latest snapshot is preliminary — the full questionnaire is not sent yet (PO 2026-11-02). */
export function snapshotIsPreliminary(snapshot: { v4?: unknown } | null | undefined): boolean {
  const v4 = snapshot?.v4
  return !!v4 && typeof v4 === 'object' && (v4 as { assessment?: unknown }).assessment === 'preliminary'
}

export function pointAStatHint(
  d: { calculatedAt: string | null; primary?: boolean; preliminary?: boolean } | null | undefined,
  fmtDate: (iso: string) => string,
): string {
  if (!d?.calculatedAt) return 'появится после анкеты'
  const at = `расчёт ${fmtDate(d.calculatedAt)}`
  if (d.preliminary) return `${PRELIMINARY_POINT_A_LABEL} · оценка после полной анкеты`
  return d.primary ? `${PRIMARY_POINT_A_LABEL} · ${at}` : at
}
