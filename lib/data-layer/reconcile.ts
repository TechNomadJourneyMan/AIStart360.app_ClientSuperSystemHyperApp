/**
 * lib/data-layer/reconcile.ts — discrepancies between sources (spec §1.5).
 *
 *   conflict  the same metric, the SAME period, different values (> threshold)
 *             from different sources (survey vs document, two documents …).
 *             Different periods are never a conflict: «survey 2026 = 10 M,
 *             P&L 2025 = 14 M» is history, not a contradiction. A value
 *             rescaled from another span (month × 12) is compared only when
 *             the period has no value of its own span (seasonality is not a
 *             contradiction).
 *   invalid   values outside the metric's plausible range (one per period)
 *   anomaly   values far off the metric's own history (one per period)
 *
 * A manual value (the owner / an expert decided) settles its period — until
 * the other sources of that period change: then «ручное значение против новых
 * данных» is a conflict again. Pure — persistence is lib/data-layer/sync.ts.
 */
import { getMetricById } from '@/lib/metrics/registry'
import { relativeDiff } from './normalize'
import { FACT_SOURCE_PRIORITY, type DiscrepancyCandidate, type DiscrepancyDraft, type DiscrepancyKind, type Fact } from './types'

export const DEFAULT_CONFLICT_THRESHOLD = 0.05

export interface ReconcileOptions {
  /** Relative difference above which values of one period conflict (default 5 %). */
  threshold?: (metricId: string) => number
}

function candidate(f: Fact): DiscrepancyCandidate {
  return { value: f.value, unit: f.unit, sourceKind: f.sourceKind, sourceRef: f.sourceRef, confidence: f.confidence, ...(f.note ? { note: f.note } : {}) }
}

function byPriority(a: Fact, b: Fact): number {
  return FACT_SOURCE_PRIORITY[b.sourceKind] - FACT_SOURCE_PRIORITY[a.sourceKind] || b.confidence - a.confidence
}

function label(metricId: string): string {
  return getMetricById(metricId)?.label ?? metricId
}

/** What a manual value was decided against: the other sources' values (order-insensitive). */
export function basisSignature(candidates: ReadonlyArray<Pick<DiscrepancyCandidate, 'sourceRef' | 'value' | 'sourceKind'>>): string {
  return candidates
    .filter((c) => c.sourceKind !== 'manual')
    .map((c) => `${c.sourceRef}=${Number(c.value)}`)
    .sort()
    .join('|')
}

/**
 * Several catalog metrics read the same inputs (biz «Выручка (год)» and kpi
 * «Общая выручка»): one discrepancy of the same values is reported once.
 */
function signature(d: DiscrepancyDraft): string {
  return [d.kind, d.periodKey, ...d.candidates.map((c) => `${c.sourceRef}=${c.value}`).sort()].join('|')
}

/** The facts of a period that are compared: valid, own-span values first. */
function comparable(group: readonly Fact[]): Fact[] {
  const valid = group.filter((f) => !f.flags.includes('invalid') && f.sourceKind !== 'manual')
  const own = valid.filter((f) => !f.flags.includes('rescaled'))
  return (own.length ? own : valid).sort(byPriority)
}

function flagged(metricId: string, periodKey: string, kind: Exclude<DiscrepancyKind, 'conflict'>, facts: Fact[]): DiscrepancyDraft | null {
  if (!facts.length) return null
  const sorted = [...facts].sort(byPriority)
  return {
    metricId, periodKey, kind, candidates: sorted.map(candidate),
    chosenValue: kind === 'invalid' ? null : sorted[0].value,
    detail: kind === 'invalid'
      ? `«${label(metricId)}»: ${sorted.map((f) => `${f.value} ${f.unit}`.trim()).join(', ')} — вне допустимого диапазона`
      : `«${label(metricId)}»: значение сильно отличается от других периодов`,
  }
}

export function reconcile(facts: readonly Fact[], opts: ReconcileOptions = {}): DiscrepancyDraft[] {
  const threshold = opts.threshold ?? (() => DEFAULT_CONFLICT_THRESHOLD)
  const groups = new Map<string, Fact[]>()
  for (const f of facts) {
    const k = `${f.metricId}|${f.periodKey}`
    const g = groups.get(k)
    if (g) g.push(f)
    else groups.set(k, [f])
  }

  const drafts: DiscrepancyDraft[] = []
  for (const group of groups.values()) {
    const { metricId, periodKey } = group[0]
    for (const d of [
      flagged(metricId, periodKey, 'invalid', group.filter((f) => f.flags.includes('invalid'))),
      flagged(metricId, periodKey, 'anomaly', group.filter((f) => f.flags.includes('anomaly') && !f.flags.includes('invalid'))),
    ]) if (d) drafts.push(d)

    if (periodKey === 'unknown') continue
    const others = comparable(group)
    const manual = group.find((f) => f.sourceKind === 'manual' && !f.flags.includes('invalid'))
    if (manual) {
      // Decided — unless the other sources changed since (a new P&L, a changed answer).
      const now = basisSignature(others.map(candidate))
      if (manual.basis == null || manual.basis === now || !others.length) continue
      if (others.every((f) => relativeDiff(f.value, manual.value) <= threshold(metricId))) continue
      drafts.push({
        metricId, periodKey, kind: 'conflict', candidates: [candidate(manual), ...others.map(candidate)], chosenValue: manual.value,
        detail: `«${label(metricId)}»: подтверждённое вручную значение расходится с новыми данными`,
      })
      continue
    }
    if (others.length < 2) continue
    const values = others.map((f) => f.value)
    if (relativeDiff(Math.max(...values), Math.min(...values)) <= threshold(metricId)) continue
    drafts.push({
      metricId, periodKey, kind: 'conflict', candidates: others.map(candidate), chosenValue: others[0].value,
      detail: `«${label(metricId)}»: источники дают разные значения за один период`,
    })
  }

  const seen = new Set<string>()
  return drafts.filter((d) => {
    const s = signature(d)
    if (seen.has(s)) return false
    seen.add(s)
    return true
  })
}
