/**
 * lib/data-layer/normalize.ts — clean-up of collected facts (spec §1.3):
 *
 *   dedupeFacts     the same value for the same period from several sources is
 *                   ONE fact confirmed by all of them (confidence up)
 *   flagAnomalies   a value far off the metric's own history is flagged
 *                   (confidence down) — it does not block the calculation
 *   applyFreshness  a current-situation answer not updated for months loses
 *                   confidence; a past period never goes stale
 *
 * Units, periods (month ↔ year) and plausibility are already handled when
 * facts are collected (lib/metrics/source-adapters.ts, lib/data-layer/facts.ts).
 */
import { FACT_SOURCE_PRIORITY, type Fact } from './types'

/** Two values within this relative distance are the same value. */
export const SAME_VALUE_TOLERANCE = 0.005

export function relativeDiff(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale === 0 ? 0 : Math.abs(a - b) / scale
}

function byPriority(a: Fact, b: Fact): number {
  return FACT_SOURCE_PRIORITY[b.sourceKind] - FACT_SOURCE_PRIORITY[a.sourceKind] || b.confidence - a.confidence
}

function groupKey(f: Fact): string {
  return `${f.metricId}|${f.periodKey}`
}

export function dedupeFacts(facts: readonly Fact[]): Fact[] {
  const groups = new Map<string, Fact[]>()
  for (const f of facts) {
    const k = groupKey(f)
    const g = groups.get(k)
    if (g) g.push(f)
    else groups.set(k, [f])
  }
  const out: Fact[] = []
  for (const [key, group] of groups) {
    if (key.endsWith('|unknown')) {
      out.push(...group)
      continue
    }
    const valid = group.filter((f) => !f.flags.includes('invalid')).sort(byPriority)
    out.push(...group.filter((f) => f.flags.includes('invalid')))
    const merged: Fact[] = []
    for (const f of valid) {
      const same = merged.find((m) => relativeDiff(m.value, f.value) <= SAME_VALUE_TOLERANCE)
      if (!same) {
        merged.push({ ...f, sourceRefs: [...f.sourceRefs], flags: [...f.flags] })
        continue
      }
      same.sourceRefs.push(...f.sourceRefs)
      same.confidence = Math.round(Math.min(1, Math.max(same.confidence, f.confidence) + 0.1) * 1000) / 1000
      if (!same.flags.includes('confirmed')) same.flags.push('confirmed')
    }
    out.push(...merged)
  }
  return out
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * A value of a metric is anomalous against the other periods of the same
 * metric: robust z-score (0.6745·|x − median| / MAD) > 3.5 with ≥ 4 values;
 * with 3 — more than 3× off the median; fewer periods are never judged. Year-to-date and unknown
 * periods, rescaled and invalid values are not part of the series.
 */
export function flagAnomalies(facts: readonly Fact[]): Fact[] {
  const series = new Map<string, Fact[]>()
  for (const f of facts) {
    if (!f.period || f.period.ytd || f.flags.includes('invalid')) continue
    // Only full years are comparable with each other without seasonality.
    if (f.period.month || f.period.quarter) continue
    const g = series.get(f.metricId)
    if (g) g.push(f)
    else series.set(f.metricId, [f])
  }
  const anomalous = new Set<Fact>()
  for (const group of series.values()) {
    // Two periods cannot tell which one is off: at least three are needed.
    if (new Set(group.map((f) => f.periodKey)).size < 3) continue
    const values = group.map((f) => f.value)
    const med = median(values)
    const mad = median(values.map((x) => Math.abs(x - med)))
    for (const f of group) {
      if (group.length >= 4) {
        if (mad > 0 && (0.6745 * Math.abs(f.value - med)) / mad > 3.5) anomalous.add(f)
      } else if (med > 0 && f.value > 0 && (f.value / med > 3 || f.value / med < 1 / 3)) {
        anomalous.add(f)
      }
    }
  }
  return facts.map((f) =>
    anomalous.has(f) && !f.flags.includes('anomaly')
      ? { ...f, flags: [...f.flags, 'anomaly'], confidence: Math.round(f.confidence * 0.7 * 1000) / 1000 }
      : f,
  )
}

/** A current-situation survey answer older than `staleMonths` is stale. */
export function applyFreshness(facts: readonly Fact[], now: Date, staleMonths = 6): Fact[] {
  const limit = now.getTime() - staleMonths * 30.44 * 24 * 3600 * 1000
  return facts.map((f) => {
    if (!f.current || !f.observedAt || f.flags.includes('stale')) return f
    const t = Date.parse(f.observedAt)
    if (!Number.isFinite(t) || t >= limit) return f
    return { ...f, flags: [...f.flags, 'stale'], confidence: Math.round(f.confidence * 0.8 * 1000) / 1000 }
  })
}

export function normalizeFacts(facts: readonly Fact[], now: Date): Fact[] {
  return applyFreshness(flagAnomalies(dedupeFacts(facts)), now)
}
