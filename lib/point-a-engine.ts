// lib/point-a-engine.ts
// Point A Diagnostic Calculation Engine — rule-based v1
// Weights: Finance 30% | Sales 25% | Operations 20% | Marketing 15% | Strategy 10%
//
// REBASED 2026-10 on the current 12-step wizard (docs/platform D9):
//  • Every block is a list of checks with a maximum. Block score =
//    earned / possible × 100, where `possible` counts only the checks whose
//    input the platform can collect. A check whose input no wizard question,
//    legacy answer or resolved metric can supply (today: «программа
//    лояльности») is EXCLUDED from the denominator instead of capping the
//    block. Before the rebase every block was additive with a hidden ceiling
//    (finance 85, sales 80, operations 80, marketing 70, strategy 60), so even
//    a perfect questionnaire could not reach «excellent» in most blocks.
//  • Legacy keys the wizard no longer writes (s2_ltv, s2_cac, s2_revenue_2023,
//    s2_revenue_2025, s2_new/repeat_clients_2024) are still read first; when
//    absent they come from the current wizard — mostly the step-8 metrics
//    table (s8n_metrics_table: «Сумма продаж», «CAC», «LTV», «Кол-во новых /
//    повторных продаж») — or from resolved metric values (second argument).
//  • An unanswered question earns 0 and says «не указано» (it never earns
//    points by default, as the old debt / deal-cycle / refusal checks did).
//  • Text answers are scored by PRESENCE only where presence is the actual
//    criterion (an ICP / USP / main pain is named at all). Criteria that are
//    numeric by nature (a measurable goal) require a number — the old
//    «answer longer than 20 characters» rewards are gone.

import type {
  PointA, BlockScore, BlockStatus, DiagnosticStage,
  Risk, Insight, QuickWin, DataGap
} from '@/types/onboarding'
import { coerceNumeric, parsePercentChange } from '@/lib/metrics/source-adapters'
import { metricsTableCell, readMetricsTable, type MetricsTable, type MetricsTableColumnPick, type MetricsTableRow } from '@/lib/survey/metrics-table'

/**
 * Values resolved outside the questionnaire (documents, manual entries, CRM —
 * e.g. public.metrics rows). When present they are used BEFORE survey answers.
 */
export interface PointAResolvedInputs {
  ltv?: number | null
  cac?: number | null
  ltvCacRatio?: number | null
  /** Margin in percent. */
  grossMargin?: number | null
  revenue?: Partial<Record<2023 | 2024 | 2025, number | null>>
}

/** Engine identity, recorded with findings derived from this output. */
export const POINT_A_ENGINE = 'engine:point_a_v1'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v))
}

function present(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

const NO_ANSWER_RE = /^(нет|no|none|-|—|отсутствует|не\s*используем|не\s*используется)$/i
const UNKNOWN_RE = /^(нет|no|none|-|—|не\s*знаю|не\s*считали|неизвестно|не\s*рассчитывали)$/i

/** A text answer that names something (not blank, not «нет»). Presence is the criterion. */
function namesSomething(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '' && !NO_ANSWER_RE.test(v.trim())
}

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Numeric answer of `key`, or null when not answered / not numeric. */
function numAnswer(a: Record<string, unknown>, key: string): number | null {
  if (!present(a[key])) return null
  const n = coerceNumeric(a[key])
  return finite(n) ? n : null
}

/**
 * First alias that holds a finite non-zero number; an explicit 0 only when no
 * alias holds anything else; null when none was answered.
 */
function firstNumber(a: Record<string, unknown>, keys: string[]): number | null {
  let zero: number | null = null
  for (const k of keys) {
    const n = numAnswer(a, k)
    if (n === null) continue
    if (n !== 0) return n
    zero = 0
  }
  return zero
}

/** First non-empty string across `keys` (e.g. for goal text). */
function readStringAlias(a: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = a[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

function statusFromScore(score: number): BlockStatus {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'strong'
  if (score >= 50) return 'average'
  if (score >= 30) return 'weak'
  return 'critical'
}

function stageFromScore(score: number): DiagnosticStage {
  if (score >= 80) return 'scale'
  if (score >= 65) return 'growth'
  if (score >= 45) return 'early'
  if (score >= 25) return 'seed'
  return 'seed'
}

// ─── Inputs (legacy key → current wizard → resolved metric) ──────────────────

interface Inputs {
  a: Record<string, unknown>
  table: MetricsTable
  resolved: PointAResolvedInputs
}

function tableValue(inp: Inputs, row: MetricsTableRow, column: MetricsTableColumnPick): number | null {
  return metricsTableCell(inp.table, row, column)?.value ?? null
}

/**
 * Annual revenue for `year`.
 *  2023 → resolved · s2_revenue_2023 · metrics table «Сумма продаж» 2023
 *  2024 → resolved · s2_revenue_2024 · s9n_revenue_2024 · table 2024
 *  2025 → resolved · s2_revenue_2025 · table 2025 · s1_current_revenue_year
 *         (current annual run-rate from step 1 — the latest year we can know)
 * Percentage-change strings («±15%») are never read as revenue.
 */
function revenue(inp: Inputs, year: 2023 | 2024 | 2025): number | null {
  const r = inp.resolved.revenue?.[year]
  if (finite(r) && r > 0) return r
  const col = year === 2023 ? 'y2023' : year === 2024 ? 'y2024' : 'y2025'
  const legacy =
    year === 2023 ? firstNumber(inp.a, ['s2_revenue_2023'])
    : year === 2024 ? firstNumber(inp.a, ['s2_revenue_2024', 's9n_revenue_2024'])
    : firstNumber(inp.a, ['s2_revenue_2025'])
  if (legacy !== null && legacy !== 0) return legacy
  const fromTable = tableValue(inp, 'sales_amount', col)
  if (fromTable !== null) return fromTable
  if (year === 2025) {
    const runRate = firstNumber(inp.a, ['s1_current_revenue_year'])
    if (runRate !== null && runRate !== 0) return runRate
  }
  return legacy // 0 when explicitly answered 0, else null
}

/** 12-month goal text from legacy + current goal-step keys. */
function readGoal12m(a: Record<string, unknown>): string {
  return readStringAlias(a, ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics'])
}

/** 3-year goal text from legacy + current goal-step keys. */
function readGoal3y(a: Record<string, unknown>): string {
  return readStringAlias(a, ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics'])
}

/**
 * A goal is measurable when it carries a number: a revenue target from step 1
 * or digits in the goal / goal-metrics text. (Numeric criterion — the length
 * of the text is irrelevant.)
 */
function goalState(a: Record<string, unknown>, horizon: '12m' | '3y'): 'measurable' | 'text_only' | 'missing' {
  const targetKeys = horizon === '12m'
    ? ['s1_goal_12m_revenue_year', 's1_goal_12m_revenue_month']
    : ['s1_goal_3y_revenue_year', 's1_goal_3y_revenue_month']
  const hasTarget = targetKeys.some((k) => (numAnswer(a, k) ?? 0) > 0)
  const texts = horizon === '12m'
    ? ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics']
    : ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics']
  const named = texts.filter((k) => namesSomething(a[k]))
  if (hasTarget || named.some((k) => /\d/.test(String(a[k])))) return 'measurable'
  return named.length > 0 ? 'text_only' : 'missing'
}

function ltvCac(inp: Inputs): { ltv: number | null; cac: number | null; ratio: number | null } {
  const pick = (resolved: number | null | undefined, legacyKey: string, row: MetricsTableRow): number | null => {
    if (finite(resolved) && resolved > 0) return resolved
    const legacy = numAnswer(inp.a, legacyKey)
    if (legacy !== null && legacy > 0) return legacy
    return tableValue(inp, row, 'latest')
  }
  const ltv = pick(inp.resolved.ltv, 's2_ltv', 'ltv')
  const cac = pick(inp.resolved.cac, 's2_cac', 'cac')
  let ratio: number | null = null
  if (ltv !== null && cac !== null && ltv > 0 && cac > 0) ratio = ltv / cac
  else if (finite(inp.resolved.ltvCacRatio) && inp.resolved.ltvCacRatio > 0) ratio = inp.resolved.ltvCacRatio
  else ratio = tableValue(inp, 'ltv_cac', 'latest')
  return { ltv, cac, ratio }
}

/** New vs repeat sales of one year: legacy client counts, else the step-8 table (counts of sales). */
function newVsRepeat(inp: Inputs): { newCount: number; repeatCount: number } | null {
  const ln = numAnswer(inp.a, 's2_new_clients_2024')
  const lr = numAnswer(inp.a, 's2_repeat_clients_2024')
  if ((ln ?? 0) + (lr ?? 0) > 0) return { newCount: ln ?? 0, repeatCount: lr ?? 0 }
  for (const col of ['y2024', 'y2025'] as const) {
    const n = tableValue(inp, 'new_sales_count', col)
    const r = tableValue(inp, 'repeat_count', col)
    if ((n ?? 0) + (r ?? 0) > 0 && n !== null && r !== null) return { newCount: n, repeatCount: r }
  }
  return null
}

function knowsBreakeven(a: Record<string, unknown>): boolean | null {
  if (present(a.s2_knows_breakeven)) return Boolean(a.s2_knows_breakeven) && a.s2_knows_breakeven !== 'false'
  const be = a.s9n_breakeven_point
  if (!present(be)) return null
  if (typeof be === 'number') return be > 0
  return !UNKNOWN_RE.test(String(be).trim())
}

/** Debt load: legacy choice, else s9n_debts_amount (≥ 50% of annual revenue = high). */
function debtLoad(inp: Inputs): 'none' | 'moderate' | 'high' | null {
  if (present(inp.a.s2_debt_load)) {
    const d = String(inp.a.s2_debt_load)
    return d === 'none' || d === 'moderate' ? d : 'high'
  }
  const debts = numAnswer(inp.a, 's9n_debts_amount')
  if (debts === null) return null
  if (debts <= 0) return 'none'
  const rev = revenue(inp, 2024) ?? revenue(inp, 2025)
  if (rev !== null && rev > 0 && debts >= rev * 0.5) return 'high'
  return 'moderate'
}

function crmState(a: Record<string, unknown>): 'yes' | 'none' | null {
  const v = a.s3_has_crm // already aliased from s12_crm_tool by withCurrentAliases
  if (!present(v)) return null
  const s = String(v).trim()
  return s === 'none' || NO_ANSWER_RE.test(s) ? 'none' : 'yes'
}

function channelCount(a: Record<string, unknown>): number | null {
  if (Array.isArray(a.s5_marketing_channels)) {
    const n = a.s5_marketing_channels.filter((x) => typeof x === 'string' && x.trim() !== '').length
    if (n > 0) return n
  }
  if (namesSomething(a.s3_promo_channels)) {
    return String(a.s3_promo_channels).split(/[,;\n/]+/).map((x) => x.trim()).filter(Boolean).length
  }
  return Array.isArray(a.s5_marketing_channels) ? 0 : null
}

function staffingTableHasKpi(a: Record<string, unknown>): boolean {
  const rows = a.s4n_staffing_table
  return Array.isArray(rows) && rows.some((r) => r && typeof r === 'object' && namesSomething((r as Record<string, unknown>).kpi))
}

// ─── Checks → block ──────────────────────────────────────────────────────────

interface Check {
  id: string
  max: number
  earned: number
  /** Input cannot be collected today (no wizard question, legacy answer or resolved value). */
  excluded?: boolean
  /** Weakness found in the answer. */
  issue?: string
  /** The question was not answered. Listed after real issues. */
  missing?: string
  rec?: string
}

function toBlock(checks: Check[]): BlockScore {
  const included = checks.filter((c) => !c.excluded)
  const possible = included.reduce((s, c) => s + c.max, 0)
  const earned = included.reduce((s, c) => s + c.earned, 0)
  const score = possible > 0 ? Math.round(clamp((earned / possible) * 100)) : 0
  const issues = [
    ...included.filter((c) => c.issue).map((c) => c.issue as string),
    ...included.filter((c) => c.missing).map((c) => c.missing as string),
  ]
  const recs = included.filter((c) => c.rec).map((c) => c.rec as string)
  return {
    score,
    status: statusFromScore(score),
    top_issues: issues.slice(0, 3),
    recommendations: recs.slice(0, 3),
    earned,
    possible,
    excluded_checks: checks.filter((c) => c.excluded).map((c) => c.id),
  }
}

/** Loyalty programme: no wizard question — scored only when a legacy answer exists. */
function loyaltyCheck(a: Record<string, unknown>, rec: string): Check {
  if (!present(a.s3_has_loyalty)) return { id: 'loyalty', max: 10, earned: 0, excluded: true }
  return Boolean(a.s3_has_loyalty)
    ? { id: 'loyalty', max: 10, earned: 10 }
    : { id: 'loyalty', max: 10, earned: 0, rec }
}

// ─── Finance Block (weight 30%) ───────────────────────────────────────────────

function scoreFinance(inp: Inputs): BlockScore {
  const { a } = inp
  const checks: Check[] = []

  // Revenue growth YoY — two absolute years, else the declared % change vs 2023.
  const rev23 = revenue(inp, 2023)
  const rev24 = revenue(inp, 2024)
  const changeVs2023 = parsePercentChange(a['s9n_change_vs_2023'])
  let growth: number | null = null
  if (rev24 !== null && rev24 > 0 && rev23 !== null && rev23 > 0) growth = ((rev24 - rev23) / rev23) * 100
  else if (rev24 !== null && rev24 > 0 && changeVs2023 !== null) growth = changeVs2023
  if (growth === null) checks.push({ id: 'growth', max: 20, earned: 0, missing: 'Нет данных по выручке за 2023/2024' })
  else if (growth > 20) checks.push({ id: 'growth', max: 20, earned: 20 })
  else if (growth > 0) checks.push({ id: 'growth', max: 20, earned: 10 })
  else checks.push({ id: 'growth', max: 20, earned: 0, issue: 'Выручка не растёт или падает', rec: 'Проанализировать причины стагнации выручки' })

  // Margin (net margin from step 9 is a conservative proxy for gross).
  const margin = finite(inp.resolved.grossMargin) ? inp.resolved.grossMargin : firstNumber(a, ['s2_gross_margin', 's9n_net_margin'])
  if (margin === null) checks.push({ id: 'margin', max: 15, earned: 0, missing: 'Маржинальность не указана', rec: 'Рассчитать маржинальность по каждому продукту' })
  else if (margin > 30) checks.push({ id: 'margin', max: 15, earned: 15 })
  else if (margin > 15) checks.push({ id: 'margin', max: 15, earned: 8 })
  else if (margin > 0) checks.push({ id: 'margin', max: 15, earned: 3, issue: 'Низкая маржинальность (<30%)' })
  else checks.push({ id: 'margin', max: 15, earned: 0, issue: 'Маржинальность нулевая или отрицательная', rec: 'Рассчитать маржинальность по каждому продукту' })

  // LTV/CAC — asked in the step-8 metrics table (rows «LTV», «CAC», «LTV:CAC»).
  const { ratio } = ltvCac(inp)
  if (ratio === null) checks.push({ id: 'ltv_cac', max: 15, earned: 0, missing: 'CAC или LTV не указаны' })
  else if (ratio >= 3) checks.push({ id: 'ltv_cac', max: 15, earned: 15 })
  else if (ratio >= 2) checks.push({ id: 'ltv_cac', max: 15, earned: 8, issue: `LTV/CAC = ${ratio.toFixed(1)} (норма ≥ 3)` })
  else checks.push({ id: 'ltv_cac', max: 15, earned: 0, issue: `LTV/CAC = ${ratio.toFixed(1)} — маркетинг убыточен`, rec: 'Снизить CAC или увеличить LTV через апсейл' })

  // Break-even known.
  const be = knowsBreakeven(a)
  checks.push(be
    ? { id: 'breakeven', max: 10, earned: 10 }
    : { id: 'breakeven', max: 10, earned: 0, issue: 'Точка безубыточности неизвестна', rec: 'Рассчитать точку безубыточности' })

  // Debt load.
  const debt = debtLoad(inp)
  if (debt === null) checks.push({ id: 'debt', max: 10, earned: 0, missing: 'Долговая нагрузка не указана' })
  else if (debt === 'none') checks.push({ id: 'debt', max: 10, earned: 10 })
  else if (debt === 'moderate') checks.push({ id: 'debt', max: 10, earned: 5 })
  else checks.push({ id: 'debt', max: 10, earned: 0, issue: 'Высокая долговая нагрузка', rec: 'Разработать план снижения долговой нагрузки' })

  // Revenue not declining in the latest year (2025 or current run-rate vs 2024).
  const rev25 = revenue(inp, 2025)
  if (rev25 !== null && rev25 > 0 && rev24 !== null && rev24 > 0) {
    checks.push(rev25 >= rev24
      ? { id: 'revenue_trend', max: 15, earned: 15 }
      : { id: 'revenue_trend', max: 15, earned: 0, issue: 'Снижение выручки в последнем году' })
  } else {
    checks.push({ id: 'revenue_trend', max: 15, earned: 0 })
  }

  return toBlock(checks)
}

// ─── Sales Block (weight 25%) ─────────────────────────────────────────────────

function scoreSales(inp: Inputs): BlockScore {
  const { a } = inp
  const checks: Check[] = []

  const crm = crmState(a)
  if (crm === 'yes') checks.push({ id: 'crm', max: 20, earned: 20 })
  else if (crm === 'none') checks.push({ id: 'crm', max: 20, earned: 0, issue: 'CRM-система отсутствует — потери лидов ~30%', rec: 'Внедрить amoCRM или Bitrix24 (базовый тариф)' })
  else checks.push({ id: 'crm', max: 20, earned: 0, missing: 'Не указано, есть ли CRM' })

  // Deal cycle (the form writes 0 for an empty field → 0 = not answered).
  const cycleDays = numAnswer(a, 's3_deal_cycle_days')
  if (cycleDays === null || cycleDays <= 0) checks.push({ id: 'deal_cycle', max: 15, earned: 0, missing: 'Цикл сделки не указан' })
  else if (cycleDays < 30) checks.push({ id: 'deal_cycle', max: 15, earned: 15 })
  else if (cycleDays <= 60) checks.push({ id: 'deal_cycle', max: 15, earned: 8 })
  else checks.push({ id: 'deal_cycle', max: 15, earned: 0, issue: `Длинный цикл сделки: ${cycleDays} дней`, rec: 'Декомпозировать воронку, найти точки торможения' })

  // Repeat share — legacy client counts, else step-8 «Кол-во новых / повторных продаж».
  const nr = newVsRepeat(inp)
  if (!nr) checks.push({ id: 'repeat_share', max: 15, earned: 0, missing: 'Нет данных о повторных продажах' })
  else {
    const repeatPct = (nr.repeatCount / (nr.newCount + nr.repeatCount)) * 100
    checks.push(repeatPct >= 30
      ? { id: 'repeat_share', max: 15, earned: 15 }
      : { id: 'repeat_share', max: 15, earned: 0, issue: `Повторных клиентов ${repeatPct.toFixed(0)}% (норма ≥30%)`, rec: 'Запустить программу лояльности' })
  }

  // Pipeline size and refusal rate (deals of 2024; table «Количество продаж» as fallback).
  const deals = numAnswer(a, 's3_deals_2024') || tableValue(inp, 'sales_count', 'y2024')
  if (!deals || deals <= 0) checks.push({ id: 'pipeline', max: 10, earned: 0, missing: 'Количество сделок не указано' })
  else if (deals > 50) checks.push({ id: 'pipeline', max: 10, earned: 10 })
  else if (deals > 20) checks.push({ id: 'pipeline', max: 10, earned: 5 })
  else checks.push({ id: 'pipeline', max: 10, earned: 0, issue: 'Маленькая воронка продаж' })

  const rejections = numAnswer(a, 's3_rejections_2024')
  if (!deals || deals <= 0 || rejections === null || rejections < 0) {
    checks.push({ id: 'refusals', max: 10, earned: 0, missing: 'Количество отказов не указано' })
  } else {
    const refusalPct = (rejections / (deals + rejections)) * 100
    checks.push(refusalPct < 20
      ? { id: 'refusals', max: 10, earned: 10 }
      : { id: 'refusals', max: 10, earned: 0, issue: `Высокий процент отказов: ${refusalPct.toFixed(0)}%`, rec: 'Провести анализ причин отказов, переработать pitch' })
  }

  checks.push(loyaltyCheck(a, 'Запустить NPS-опрос и программу лояльности'))
  return toBlock(checks)
}

// ─── Operations Block (weight 20%) ───────────────────────────────────────────

function scoreOperations(inp: Inputs): BlockScore {
  const { a } = inp
  const checks: Check[] = []

  // Yes/no toggles default to «нет» in the form, so an absent toggle reads as «нет».
  checks.push(Boolean(a.s4_has_org_chart)
    ? { id: 'org_chart', max: 15, earned: 15 }
    : { id: 'org_chart', max: 15, earned: 0, issue: 'Оргструктура не задокументирована', rec: 'Создать оргсхему компании (Miro, Notion)' })

  const hasDeptKpi = Boolean(a.s4_has_dept_kpi) || staffingTableHasKpi(a)
  checks.push(hasDeptKpi
    ? { id: 'dept_kpi', max: 20, earned: 20 }
    : { id: 'dept_kpi', max: 20, earned: 0, issue: 'KPI по отделам не установлены', rec: 'Ввести KPI для каждого отдела на квартал' })

  checks.push(Boolean(a.s4_has_regular_meetings)
    ? { id: 'meetings', max: 10, earned: 10 }
    : { id: 'meetings', max: 10, earned: 0, issue: 'Нет регулярных планёрок', rec: 'Установить еженедельные синхронизации с повесткой' })

  const reporting = String(a.s4_reporting_tool ?? 'none')
  if (reporting === 'bi' || reporting === 'crm') checks.push({ id: 'reporting', max: 15, earned: 15 })
  else if (reporting === 'excel') checks.push({ id: 'reporting', max: 15, earned: 5, issue: 'Отчётность в Excel — слепые зоны' })
  else checks.push({ id: 'reporting', max: 15, earned: 0, issue: 'Нет системы отчётности', rec: 'Настроить еженедельный P&L-отчёт' })

  const taskMgr = String(a.s4_task_manager ?? 'none')
  checks.push(taskMgr !== 'none' && taskMgr !== ''
    ? { id: 'task_manager', max: 10, earned: 10 }
    : { id: 'task_manager', max: 10, earned: 0, issue: 'Таск-менеджер не используется', rec: 'Внедрить Notion или Trello для задач' })

  if (!present(a.s4_management_method)) {
    checks.push({ id: 'management_method', max: 10, earned: 0, missing: 'Не указан способ контроля команды' })
  } else if (String(a.s4_management_method) === 'manual') {
    checks.push({ id: 'management_method', max: 10, earned: 0, issue: 'Ручное управление — высокий операционный риск', rec: 'Перейти на управление по KPI' })
  } else {
    checks.push({ id: 'management_method', max: 10, earned: 10 })
  }

  return toBlock(checks)
}

// ─── Marketing Block (weight 15%) ────────────────────────────────────────────

function scoreMarketing(inp: Inputs): BlockScore {
  const { a } = inp
  const checks: Check[] = []

  const budgetPct = numAnswer(a, 's5_marketing_budget_pct') ?? 0
  if (budgetPct >= 5) checks.push({ id: 'budget', max: 15, earned: 15 })
  else if (budgetPct > 0) checks.push({ id: 'budget', max: 15, earned: 7, issue: `Маркетинговый бюджет ${budgetPct}% выручки (норма ≥5%)` })
  else checks.push({ id: 'budget', max: 15, earned: 0, issue: 'Маркетинговый бюджет не определён', rec: 'Выделить минимум 5% выручки на маркетинг' })

  const channels = channelCount(a) ?? 0
  if (channels >= 3) checks.push({ id: 'channels', max: 15, earned: 15 })
  else if (channels >= 1) checks.push({ id: 'channels', max: 15, earned: 7, issue: 'Мало каналов маркетинга (< 3)' })
  else checks.push({ id: 'channels', max: 15, earned: 0, issue: 'Каналы маркетинга не определены', rec: 'Протестировать 3 канала привлечения (SEO, соцсети, партнёры)' })

  // Presence is the criterion: the target client is described at all (step 3).
  checks.push(namesSomething(a.s5_target_audience) || namesSomething(a.s3n_client_portrait)
    ? { id: 'audience', max: 15, earned: 15 }
    : { id: 'audience', max: 15, earned: 0, issue: 'Целевая аудитория не описана', rec: 'Составить ICP (идеальный портрет клиента)' })

  // Competitor analysis: the toggle, or a written analysis of a competitor on step 7.
  const competitorAnalysis = Boolean(a.s5_has_competitor_analysis)
    || ['s7n_competitor_1_analysis', 's7n_competitor_2_analysis', 's7n_competitor_3_analysis'].some((k) => namesSomething(a[k]))
  checks.push(competitorAnalysis
    ? { id: 'competitors', max: 10, earned: 10 }
    : { id: 'competitors', max: 10, earned: 0, issue: 'Конкурентный анализ не проводился', rec: 'Провести анализ топ-3 конкурентов' })

  checks.push(loyaltyCheck(a, 'Запустить реферальную программу'))

  // Presence is the criterion: a USP / «why us» is formulated at all.
  checks.push(namesSomething(a.s5_usp) || namesSomething(a.s3n_competitor_why_us)
    ? { id: 'usp', max: 5, earned: 5 }
    : { id: 'usp', max: 5, earned: 0, issue: 'УТП (уникальное торговое предложение) не сформулировано' })

  return toBlock(checks)
}

// ─── Strategy Block (weight 10%) ─────────────────────────────────────────────

function scoreStrategy(inp: Inputs): BlockScore {
  const { a } = inp
  const checks: Check[] = []

  const g3 = goalState(a, '3y')
  if (g3 === 'measurable') checks.push({ id: 'goal_3y', max: 20, earned: 20 })
  else if (g3 === 'text_only') checks.push({ id: 'goal_3y', max: 20, earned: 10, issue: 'Цель на 3 года не выражена в цифрах', rec: 'Сформулировать цель на 3 года в формате SMART' })
  else checks.push({ id: 'goal_3y', max: 20, earned: 0, issue: 'Нет чёткой цели на 3 года', rec: 'Сформулировать цель на 3 года в формате SMART' })

  const g12 = goalState(a, '12m')
  if (g12 === 'measurable') checks.push({ id: 'goal_12m', max: 15, earned: 15 })
  else if (g12 === 'text_only') checks.push({ id: 'goal_12m', max: 15, earned: 8, issue: 'Цель на 12 месяцев не выражена в цифрах', rec: 'Декомпозировать 3-летнюю цель на годовую' })
  else checks.push({ id: 'goal_12m', max: 15, earned: 0, issue: 'Нет цели на 12 месяцев', rec: 'Декомпозировать 3-летнюю цель на годовую' })

  // Presence is the criterion: the owner names the main problem.
  checks.push(namesSomething(a.s6_main_pain)
    ? { id: 'main_pain', max: 15, earned: 15 }
    : { id: 'main_pain', max: 15, earned: 0, issue: 'Ключевая проблема бизнеса не идентифицирована' })

  const blockers = Array.isArray(a.s6_growth_blockers) ? a.s6_growth_blockers.length > 0 : namesSomething(a.s6_growth_blockers)
  checks.push(blockers || namesSomething(a.s2n_what_blocks_growth)
    ? { id: 'growth_blockers', max: 10, earned: 10 }
    : { id: 'growth_blockers', max: 10, earned: 0, issue: 'Барьеры роста не определены', rec: 'Провести стратегическую сессию по барьерам' })

  return toBlock(checks)
}

// ─── Risk Generator ───────────────────────────────────────────────────────────

function generateRisks(inp: Inputs, blocks: PointA['blocks']): Risk[] {
  const { a } = inp
  const risks: Risk[] = []

  if (blocks.sales.score < 30 && crmState(a) === 'none') {
    risks.push({ level: 'critical', area: 'Продажи', text: 'Нет CRM-системы — потери лидов ~30%', impact: 'Прямые потери выручки' })
  }
  if (blocks.finance.score < 40) {
    const { ratio } = ltvCac(inp)
    if (ratio !== null && ratio < 3) {
      risks.push({ level: 'important', area: 'Финансы', text: `LTV/CAC = ${ratio.toFixed(1)} (норма > 3)`, impact: 'Маркетинг убыточен' })
    }
  }
  if (String(a.s4_reporting_tool ?? 'none') === 'excel') {
    risks.push({ level: 'important', area: 'Операции', text: 'Отчётность в Excel — слепые зоны в данных', impact: 'Ошибки в управленческих решениях' })
  }
  if (blocks.operations.score < 30) {
    risks.push(String(a.s4_management_method ?? '') === 'manual'
      ? { level: 'critical', area: 'Операции', text: 'Ручное управление — высокий операционный риск', impact: 'Масштабирование невозможно' }
      : { level: 'critical', area: 'Операции', text: 'Управленческие процессы не выстроены', impact: 'Масштабирование невозможно' })
  }
  if (blocks.marketing.score < 40) {
    const budgetPct = numAnswer(a, 's5_marketing_budget_pct') ?? 0
    risks.push(budgetPct < 5
      ? { level: 'important', area: 'Маркетинг', text: 'Маркетинговый бюджет ниже нормы или не определён', impact: 'Замедление роста клиентской базы' }
      : { level: 'important', area: 'Маркетинг', text: 'Маркетинг не выстроен в систему', impact: 'Замедление роста клиентской базы' })
  }
  if (knowsBreakeven(a) !== true) {
    risks.push({ level: 'moderate', area: 'Финансы', text: 'Точка безубыточности неизвестна', impact: 'Риск работы в убыток' })
  }

  return risks
}

// ─── Insight Generator ───────────────────────────────────────────────────────

function generateInsights(inp: Inputs): Insight[] {
  const { a } = inp
  const insights: Insight[] = []

  const flagship = String(a['s3_flagship_product'] ?? '')
  if (flagship) {
    insights.push({ text: `Продукт-локомотив «${flagship}» требует защиты и масштабирования`, area: 'Продажи', kind: 'opportunity' })
  }

  const rej24 = numAnswer(a, 's3_rejections_2024') ?? 0
  const rej23 = numAnswer(a, 's3_rejections_2023') ?? 0
  if (rej24 > rej23 && rej23 > 0) {
    insights.push({ text: 'Отказы растут — нужен глубокий разбор воронки', area: 'Продажи', kind: 'risk' })
  }

  const nr = newVsRepeat(inp)
  if (nr && nr.newCount + nr.repeatCount > 0) {
    const repPct = Math.round((nr.repeatCount / (nr.newCount + nr.repeatCount)) * 100)
    if (repPct < 20) {
      insights.push({ text: `Повторные клиенты ${repPct}% — программа лояльности критична`, area: 'Маркетинг', kind: 'risk' })
    }
  }

  const rev24 = revenue(inp, 2024)
  const rev23 = revenue(inp, 2023)
  const changeVs2023 = parsePercentChange(a['s9n_change_vs_2023'])
  if (rev23 !== null && rev23 > 0 && rev24 !== null && rev24 > rev23) {
    const g = Math.round(((rev24 - rev23) / rev23) * 100)
    insights.push({ text: `Выручка растёт на ${g}% г/г — фиксируйте драйверы роста`, area: 'Финансы', kind: 'strength' })
  } else if (rev24 !== null && rev24 > 0 && changeVs2023 !== null && changeVs2023 > 0) {
    insights.push({ text: `Выручка растёт на ${Math.round(changeVs2023)}% г/г — фиксируйте драйверы роста`, area: 'Финансы', kind: 'strength' })
  }

  const channels = Array.isArray(a['s5_marketing_channels']) ? a['s5_marketing_channels'] : []
  if (channels.length === 1) {
    insights.push({ text: 'Единственный канал маркетинга — критическая зависимость', area: 'Маркетинг', kind: 'risk' })
  }

  return insights
}

// ─── Quick Wins Generator ─────────────────────────────────────────────────────

function generateQuickWins(inp: Inputs, blocks: PointA['blocks']): QuickWin[] {
  const { a } = inp
  const wins: QuickWin[] = []

  if (crmState(a) === 'none') {
    wins.push({ action: 'Внедрить CRM (amoCRM базовый)', timeline: '2 недели', area: 'Продажи' })
  }
  if (knowsBreakeven(a) !== true) {
    wins.push({ action: 'Рассчитать точку безубыточности', timeline: '1 день', area: 'Финансы' })
  }
  if (String(a.s4_reporting_tool ?? 'none') !== 'bi') {
    wins.push({ action: 'Настроить еженедельный P&L-отчёт', timeline: '1 день', area: 'Финансы' })
  }
  // NPS survey: only when loyalty is not measured (no NPS answer, no loyalty programme).
  if (!Boolean(a.s3_has_loyalty) && numAnswer(a, 's7_nps_score') === null) {
    wins.push({ action: 'Запустить NPS-опрос клиентской базы', timeline: '3 дня', area: 'Маркетинг' })
  }
  if (!Boolean(a.s4_has_regular_meetings)) {
    wins.push({ action: 'Ввести еженедельный командный синхрон (30 мин)', timeline: '1 неделя', area: 'Операции' })
  }
  if (blocks.marketing.score < 50 && !Boolean(a.s5_has_competitor_analysis)) {
    wins.push({ action: 'Провести анализ топ-3 конкурентов', timeline: '1 неделя', area: 'Маркетинг' })
  }

  return wins.slice(0, 5)
}

// ─── Data Gaps Detector ───────────────────────────────────────────────────────

/**
 * Inputs the wizard asks for (current question keys) that are still missing
 * from every source — survey, legacy answers and resolved metrics.
 */
function detectDataGaps(inp: Inputs): DataGap[] {
  const { a } = inp
  const gaps: DataGap[] = []

  if (revenue(inp, 2024) === null || revenue(inp, 2024) === 0) {
    gaps.push({ field: 's9n_revenue_2024', step: 9, impact: 'Выручка за 2024 — основа финансового анализа' })
  }
  if (goalState(a, '12m') === 'missing') {
    gaps.push({ field: 's2n_goal_12m_what', step: 2, impact: 'Цель на 12 месяцев — основа стратегического блока' })
  }
  const margin = finite(inp.resolved.grossMargin) ? inp.resolved.grossMargin : firstNumber(a, ['s2_gross_margin', 's9n_net_margin'])
  if (margin === null || margin === 0) {
    gaps.push({ field: 's9n_net_margin', step: 9, impact: 'Маржинальность — ключевой показатель здоровья' })
  }
  const { ltv, cac, ratio } = ltvCac(inp)
  if (ratio === null) {
    const missing = [cac === null ? 'CAC' : null, ltv === null ? 'LTV' : null].filter(Boolean).join(' и ')
    gaps.push({ field: 's8n_metrics_table', step: 8, impact: `${missing || 'LTV:CAC'} — строки таблицы ключевых метрик, нужны для расчёта LTV/CAC` })
  }
  if (crmState(a) === null) {
    gaps.push({ field: 's12_crm_tool', step: 12, impact: 'Наличие CRM влияет на оценку продаж' })
  }
  return gaps
}

// ─── Current-form aliases ─────────────────────────────────────────────────────

/**
 * The scoring below was written against the first-generation survey keys
 * (s4_reporting_tool, s4_management_method, s2_knows_breakeven …). The current
 * 12-step form writes different keys, so for every current client:
 *  - Operations never scored above 25 and always carried «Ручное управление»,
 *  - «Точка безубыточности неизвестна» appeared although s9n_breakeven_point was filled,
 *  - free-text «нет» in the CRM field scored as HAVING a CRM.
 * Legacy keys are filled from their current equivalents only when absent, so
 * owners who answered the old form keep their exact inputs.
 */
export function withCurrentAliases(input: Record<string, unknown>): Record<string, unknown> {
  const a: Record<string, unknown> = { ...input }

  // CRM: the structured step-12 choice wins; free text meaning «no» is 'none'.
  if (present(a.s12_crm_tool)) a.s3_has_crm = a.s12_crm_tool
  else if (typeof a.s3_has_crm === 'string' && NO_ANSWER_RE.test(a.s3_has_crm.trim())) a.s3_has_crm = 'none'

  // Reporting tool (same value set: excel / bi / crm / none).
  if (!present(a.s4_reporting_tool) && present(a.s4m_report_automated)) a.s4_reporting_tool = a.s4m_report_automated

  // Task manager ← step-12 project management tool.
  if (!present(a.s4_task_manager) && present(a.s12_project_mgmt)) a.s4_task_manager = a.s12_project_mgmt

  // Management method ← step-4 «Метод контроля» (reports / tasks / kpi / fire_fighting).
  if (!present(a.s4_management_method) && present(a.s4m_control_method)) {
    const c = String(a.s4m_control_method)
    a.s4_management_method = c === 'kpi' ? 'kpi' : c === 'fire_fighting' ? 'manual' : 'hybrid'
  }
  // KPI per department ← control by KPI.
  if (!present(a.s4_has_dept_kpi) && present(a.s4m_control_method)) a.s4_has_dept_kpi = a.s4m_control_method === 'kpi'

  // Break-even known ← the break-even amount was filled on step 9.
  if (!present(a.s2_knows_breakeven) && present(a.s9n_breakeven_point)) {
    const be = Number(a.s9n_breakeven_point)
    a.s2_knows_breakeven = Number.isFinite(be) ? be > 0 : !UNKNOWN_RE.test(String(a.s9n_breakeven_point).trim())
  }
  return a
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Rule-based Point A from survey answers (flat question_key → value map).
 * `resolved` (optional) carries metric values from documents / manual / CRM
 * that take precedence over survey answers.
 */
export function calculatePointA(rawAnswers: Record<string, unknown>, resolved: PointAResolvedInputs = {}): PointA {
  const answers = withCurrentAliases(rawAnswers)
  const inp: Inputs = { a: answers, table: readMetricsTable(answers.s8n_metrics_table), resolved }
  const finance    = scoreFinance(inp)
  const sales      = scoreSales(inp)
  const operations = scoreOperations(inp)
  const marketing  = scoreMarketing(inp)
  const strategy   = scoreStrategy(inp)

  const overall_score = clamp(
    finance.score    * 0.30 +
    sales.score      * 0.25 +
    operations.score * 0.20 +
    marketing.score  * 0.15 +
    strategy.score   * 0.10
  )

  const health_index = clamp(
    (overall_score * 0.6) +
    (finance.score > 50 ? 20 : 0) +
    (sales.score > 50 ? 10 : 0) +
    (operations.score > 50 ? 10 : 0)
  )

  const blocks = { finance, sales, operations, marketing, strategy }

  return {
    overall_score: Math.round(overall_score),
    health_index: Math.round(health_index),
    stage: stageFromScore(overall_score),
    blocks,
    risks: generateRisks(inp, blocks),
    insights: generateInsights(inp),
    quick_wins: generateQuickWins(inp, blocks),
    data_gaps: detectDataGaps(inp),
  }
}
