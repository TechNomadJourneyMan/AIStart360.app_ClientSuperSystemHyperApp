/**
 * lib/assistant/validators/rules.ts — Layer 2 configurable inconsistency rules.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  THE SINGLE EXTENSION POINT
 *  Add a new cross-section / consistency rule by appending ONE object to the
 *  RULES array below. Each rule is self-contained:
 *
 *     {
 *       id:       'my_rule',                  // stable machine id
 *       severity: 'warning',                  // default severity for its issue
 *       section:  'finance',                  // section the issue attaches to
 *       applies:  (ctx) => boolean,           // cheap gate: do we have the data?
 *       evaluate: (ctx) => ValidationIssue | null,  // null = no problem found
 *     }
 *
 *  Rules read ONLY the curated AssistantContext (answers + pointB realism etc.) —
 *  never raw DB rows, never any I/O. No new math: realism reuses Point B's
 *  assessRealism output already on ctx.pointB.realism.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { computeCompletion } from '../completion'
import type { AssistantContext, ValidationIssue } from '../types'

// ─── Rule contract ──────────────────────────────────────────────────────────

export interface DiagnosticRule {
  id: string
  severity: ValidationIssue['severity']
  /** Section id the produced issue attaches to. */
  section: string
  /** Cheap precondition: only run evaluate() when the needed inputs exist. */
  applies: (ctx: AssistantContext) => boolean
  /** Return a single issue, or null when the rule passes. */
  evaluate: (ctx: AssistantContext) => ValidationIssue | null
}

// ─── Shared coercion helpers (same forgiving parsing as the engines) ────────

function num(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return null
  const s = String(v).replace(/[^\d.,-]/g, '').replace(/,/g, '.')
  if (!/\d/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Sum of numeric values across several keys (skips missing). null if none. */
function sumKeys(answers: Record<string, unknown>, keys: string[]): number | null {
  let total = 0
  let seen = false
  for (const k of keys) {
    const n = num(answers[k])
    if (n != null) {
      total += n
      seen = true
    }
  }
  return seen ? total : null
}

function firstNum(answers: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = num(answers[k])
    if (n != null) return n
  }
  return null
}

function hasText(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0
  return true
}

/** Build a ValidationIssue for a rule (source always 'diagnostic'). */
function issue(
  rule: DiagnosticRule,
  message_ru: string,
  opts?: { field?: string; hint_ru?: string; severity?: ValidationIssue['severity']; code?: string },
): ValidationIssue {
  return {
    id: `rule:${rule.id}`,
    severity: opts?.severity ?? rule.severity,
    section: rule.section,
    field: opts?.field,
    code: opts?.code ?? rule.id,
    message_ru,
    hint_ru: opts?.hint_ru,
    source: 'diagnostic',
  }
}

// ─── Domain key groups (kept here so rules stay one-liners) ─────────────────

const FUNNEL_KEYS = [
  's5n_funnel_lead_to_call',
  's5n_funnel_call_to_meeting',
  's5n_funnel_call_to_kp',
  's5n_funnel_meeting_to_kp',
  's5n_funnel_call_to_sale',
  's5n_funnel_meeting_to_sale',
  's5n_funnel_kp_to_sale',
  's5n_funnel_lead_to_sale',
] as const

const STAGE_FUNNEL_KEYS = FUNNEL_KEYS.filter((k) => k !== 's5n_funnel_lead_to_sale')

const NEW_CLIENT_KEYS = ['s2_new_clients_2024', 's2_new_clients_2025', 's2_new_clients_2023']
const REPEAT_CLIENT_KEYS = ['s2_repeat_clients_2024', 's2_repeat_clients_2025', 's2_repeat_clients_2023']
const DEALS_KEYS = ['s3_deals_2024', 's3_deals_2025', 's3_deals_2023']
const REVENUE_KEYS = ['s9n_revenue_2024', 's2_revenue_2024', 's2_revenue_2025']

function anyFunnelProvided(answers: Record<string, unknown>): boolean {
  return FUNNEL_KEYS.some((k) => num(answers[k]) != null)
}

/** Heuristic: does the org data suggest there is NO sales function? */
function looksLikeNoSalesTeam(answers: Record<string, unknown>): boolean {
  const dept = num(answers.s4_dept_count)
  const staffing = answers.s4n_staffing_table
  const staffingText = typeof staffing === 'string' ? staffing.toLowerCase() : ''
  const deptZeroOrOne = dept != null && dept <= 1
  const staffingMentionsSales =
    /продаж|sales|менеджер|коммерч/.test(staffingText)
  // No sales function when departments are 0–1 AND the staffing table (if any
  // text) does not mention a sales/commercial role.
  if (deptZeroOrOne && !staffingMentionsSales) return true
  return false
}

// ════════════════════════════════════════════════════════════════════════════
//  RULES — the single extension point. Append new objects here.
// ════════════════════════════════════════════════════════════════════════════

export const RULES: DiagnosticRule[] = [
  // 1. Sales KPIs provided but no sales team / responsible person.
  {
    id: 'no_sales_team_but_sales_kpis',
    severity: 'warning',
    section: 'org',
    applies: (ctx) =>
      anyFunnelProvided(ctx.answers) || firstNum(ctx.answers, DEALS_KEYS) != null,
    evaluate: function (ctx) {
      if (!looksLikeNoSalesTeam(ctx.answers)) return null
      return issue(
        this,
        'Указаны KPI продаж (воронка/сделки), но не видно отдела или ответственного за продажи.',
        {
          field: 's4_dept_count',
          hint_ru: 'Уточните, кто отвечает за продажи, или добавьте отдел в штатное расписание.',
        },
      )
    },
  },

  // 2. Declared revenue impossible vs avg_check × clients.
  {
    id: 'revenue_impossible_vs_price_x_clients',
    severity: 'error',
    section: 'finance',
    applies: (ctx) => {
      const rev = firstNum(ctx.answers, REVENUE_KEYS)
      const check = firstNum(ctx.answers, ['s2_avg_check', 's7_avg_check_target_kzt'])
      const clients =
        (sumKeys(ctx.answers, NEW_CLIENT_KEYS) ?? 0) +
        (sumKeys(ctx.answers, REPEAT_CLIENT_KEYS) ?? 0)
      return rev != null && rev > 0 && check != null && check > 0 && clients > 0
    },
    evaluate: function (ctx) {
      const rev = firstNum(ctx.answers, REVENUE_KEYS)!
      const check = firstNum(ctx.answers, ['s2_avg_check', 's7_avg_check_target_kzt'])!
      const clients =
        (sumKeys(ctx.answers, NEW_CLIENT_KEYS) ?? 0) +
        (sumKeys(ctx.answers, REPEAT_CLIENT_KEYS) ?? 0)
      const implied = check * clients
      if (implied <= 0) return null
      const ratio = rev / implied
      // Flag only large divergence in either direction (3× off).
      if (ratio > 3 || ratio < 1 / 3) {
        return issue(
          this,
          `Выручка (${Math.round(rev)}) не сходится со «средний чек × число клиентов» (${Math.round(implied)}). Проверьте цифры.`,
          {
            field: 's2_avg_check',
            hint_ru: 'Сверьте средний чек, число клиентов и выручку — что-то одно указано неверно.',
          },
        )
      }
      return null
    },
  },

  // 3. Marketing budget set but no channels described.
  {
    id: 'marketing_budget_but_no_channels',
    severity: 'warning',
    section: 'finance',
    applies: (ctx) => num(ctx.answers.s5_marketing_budget_pct) != null,
    evaluate: function (ctx) {
      const budget = num(ctx.answers.s5_marketing_budget_pct)
      if (budget == null || budget <= 0) return null
      if (hasText(ctx.answers.s7n_channels_table)) return null
      return issue(
        this,
        'Указан бюджет на маркетинг, но не заполнена таблица каналов.',
        {
          field: 's7n_channels_table',
          hint_ru: 'Опишите, на какие каналы тратится бюджет.',
        },
      )
    },
  },

  // 4. Stage conflicts with team size or revenue.
  {
    id: 'stage_conflicts_with_size_or_revenue',
    severity: 'warning',
    section: 'company',
    applies: (ctx) => {
      const stage = String(ctx.answers.s1_stage ?? ctx.company.stage ?? '').toLowerCase()
      return /scale|growth|рост|масштаб/.test(stage)
    },
    evaluate: function (ctx) {
      const employees = num(ctx.answers.s1_employee_count) ?? ctx.company.employee_count
      const revenue = firstNum(ctx.answers, REVENUE_KEYS) ?? ctx.metrics.revenue
      const tinyTeam = employees != null && employees <= 3
      const nearZeroRevenue = revenue != null && revenue < 1_000_000
      if (!tinyTeam && !nearZeroRevenue) return null
      const why = tinyTeam
        ? 'очень маленькая команда'
        : 'выручка близка к нулю'
      return issue(
        this,
        `Стадия «рост/масштабирование» не сходится с данными: ${why}.`,
        {
          field: 's1_stage',
          hint_ru: 'Уточните стадию развития или проверьте размер команды/выручку.',
        },
      )
    },
  },

  // 5. Negative financials (consistency cross-check; field rule also covers it).
  {
    id: 'negative_financials',
    severity: 'error',
    section: 'finance',
    applies: (ctx) =>
      ['s9n_revenue_2024', 's2_revenue_2024', 's9n_net_profit', 's2_avg_check'].some(
        (k) => num(ctx.answers[k]) != null,
      ),
    evaluate: function (ctx) {
      const negKey = ['s9n_revenue_2024', 's2_revenue_2024', 's9n_net_profit', 's2_avg_check'].find(
        (k) => {
          const n = num(ctx.answers[k])
          return n != null && n < 0
        },
      )
      if (!negKey) return null
      return issue(this, `Финансовый показатель «${negKey}» указан отрицательным — это ошибка.`, {
        field: negKey,
        hint_ru: 'Введите положительное значение.',
      })
    },
  },

  // 6. Unrealistic growth vs resources (reuses Point B realism — no new math).
  {
    id: 'unrealistic_growth_vs_resources',
    severity: 'warning',
    section: 'goals',
    applies: (ctx) =>
      ctx.pointB.has_goal &&
      (ctx.pointB.realism.level === 'aggressive' ||
        ctx.pointB.realism.level === 'unrealistic'),
    evaluate: function (ctx) {
      const lowData = !ctx.pointB.data_sufficiency.sufficient
      const manyWeak = ctx.pointB.realism.weak_blocks.length >= 2
      if (!lowData && !manyWeak) return null
      const rationale = ctx.pointB.realism.rationale.filter(Boolean).join(' ')
      return issue(
        this,
        `Цель выглядит труднодостижимой при текущих ресурсах (${ctx.pointB.realism.level}). ${rationale}`.trim(),
        {
          hint_ru:
            'Пересмотрите цель или усильте слабые блоки: ' +
            (ctx.pointB.realism.weak_blocks.join(', ') || 'нет данных'),
        },
      )
    },
  },

  // 7. Skipped required sections (entire required section at 0% completion).
  {
    id: 'skipped_required_sections',
    severity: 'warning',
    section: 'company',
    applies: () => true,
    evaluate: function (ctx) {
      const completion = computeCompletion(ctx)
      // A required section is "skipped" when it has required fields, is at 0%,
      // while at least one OTHER section already has data (out-of-order gap).
      const withRequired = completion.sections.filter((s) => s.required_total > 0)
      const anyFilled = withRequired.some((s) => s.required_filled > 0)
      if (!anyFilled) return null // nothing started yet → not "skipped", just empty
      const skipped = withRequired.filter((s) => s.required_filled === 0)
      if (skipped.length === 0) return null
      const names = skipped.map((s) => s.label).join(', ')
      return issue(
        this,
        `Пропущены обязательные разделы: ${names}.`,
        {
          severity: 'warning',
          hint_ru: 'Заполните их — без этого анализ будет неполным.',
        },
      )
    },
  },

  // 8. Funnel conversions exceed 100% (any stage, or lead→sale > a single stage).
  {
    id: 'funnel_conversions_exceed_100',
    severity: 'error',
    section: 'base',
    applies: (ctx) => anyFunnelProvided(ctx.answers),
    evaluate: function (ctx) {
      const over = FUNNEL_KEYS.find((k) => {
        const n = num(ctx.answers[k])
        return n != null && n > 100
      })
      if (over) {
        return issue(this, `Конверсия «${over}» больше 100% — это невозможно.`, {
          field: over,
          hint_ru: 'Конверсия не может превышать 100%.',
        })
      }
      // lead→sale (end-to-end) cannot exceed any single intermediate-stage rate.
      const leadToSale = num(ctx.answers.s5n_funnel_lead_to_sale)
      if (leadToSale != null) {
        const violating = STAGE_FUNNEL_KEYS.find((k) => {
          const stage = num(ctx.answers[k])
          return stage != null && leadToSale > stage
        })
        if (violating) {
          return issue(
            this,
            `Сквозная конверсия лид→продажа (${leadToSale}%) выше промежуточной «${violating}» — это противоречие.`,
            {
              field: 's5n_funnel_lead_to_sale',
              hint_ru: 'Итоговая конверсия не может быть выше любой промежуточной.',
            },
          )
        }
      }
      return null
    },
  },

  // 9. Retention/NPS positive but zero repeat clients.
  {
    id: 'retention_without_repeat_clients',
    severity: 'warning',
    section: 'base',
    applies: (ctx) => num(ctx.answers.s5n_will_return_nps) != null,
    evaluate: function (ctx) {
      const nps = num(ctx.answers.s5n_will_return_nps)
      if (nps == null || nps <= 0) return null
      const repeat = sumKeys(ctx.answers, REPEAT_CLIENT_KEYS)
      // Only flag when repeat-client data exists AND is explicitly zero.
      if (repeat == null || repeat !== 0) return null
      return issue(
        this,
        'Указан положительный NPS / возврат клиентов, но число повторных клиентов = 0.',
        {
          field: 's5n_will_return_nps',
          hint_ru: 'Сверьте: либо повторные клиенты есть, либо NPS завышен.',
        },
      )
    },
  },
]

// ─── Runner ─────────────────────────────────────────────────────────────────

/**
 * Run every Layer-2 rule whose `applies(ctx)` gate passes. Pure: each rule reads
 * the curated context only; never throws (a rule's exception is swallowed so one
 * bad rule cannot break validation). Returns the produced ValidationIssue[].
 */
export function runRules(ctx: AssistantContext): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const rule of RULES) {
    try {
      if (!rule.applies(ctx)) continue
      const result = rule.evaluate(ctx)
      if (result) out.push(result)
    } catch (err) {
      console.error(`[assistant/rules] rule "${rule.id}" threw:`, err)
    }
  }
  return out
}
