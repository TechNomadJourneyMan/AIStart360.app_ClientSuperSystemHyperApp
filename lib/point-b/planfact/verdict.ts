/**
 * lib/point-b/planfact/verdict.ts — «на курсе / риск / отстаём / нет данных» by the key KPIs of the plan (spec §13).
 * Pure.
 *
 * Every KPI is «more is better». The shortfall is (planned − actual) / |planned| in percent:
 *   shortfall ≤ onTrackPct              → on_track   (a fact above the plan is a negative shortfall)
 *   onTrackPct < shortfall ≤ riskPct    → risk
 *   shortfall > riskPct                 → behind
 *   no fact, no plan or a zero plan     → no_data   (never «отстаём» or «на курсе» from nothing)
 * The overall verdict is the WORST of the KPIs that have data; without any — no_data. The reason names the worst
 * ones (at most two) with their numbers: «конверсия 11% при плане 13%».
 */
import { fmtKpi, KPI_META, periodIn } from './kpis'
import type { KpiValues, KpiVerdictEntry, PlanFactVerdict, PlanKpi, Tolerances } from './types'

const EPS = 1e-9
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

const RANK: Record<PlanFactVerdict, number> = { no_data: 0, on_track: 1, risk: 2, behind: 3 }

export const VERDICT_LABEL: Record<PlanFactVerdict, string> = {
  on_track: 'На курсе',
  risk: 'Риск',
  behind: 'Отстаём',
  no_data: 'Нет данных',
}

/** Valid tolerances: 0 ≤ on track < risk; anything else → the defaults 5 / 15. */
export function normalizeTolerances(raw: { onTrackPct?: unknown; riskPct?: unknown; on_track_pct?: unknown; risk_pct?: unknown } | null | undefined): Tolerances {
  const on = Number(raw?.onTrackPct ?? raw?.on_track_pct)
  const risk = Number(raw?.riskPct ?? raw?.risk_pct)
  if (finite(on) && finite(risk) && on >= 0 && risk > on && risk < 100) return { onTrackPct: on, riskPct: risk }
  return { onTrackPct: 5, riskPct: 15 }
}

export function kpiVerdict(kpi: PlanKpi, planned: number | null | undefined, actual: number | null | undefined, tol: Tolerances): KpiVerdictEntry {
  const p = finite(planned) ? planned : null
  const a = finite(actual) ? actual : null
  const short = KPI_META[kpi].short
  if (a === null) return { kpi, verdict: 'no_data', planned: p, actual: null, shortfallPct: null, reason: `${short}: нет факта за месяц` }
  if (p === null || Math.abs(p) < EPS) return { kpi, verdict: 'no_data', planned: p, actual: a, shortfallPct: null, reason: `${short}: в плане нет значения на этот месяц` }
  const shortfallPct = ((p - a) / Math.abs(p)) * 100
  const verdict: PlanFactVerdict = shortfallPct <= tol.onTrackPct + EPS ? 'on_track' : shortfallPct <= tol.riskPct + EPS ? 'risk' : 'behind'
  return { kpi, verdict, planned: p, actual: a, shortfallPct: Math.round(shortfallPct * 10) / 10, reason: `${short} ${fmtKpi(kpi, a)} при плане ${fmtKpi(kpi, p)}` }
}

export function kpiVerdicts(kpis: readonly PlanKpi[], planned: KpiValues, actual: KpiValues, tol: Tolerances): Partial<Record<PlanKpi, KpiVerdictEntry>> {
  const out: Partial<Record<PlanKpi, KpiVerdictEntry>> = {}
  for (const k of kpis) out[k] = kpiVerdict(k, planned[k], actual[k], tol)
  return out
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function overallVerdict(entries: Partial<Record<PlanKpi, KpiVerdictEntry>>, period: string): { overall: PlanFactVerdict; reason: string } {
  const list = Object.values(entries).filter((e): e is KpiVerdictEntry => !!e)
  const withData = list.filter((e) => e.verdict !== 'no_data')
  if (!withData.length) {
    const noFact = list.length > 0 && list.every((e) => e.actual === null)
    return {
      overall: 'no_data',
      reason: list.length === 0
        ? 'В одобренном плане нет показателей, которые можно сверить по месяцам.'
        : noFact
          ? `Нет фактов ${periodIn(period)} — внесите «Факт за месяц», и мы сравним его с планом.`
          : `Нет данных, чтобы сравнить факт ${periodIn(period)} с планом.`,
    }
  }
  const worst = withData.reduce((w, e) => (RANK[e.verdict] > RANK[w.verdict] ? e : w), withData[0])
  if (worst.verdict === 'on_track') {
    return { overall: 'on_track', reason: `${capital(withData.map((e) => e.reason).slice(0, 2).join('; '))} — в пределах плана.` }
  }
  const bad = withData
    .filter((e) => e.verdict === 'behind' || e.verdict === 'risk')
    .sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || (b.shortfallPct ?? 0) - (a.shortfallPct ?? 0))
    .slice(0, 2)
  return { overall: worst.verdict, reason: `${capital(bad.map((e) => e.reason).join('; '))}.` }
}
