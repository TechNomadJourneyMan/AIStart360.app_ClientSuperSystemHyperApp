/**
 * Invariants of the metric catalog (W4 metrics overhaul). They fail the build
 * when a source is wired to a key the wizard no longer writes, to a value of
 * another unit / meaning, to a document field the extraction can never
 * produce, or when a metric has no real way to get a value.
 *
 *   1. every survey key in sources is written by the current wizard
 *      (lib/survey/steps.ts SURVEY_KEY_STEP) with the right step — or is an
 *      explicit legacy fallback of a metric that also has a current path;
 *   2. every metric has ≥ 1 resolvable path: a current survey key, a document
 *      field with a synonym, a formula whose inputs resolve, or a GRI section;
 *   3. every document field referenced has an entry in the synonym dictionary;
 *   4. survey key ↔ metric unit compatibility (table below);
 *   5. formulas: known ids, existing inputs, declared input units = the
 *      inputs' units, result unit = the metric unit, no cycles.
 */
import { describe, expect, it } from 'vitest'
import { getMetricById, getMetricRegistry } from '@/lib/metrics/registry'
import { BASE_INPUTS, getBaseInput, getFormula, METRIC_FORMULAS } from '@/lib/metrics/formulas'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { METRIC_SYNONYMS } from '@/lib/documents/synonyms'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import type { MetricSource } from '@/lib/metrics/format'
import type { MetricEntry } from '@/lib/metrics/types'

const registry = getMetricRegistry()
const all: MetricEntry[] = [...registry, ...BASE_INPUTS]
const entryOf = (id: string) => getMetricById(id) ?? getBaseInput(id)

/** Keys only the older questionnaire wrote — allowed solely as `legacy: true` fallbacks. */
const ALLOWED_LEGACY_KEYS = new Set([
  's2_avg_check', 's2_cac', 's2_gross_margin', 's2_ltv', 's2_new_clients_2025',
  's2_revenue_2023', 's2_revenue_2024', 's2_revenue_2025', 's5n_funnel_kp_to_sale', 's5n_funnel_meeting_to_kp',
])

/**
 * Unit of the value a survey key holds when read as a plain number. Keys
 * holding text / choices / yes-no / tables are 'coerce' — they may only feed a
 * metric through an explicit `coerce` rule (flag, choice, count, table cell).
 */
const KEY_UNIT: Record<string, string> = {
  s1_current_revenue_month: '₸', s1_current_revenue_year: '₸', s9n_revenue_2024: '₸', s9n_net_profit: '₸',
  s9n_expense_cogs: '₸', s9n_expense_marketing: '₸', s9n_expense_rent: '₸', s9n_expense_other: '₸',
  s2_avg_check: '₸', s2_cac: '₸', s2_ltv: '₸', s2_revenue_2023: '₸', s2_revenue_2024: '₸', s2_revenue_2025: '₸',
  s1_employee_count: 'count', s2_new_clients_2025: 'count', s3_product_count: 'count', s7_leads_per_month: 'count',
  s3_deals_2023: 'count', s3_deals_2024: 'count', s3_deals_2025: 'count',
  s3_rejections_2023: 'count', s3_rejections_2024: 'count', s3_rejections_2025: 'count',
  s3_deal_cycle_days: 'days', s7_repeat_freq_days: 'days', s9n_debtor_days: 'days',
  s2_gross_margin: '%', s5_marketing_budget_pct: '%', s7_missed_calls_rate: '%', s7_no_show_rate: '%',
  s5n_funnel_lead_to_call: '%', s5n_funnel_call_to_meeting: '%', s5n_funnel_meeting_to_proposal: '%',
  s5n_funnel_proposal_to_negotiation: '%', s5n_funnel_negotiation_to_contract: '%', s5n_funnel_contract_to_payment: '%',
  s5n_funnel_lead_to_sale: '%', s5n_funnel_kp_to_sale: '%', s5n_funnel_meeting_to_kp: '%',
  s7_nps_score: 'nps', s4m_delegation_readiness: 'из 10', s4m_hours_on_ops: 'ч/день',
}
const COERCE_ONLY = new Set([
  's12_bi_tool', 's12_crm_tool', 's12_edm', 's12_erp', 's12_it_support', 's12_marketing_platforms', 's12_project_mgmt', 's12_telephony',
  's1_social_media', 's1_website', 's3_has_crm', 's4_has_org_chart', 's4_has_regular_meetings', 's4m_control_method', 's4m_dept_sync',
  's4m_report_automated', 's4n_staffing_table', 's5_marketing_channels', 's7n_channels_table', 's8n_metrics_table',
  's9n_analysis_frequency', 's9n_planning_frequency',
])
/** Units of the step-8 table rows / summed table columns. */
const TABLE_ROW_UNIT: Record<string, string> = {
  sales_amount: '₸', avg_check: '₸', new_sales_amount: '₸', new_avg_check: '₸', repeat_amount: '₸', cpl: '₸', cac: '₸', ltv: '₸',
  ltv_cac: '', sales_count: 'count', new_sales_count: 'count', repeat_count: 'count',
}
const TABLE_SUM_UNIT: Record<string, string> = { budget_monthly: '₸', manager_count: 'count' }

/** Metric unit ↔ key unit: NPS is an index (unitless, −100..100), not a percent. */
function compatible(metricUnit: string, keyUnit: string): boolean {
  if (keyUnit === 'nps') return metricUnit === ''
  return metricUnit === keyUnit
}

function surveyKeys(s: MetricSource): string[] {
  return s.key ? [s.key] : s.keys ?? []
}

const pathMemo = new Map<string, boolean>()
/** Does the entry have a source that can produce a value from data the platform collects? */
function hasPath(e: MetricEntry, stack: Set<string> = new Set()): boolean {
  const cached = pathMemo.get(e.id)
  if (cached !== undefined) return cached
  if (stack.has(e.id)) return false
  stack.add(e.id)
  const ok = e.sources.some((s) => {
    if (s.type === 'survey') return !s.legacy && surveyKeys(s).every((k) => k in SURVEY_KEY_STEP)
    if (s.type === 'document') return Boolean(s.field && s.field in METRIC_SYNONYMS)
    if (s.type === 'assessment') return Boolean(s.section)
    if (s.type === 'formula') {
      const def = getFormula(s.formula)
      return Boolean(def?.variants.some((v) => v.inputs.every(([id]) => {
        const inp = entryOf(id)
        return inp ? hasPath(inp, stack) : false
      })))
    }
    return false
  })
  stack.delete(e.id)
  pathMemo.set(e.id, ok)
  return ok
}

/** A current survey key reachable directly or through formula inputs. */
function hasCurrentSurveyPath(e: MetricEntry, seen: Set<string> = new Set()): boolean {
  if (seen.has(e.id)) return false
  seen.add(e.id)
  return e.sources.some((s) => {
    if (s.type === 'survey') return !s.legacy && surveyKeys(s).every((k) => k in SURVEY_KEY_STEP)
    if (s.type === 'formula') {
      return Boolean(getFormula(s.formula)?.variants.some((v) => v.inputs.some(([id]) => {
        const inp = entryOf(id)
        return inp ? hasCurrentSurveyPath(inp, seen) : false
      })))
    }
    return false
  })
}

describe('metric catalog invariants', () => {
  it('148 catalog metrics with unique ids', () => {
    expect(registry).toHaveLength(148)
    expect(new Set(registry.map((e) => e.id)).size).toBe(148)
  })

  it('every survey key is written by the current wizard (right step), or is an allowed legacy fallback', () => {
    const problems: string[] = []
    for (const e of all) {
      for (const s of e.sources) {
        if (s.type !== 'survey') continue
        for (const k of surveyKeys(s)) {
          if (s.legacy) {
            if (!ALLOWED_LEGACY_KEYS.has(k)) problems.push(`${e.id}: legacy key ${k} not in the allow-list`)
            if (k in SURVEY_KEY_STEP) problems.push(`${e.id}: ${k} is a current key — drop legacy: true`)
            if (!hasCurrentSurveyPath(e)) problems.push(`${e.id}: legacy ${k} without a current-wizard path`)
          } else if (!(k in SURVEY_KEY_STEP)) {
            problems.push(`${e.id}: ${k} is not written by the wizard (mark legacy or replace it)`)
          } else if (s.step !== undefined && s.step !== SURVEY_KEY_STEP[k]) {
            problems.push(`${e.id}: ${k} declared on step ${s.step}, the wizard asks it on step ${SURVEY_KEY_STEP[k]}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('every metric has at least one resolvable path', () => {
    const none = registry.filter((e) => !hasPath(e)).map((e) => e.id)
    expect(none).toEqual([])
  })

  it('every document field referenced has a synonym entry (the extraction can name it)', () => {
    const missing: string[] = []
    for (const e of all) for (const s of e.sources) {
      if (s.type === 'document' && (!s.field || !(s.field in METRIC_SYNONYMS))) missing.push(`${e.id}: ${s.field}`)
    }
    expect(missing).toEqual([])
  })

  it('survey key units match the metric unit (table above); text keys only through a coerce rule', () => {
    const problems: string[] = []
    for (const e of all) {
      for (const s of e.sources) {
        if (s.type !== 'survey') continue
        const c = s.coerce
        if (c?.kind === 'table_cell') {
          const u = TABLE_ROW_UNIT[(c as { row: string }).row]
          if (u === undefined || !compatible(e.unit, u)) problems.push(`${e.id} (${e.unit}) ← table row ${(c as { row: string }).row} (${u})`)
          continue
        }
        if (c?.kind === 'table_sum') {
          const u = TABLE_SUM_UNIT[c.column]
          if (u === undefined || !compatible(e.unit, u)) problems.push(`${e.id} (${e.unit}) ← table column ${c.column} (${u})`)
          continue
        }
        if (c) continue // flag / choice / count_selected define their own number
        for (const k of surveyKeys(s)) {
          if (COERCE_ONLY.has(k)) { problems.push(`${e.id} ← ${k}: a text / choice / table answer read as a plain number`); continue }
          const u = KEY_UNIT[k]
          if (u === undefined) problems.push(`${e.id} ← ${k}: unit of the key is not classified`)
          else if (!compatible(e.unit, u)) problems.push(`${e.id} (${e.unit || 'index'}) ← ${k} (${u})`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('a period is declared only on flow metrics (money / counts), units are from a known set', () => {
    const units = new Set(['₸', '%', '', 'count', 'days', 'мес', 'мин', 'из 10', 'ч/день', 'раз/год'])
    for (const e of all) {
      expect(units.has(e.unit), `${e.id}: ${e.unit}`).toBe(true)
      if (e.period) expect(['₸', 'count'], e.id).toContain(e.unit)
    }
  })

  it('formulas: known ids, existing inputs, units agree, no cycles', () => {
    const problems: string[] = []
    const used = new Set<string>()
    for (const e of all) {
      for (const s of e.sources) {
        if (s.type !== 'formula') continue
        const def = getFormula(s.formula)
        if (!def) { problems.push(`${e.id}: unknown formula ${s.formula}`); continue }
        used.add(def.id)
        if (def.unit !== e.unit) problems.push(`${e.id} (${e.unit}) ← formula ${def.id} (${def.unit})`)
      }
    }
    for (const def of Object.values(METRIC_FORMULAS)) {
      if (!used.has(def.id)) problems.push(`formula ${def.id} is used by no metric`)
      for (const v of def.variants) for (const [id, unit] of v.inputs) {
        const inp = entryOf(id)
        if (!inp) problems.push(`formula ${def.id}: unknown input ${id}`)
        else if (inp.unit !== unit) problems.push(`formula ${def.id}: input ${id} is «${inp.unit}», expected «${unit}»`)
      }
    }
    expect(problems).toEqual([])
    // A cycle shows up as a resolver note.
    const values = resolveAllMetrics({ companyId: 'c', userId: 'u', surveyAnswers: {}, documents: [], now: new Date() })
    expect(values.filter((v) => v.notes === 'formula cycle').map((v) => v.metricId)).toEqual([])
  })

  it('an unresolved metric says what is needed («нужно: …»), never a number', () => {
    const values = resolveAllMetrics({ companyId: 'c', userId: 'u', surveyAnswers: {}, documents: [], now: new Date() })
    for (const v of values) {
      expect(v.numeric, v.metricId).toBeNull()
      expect(v.needs?.length ?? 0, v.metricId).toBeGreaterThan(0)
    }
  })
})
