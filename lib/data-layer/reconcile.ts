/**
 * lib/data-layer/reconcile.ts — discrepancies between sources (spec §1.5).
 *
 *   conflict  the same metric, the SAME period, different values (> threshold)
 *             from different sources (survey vs document, two documents …).
 *             Different periods are never a conflict: «survey 2026 = 10 M,
 *             P&L 2025 = 14 M» is history, not a contradiction.
 *   invalid   a value outside the metric's plausible range
 *   anomaly   a value far off the metric's own history
 *
 * A period with a manual value (the owner / an expert already decided) has no
 * conflict. Pure — persistence is lib/data-layer/sync.ts.
 */
import { getMetricById } from '@/lib/metrics/registry'
import { relativeDiff } from './normalize'
import { FACT_SOURCE_PRIORITY, type DiscrepancyCandidate, type DiscrepancyDraft, type Fact } from './types'

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

/**
 * Several catalog metrics read the same inputs (biz «Выручка (год)» and kpi
 * «Общая выручка»): one discrepancy of the same values is reported once.
 */
function signature(d: DiscrepancyDraft): string {
  return [d.kind, d.periodKey, ...d.candidates.map((c) => `${c.sourceRef}=${c.value}`).sort()].join('|')
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
    for (const f of group) {
      if (f.flags.includes('invalid')) {
        drafts.push({
          metricId, periodKey, kind: 'invalid', candidates: [candidate(f)], chosenValue: null,
          detail: `«${label(metricId)}»: значение ${f.value} ${f.unit} вне допустимого диапазона`,
        })
      } else if (f.flags.includes('anomaly')) {
        drafts.push({
          metricId, periodKey, kind: 'anomaly', candidates: [candidate(f)], chosenValue: f.value,
          detail: `«${label(metricId)}»: значение сильно отличается от других периодов`,
        })
      }
    }
    if (periodKey === 'unknown') continue
    const valid = group.filter((f) => !f.flags.includes('invalid')).sort(byPriority)
    if (valid.length < 2 || valid.some((f) => f.sourceKind === 'manual')) continue
    const values = valid.map((f) => f.value)
    const max = Math.max(...values)
    const min = Math.min(...values)
    if (relativeDiff(max, min) <= threshold(metricId)) continue
    drafts.push({
      metricId, periodKey, kind: 'conflict', candidates: valid.map(candidate), chosenValue: valid[0].value,
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
