/**
 * lib/point-b/report.ts — ONE calculation of Point B for every consumer outside the page (R3, M3; spec §18): the PDF,
 * the share link «Поделиться», the AI chat / assistant and the staff tabs (GIGA, expert). It is the client page's own
 * state (lib/point-b/model/load.ts loadPointBState: the model + the APPROVED plan version only) put into a compact,
 * render-ready shape — never the old V2 engine (lib/point-b/engine.ts, kept until the PO removes it), never a draft.
 *
 *   pointBReportFrom(state)   pure: the state → the report (numbers as the model computed them, no rounding here)
 *   loadPointBReport(sb, …)   the client's state → the report (service-role client; the caller authorises)
 *
 * What a report says: the automatic preliminary calculation (verdict, А → Б, forecast — labelled «автоматический
 * расчёт»), what data is missing, and the approved plan if there is one (pace, the three scenarios, the strategy with
 * its initiatives, milestones, the expert-verified recommendations). Before the approval the plan part is empty and
 * `plan.prep` says where it honestly stands.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fmtMoney, fmtMonths, fmtPct, fmtTimes } from './model/format'
import { loadPointBState } from './model/load'
import type { ModelResult, PointBState, VerdictKey } from './model/types'
import type { PlanPrepKind } from './plan/waiting'

export interface PointBReportScenario {
  key: string
  label: string
  selected: boolean
  feasible: boolean
  infeasibleReason: string | null
  /** Months to the goal (base of the range). */
  timeToGoalMonths: number | null
  /** Annual run-rate at the goal's deadline (base of the range). */
  revenueAtDeadline: number | null
  /** What the pace asks of each lever (current → target; conversion and repeat as fractions, growth as a fraction). */
  levers: Array<{ lever: string; label: string; current: number | null; target: number | null; upliftPct: number | null }>
}

export interface PointBReport {
  computedAt: string
  level: ModelResult['level']
  kind: ModelResult['kind']
  /** Always: the verdict, the gap and the forecast are the automatic preliminary calculation. */
  automatic: true
  verdict: { key: VerdictKey; headline: string; reason: string }
  gap: { baseAnnual: number | null; targetAnnual: number | null; absolute: number | null; multiplier: number | null; requiredCagrPct: number | null; months: number | null }
  forecast: { atCurrentPace: number | null; trendMonthlyPct: number | null; basis: 'history' | 'insufficient' }
  /** Labels of what the calculation lacks. */
  missing: string[]
  plan: {
    status: PointBState['plan']['status']
    prep: PlanPrepKind
    /** needs_data: what the plan needs (labels), the list the PDF / share link print (review L7). */
    prepMissing: string[]
    version: number | null
    approvedAt: string | null
    authorName: string | null
    selectedScenario: string | null
    scenarios: PointBReportScenario[]
    strategy: Array<{ title: string; description: string | null; initiatives: string[]; tasks: number }>
    milestones: Array<{ title: string; date: string }>
  }
  recommendations: Array<{ title: string; kind: string; nextAction: string | null }>
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const numOrNull = (n: unknown): number | null => (finite(n) ? n : null)

export function pointBReportFrom(state: PointBState): PointBReport {
  const r = state.overview.result
  const plan = state.plan
  const items = plan.strategy?.items ?? []
  const children = (key: string, kind: 'initiative' | 'task') => items.filter((n) => n.parentKey === key && n.kind === kind)
  const strategy = items
    .filter((n) => n.kind === 'strategy')
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const initiatives = children(s.key, 'initiative').sort((a, b) => a.order - b.order)
      return {
        title: s.title,
        description: s.description,
        initiatives: initiatives.map((i) => i.title),
        tasks: initiatives.reduce((n, i) => n + children(i.key, 'task').length, 0),
      }
    })
  return {
    computedAt: r.computedAt,
    level: r.level,
    kind: r.kind,
    automatic: true,
    verdict: { key: r.verdict.key, headline: r.verdict.headline, reason: r.verdict.reason },
    gap: {
      baseAnnual: numOrNull(r.gap.baseAnnual), targetAnnual: numOrNull(r.gap.targetAnnual), absolute: numOrNull(r.gap.absolute),
      multiplier: numOrNull(r.gap.multiplier), requiredCagrPct: numOrNull(r.gap.requiredCagrPct), months: numOrNull(r.gap.months),
    },
    forecast: { atCurrentPace: numOrNull(r.forecast.atCurrentPace.base), trendMonthlyPct: numOrNull(r.forecast.trendMonthlyPct), basis: r.forecast.basis },
    missing: r.missing.map((m) => m.label),
    plan: {
      status: plan.status,
      prep: plan.prep?.kind ?? (plan.status === 'published' ? 'published' : 'needs_data'),
      prepMissing: plan.prep?.kind === 'needs_data' ? plan.prep.missing.map((m) => m.label) : [],
      version: plan.version,
      approvedAt: plan.approvedAt,
      authorName: plan.authorName,
      selectedScenario: plan.selectedScenario,
      scenarios: plan.scenarios.map((s) => ({
        key: s.key,
        label: s.label,
        selected: s.key === plan.selectedScenario,
        feasible: s.feasible,
        infeasibleReason: s.infeasibleReason,
        timeToGoalMonths: numOrNull(s.timeToGoalMonths.base),
        revenueAtDeadline: numOrNull(s.revenueAtDeadline.base),
        levers: (s.requiredUplift ?? []).map((u) => ({
          lever: u.lever, label: u.label, current: numOrNull(u.current), target: numOrNull(u.target), upliftPct: numOrNull(u.upliftPct),
        })),
      })),
      strategy,
      milestones: (plan.strategy?.milestones ?? []).map((m) => ({ title: m.title, date: m.date })).sort((a, b) => a.date.localeCompare(b.date)),
    },
    recommendations: state.recommendations.verified
      .filter((x) => x.state === 'verified')
      .map((x) => ({ title: x.title, kind: x.kind, nextAction: x.nextAction ?? null })),
  }
}

/** `companyId`: the company the caller means (PDF / share of the chosen company, the chat's tenant) — only one of the user's own. */
export async function loadPointBReport(sb: SupabaseClient, userId: string, opts: { now?: Date; companyId?: string | null } = {}): Promise<PointBReport> {
  return pointBReportFrom(await loadPointBState(sb, userId, opts))
}

const PREP_TEXT: Record<PlanPrepKind, string> = {
  published: 'План одобрен',
  in_work: 'План готовит команда AIStart360',
  in_review: 'План на проверке перед публикацией',
  waiting: 'Данных для плана достаточно — план подготовит команда AIStart360',
  needs_data: 'Для плана нужны данные',
}

/** The plain-text summary (the chat / assistant tool): numbers as the page writes them. */
export function pointBReportText(r: PointBReport): string {
  const lines: string[] = []
  lines.push(`Автоматический расчёт Точки Б (не проверен экспертом), уровень данных ${r.level}.`)
  lines.push(`Вердикт: ${r.verdict.headline}. ${r.verdict.reason}`)
  if (finite(r.gap.baseAnnual) || finite(r.gap.targetAnnual)) {
    lines.push(`Выручка сейчас: ${fmtMoney(r.gap.baseAnnual)} в год; цель: ${fmtMoney(r.gap.targetAnnual)} в год${finite(r.gap.months) ? ` через ${fmtMonths(r.gap.months)}` : ''}${finite(r.gap.multiplier) ? ` (${fmtTimes(r.gap.multiplier)})` : ''}.`)
  }
  if (finite(r.forecast.atCurrentPace)) lines.push(`При текущем ходе к сроку: ${fmtMoney(r.forecast.atCurrentPace)} в год.`)
  if (r.missing.length) lines.push(`Не хватает данных: ${r.missing.join(', ')}.`)
  if (r.plan.status === 'published') {
    lines.push(`План v${r.plan.version ?? '?'} одобрен${r.plan.approvedAt ? ` ${r.plan.approvedAt.slice(0, 10)}` : ''}.`)
    const sel = r.plan.scenarios.find((s) => s.selected)
    for (const s of r.plan.scenarios) {
      lines.push(`- Сценарий «${s.label}»${s.selected ? ' (выбран)' : ''}: ${s.feasible ? `срок ${fmtMonths(s.timeToGoalMonths)}, выручка к сроку ${fmtMoney(s.revenueAtDeadline)} в год` : `не достижим${s.infeasibleReason ? ` — ${s.infeasibleReason}` : ''}`}.`)
    }
    if (!sel && r.plan.scenarios.length) lines.push('Темп плана не выбран.')
    for (const s of r.plan.strategy) lines.push(`- Стратегия: ${s.title}${s.initiatives.length ? ` (инициативы: ${s.initiatives.join('; ')})` : ''}.`)
    for (const rec of r.recommendations) lines.push(`- Рекомендация (проверена): ${rec.title}${rec.nextAction ? ` — следующий шаг: ${rec.nextAction}` : ''}.`)
  } else {
    lines.push(`План: ${PREP_TEXT[r.plan.prep]}${r.plan.prepMissing.length ? `: ${r.plan.prepMissing.join(', ')}` : ''}.`)
  }
  if (finite(r.forecast.trendMonthlyPct)) lines.push(`Тренд выручки: ${fmtPct(r.forecast.trendMonthlyPct / 100, 1)} в месяц.`)
  return lines.join('\n')
}
