/**
 * lib/metrics/formulas.ts — metrics calculated from other metrics.
 *
 * A metric declares `{ type: 'formula', formula: '<id>' }` among its sources
 * (lib/metrics/descriptions.ts). The resolver evaluates the formula AFTER its
 * inputs are resolved (dependency order, cycles refused), only when every
 * input of one variant has a value — otherwise the metric stays empty with an
 * honest «нужно: …» list. The result carries provenance type 'formula' with
 * every input, its value and where it came from.
 *
 * Inputs are registry metrics or BASE INPUTS: quantities that are not
 * catalog metrics but feed formulas (net profit, total assets, the step-9
 * expense lines, deals / rejections per year …). Base inputs resolve through
 * the same source adapters as metrics and are never materialised.
 *
 * Units: every input is declared with the unit the formula expects; the
 * invariant test (tests/unit/metrics/metric-invariants.test.ts) checks them
 * against the registry, and each formula's result unit against every metric
 * that uses it.
 */

import type { MetricPeriod, MetricSource } from './format'
import type { MetricEntry } from './types'

// ─── Base inputs ─────────────────────────────────────────────

const YEARS = [2025, 2024, 2023] as const
type Year = (typeof YEARS)[number]

function s(key: string, step: number, label: string, extra: Partial<MetricSource> = {}): MetricSource {
  return { type: 'survey', step, key, label, ...extra }
}
function d(doc_type: string | undefined, field: string): MetricSource {
  return doc_type ? { type: 'document', doc_type, field } : { type: 'document', field }
}
function table(row: string, column: 'y2023' | 'y2024' | 'y2025', label: string): MetricSource {
  return { type: 'survey', step: 8, key: 's8n_metrics_table', label, coerce: { kind: 'table_cell', row, column } }
}

function base(id: string, label: string, unit: string, sources: MetricSource[], period?: MetricPeriod): MetricEntry {
  return { id, namespace: 'biz', label, unit, sources, ...(period ? { period } : {}) }
}

const perYear: MetricEntry[] = YEARS.flatMap((y: Year) => {
  const col = `y${y}` as 'y2023' | 'y2024' | 'y2025'
  return [
    base(`base.revenue_${y}`, `Выручка ${y}`, '₸', [
      table('sales_amount', col, `Сумма продаж ${y}`),
      ...(y === 2024 ? [s('s9n_revenue_2024', 9, 'Выручка 2024')] : []),
      s(`s2_revenue_${y}`, 2, `Выручка ${y} (старая анкета)`, { legacy: true }),
    ], 'year'),
    base(`base.deals_${y}`, `Сделок ${y}`, 'count', [
      s(`s3_deals_${y}`, 5, `Сделок ${y}`, { zeroIsEmpty: true }),
      table('sales_count', col, `Количество продаж ${y}`),
    ], 'year'),
    base(`base.rejections_${y}`, `Отказов ${y}`, 'count', [s(`s3_rejections_${y}`, 5, `Отказов ${y}`)], 'year'),
    base(`base.new_sales_${y}`, `Новых продаж ${y}`, 'count', [table('new_sales_count', col, `Кол-во новых продаж ${y}`)], 'year'),
    base(`base.repeat_sales_${y}`, `Повторных продаж ${y}`, 'count', [table('repeat_count', col, `Кол-во повторных продаж ${y}`)], 'year'),
    base(`base.repeat_amount_${y}`, `Сумма повторных продаж ${y}`, '₸', [table('repeat_amount', col, `Сумма повторных продаж ${y}`)], 'year'),
  ]
})

export const BASE_INPUTS: readonly MetricEntry[] = [
  // Revenue of the reporting year the step-9 expense lines refer to (the
  // «Финансы» block states 2024 figures): a P&L first, then the step-9 revenue,
  // the last full year of the step-8 table, the current run-rate last. Formulas
  // that subtract expenses use it, so a 2024 COGS is not set against a 2026 run-rate.
  base('base.revenue_fin', 'Выручка отчётного года (блок «Финансы»)', '₸', [
    d('pl_report', 'revenue'),
    s('s9n_revenue_2024', 9, 'Годовая выручка 2024'),
    { type: 'survey', step: 8, key: 's8n_metrics_table', label: 'Таблица метрик: Сумма продаж (последний полный год)', coerce: { kind: 'table_cell', row: 'sales_amount', column: 'latest_full_year' } },
    s('s1_current_revenue_year', 1, 'Текущая выручка / год', { zeroIsEmpty: true }),
  ], 'year'),
  base('base.net_profit', 'Чистая прибыль', '₸', [
    d('pl_report', 'net_profit'),
    s('s9n_net_profit', 9, 'Чистая прибыль/убыток 2024'),
  ], 'year'),
  base('base.total_assets', 'Активы (баланс)', '₸', [d('balance_sheet', 'total_assets')]),
  base('base.gross_profit', 'Валовая прибыль', '₸', [d('pl_report', 'gross_profit')], 'year'),
  base('base.expense_marketing', 'Расходы: маркетинг', '₸', [s('s9n_expense_marketing', 9, 'Маркетинг и реклама', { period: 'year' })], 'year'),
  base('base.expense_rent', 'Расходы: аренда', '₸', [s('s9n_expense_rent', 9, 'Аренда, коммунальные', { period: 'year' })], 'year'),
  base('base.expense_other', 'Расходы: прочие', '₸', [s('s9n_expense_other', 9, 'Прочие расходы', { period: 'year' })], 'year'),
  base('base.debtor_days', 'Средний срок оплаты клиентами (дней)', 'days', [
    d('balance_sheet', 'ar_days'),
    s('s9n_debtor_days', 9, 'Средний срок оплаты (дебиторка, дней)'),
  ]),
  base('base.marketing_budget_pct', 'Бюджет на маркетинг, % от выручки', '%', [s('s5_marketing_budget_pct', 7, 'Бюджет на маркетинг (% от выручки)')]),
  base('base.export_revenue', 'Выручка от экспорта', '₸', [d('pl_report', 'export_revenue')], 'year'),
  base('base.sales_managers', 'Менеджеров в отделе продаж', 'count', [
    s('s4n_staffing_table', 4, 'Штатное расписание: менеджеры отдела продаж', {
      coerce: { kind: 'table_sum', column: 'manager_count', match: { column: 'department', pattern: 'продаж|sales|коммерч|сбыт' } },
    }),
  ]),
  // Churn has no period of its own (goal.02.churn_rate is «за период»). LTV
  // needs the YEARLY churn: the client-base figure is annualised from its own
  // period (field label / period, document metadata, file name, text) by
  // compounding, and is a miss when that period is unknown — never assumed.
  base('base.churn_rate_year', 'Отток клиентов за год', '%', [
    { type: 'document', doc_type: 'client_base', field: 'churn_rate', compoundRate: true },
  ], 'year'),
  base('base.funnel_lead_to_call', 'Конверсия Лид → Звонок', '%', [s('s5n_funnel_lead_to_call', 5, 'Лид -> Звонок (%)', { zeroIsEmpty: true })]),
  base('base.funnel_proposal_to_negotiation', 'Конверсия КП → Переговоры', '%', [s('s5n_funnel_proposal_to_negotiation', 5, 'КП -> Переговоры (%)', { zeroIsEmpty: true })]),
  base('base.funnel_negotiation_to_contract', 'Конверсия Переговоры → Договор', '%', [s('s5n_funnel_negotiation_to_contract', 5, 'Переговоры -> Договор (%)', { zeroIsEmpty: true })]),
  base('base.funnel_contract_to_payment', 'Конверсия Договор → Оплата', '%', [s('s5n_funnel_contract_to_payment', 5, 'Договор -> Оплата (%)', { zeroIsEmpty: true })]),
  ...perYear,
]

const BASE_BY_ID = new Map(BASE_INPUTS.map((b) => [b.id, b]))

export function getBaseInput(id: string): MetricEntry | undefined {
  return BASE_BY_ID.get(id)
}

export function isBaseInput(id: string): boolean {
  return id.startsWith('base.')
}

// ─── Formulas ────────────────────────────────────────────────

/** One way to compute the value: all `inputs` must have a value. */
export interface FormulaVariant {
  /** [input id, unit the formula expects]. */
  inputs: ReadonlyArray<readonly [string, string]>
  compute: (v: Readonly<Record<string, number>>) => number | null
  /** Shown in provenance when this variant was used. */
  note?: string
}

export interface FormulaDef {
  id: string
  /** Human formula, Russian. */
  text: string
  /** Unit of the result. */
  unit: string
  /** Tried in order; the first variant whose inputs all resolve wins. */
  variants: readonly FormulaVariant[]
}

const REV = 'biz.finansy.vyruchka_god'
const REV_FIN = 'base.revenue_fin'
const COGS = 'kpi.sebestoimost_kpi'
const OPEX = 'biz.finansy.operatsionnye_raskhody'
const AD_SPEND = 'goal.01.raskhody_na_reklamu'
const NEW_CLIENTS = 'goal.01.kolichestvo_novykh_klientov'
const LEADS_MONTH = 'biz.marketing.lidov_v_mes'
const ACTIVE_CLIENTS = 'biz.klienty.aktivnykh_klientov'
const ARPU = 'biz.klienty.arpu'
const CAC = 'biz.marketing.cac'
const LTV = 'goal.04.ltv'
const GROSS_MARGIN = 'biz.finansy.valovaya_marzha'
const EMPLOYEES = 'biz.hr.kol_vo_sotrudnikov'
const QUALIFIED_LEADS = 'goal.01.kolichestvo_tselevykh_lidov'
const CHURN_YEAR = 'base.churn_rate_year'
const TIME_BETWEEN = 'goal.02.time_between_purchases'
const REFERRAL_CLIENTS = 'goal.05.referral_rate_kol_vo'
const COMPETITOR_CLIENTS = 'goal.06.kol_vo_klientov_ot_konkurentov'

const pct = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null)
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const share = (x: number | null): number | null => (x === null || x < 0 || x > 100 ? null : x)

/** One variant per year (latest first) — inputs of one variant are of the same year. */
function byYear(
  ids: (y: Year) => ReadonlyArray<readonly [string, string]>,
  compute: (v: Readonly<Record<string, number>>, y: Year) => number | null,
): FormulaVariant[] {
  return YEARS.map((y) => ({ inputs: ids(y), compute: (v) => compute(v, y), note: `данные ${y} года` }))
}

const DEFS: FormulaDef[] = [
  {
    id: 'gross_margin',
    text: '(Выручка − Себестоимость) ÷ Выручка × 100%',
    unit: '%',
    variants: [
      { inputs: [[REV_FIN, '₸'], [COGS, '₸']], compute: (v) => (v[REV_FIN] > 0 ? ((v[REV_FIN] - v[COGS]) / v[REV_FIN]) * 100 : null) },
      { inputs: [['base.gross_profit', '₸'], [REV_FIN, '₸']], compute: (v) => pct(v['base.gross_profit'], v[REV_FIN]), note: 'валовая прибыль ÷ выручка' },
    ],
  },
  {
    id: 'ebitda',
    text: 'Выручка − Себестоимость − Операционные расходы',
    unit: '₸',
    variants: [{
      inputs: [[REV_FIN, '₸'], [COGS, '₸'], [OPEX, '₸']],
      compute: (v) => v[REV_FIN] - v[COGS] - v[OPEX],
      note: 'оценка: «прочие расходы» могут включать налоги и проценты',
    }],
  },
  {
    id: 'roa',
    text: 'Чистая прибыль ÷ Активы × 100%',
    unit: '%',
    variants: [{ inputs: [['base.net_profit', '₸'], ['base.total_assets', '₸']], compute: (v) => pct(v['base.net_profit'], v['base.total_assets']) }],
  },
  {
    id: 'opex',
    text: 'Маркетинг + Аренда + Прочие расходы (шаг 9)',
    unit: '₸',
    variants: [{
      inputs: [['base.expense_marketing', '₸'], ['base.expense_rent', '₸'], ['base.expense_other', '₸']],
      compute: (v) => v['base.expense_marketing'] + v['base.expense_rent'] + v['base.expense_other'],
    }],
  },
  {
    id: 'receivables_from_dso',
    text: 'Выручка за год ÷ 365 × Средний срок оплаты (дней)',
    unit: '₸',
    variants: [{
      inputs: [[REV, '₸'], ['base.debtor_days', 'days']],
      compute: (v) => (v['base.debtor_days'] >= 0 ? (v[REV] / 365) * v['base.debtor_days'] : null),
      note: 'оценка по сроку оплаты',
    }],
  },
  {
    id: 'cac',
    text: 'Расходы на рекламу за год ÷ Новые клиенты за год',
    unit: '₸',
    variants: [{
      inputs: [[AD_SPEND, '₸'], [NEW_CLIENTS, 'count']],
      compute: (v) => div(v[AD_SPEND], v[NEW_CLIENTS]),
      note: 'без расходов на отдел продаж — нижняя оценка CAC',
    }],
  },
  {
    id: 'ltv_cac',
    text: 'LTV ÷ CAC',
    unit: '',
    variants: [{ inputs: [[LTV, '₸'], [CAC, '₸']], compute: (v) => div(v[LTV], v[CAC]) }],
  },
  {
    id: 'cpl',
    text: 'Расходы на рекламу в месяц ÷ Лидов в месяц',
    unit: '₸',
    variants: [{ inputs: [[AD_SPEND, '₸'], [LEADS_MONTH, 'count']], compute: (v) => div(v[AD_SPEND] / 12, v[LEADS_MONTH]) }],
  },
  {
    id: 'lead_to_client',
    text: 'Новые клиенты в месяц ÷ Лидов в месяц × 100%',
    unit: '%',
    variants: [{ inputs: [[NEW_CLIENTS, 'count'], [LEADS_MONTH, 'count']], compute: (v) => share(pct(v[NEW_CLIENTS] / 12, v[LEADS_MONTH])) }],
  },
  {
    id: 'avg_check',
    text: 'Выручка ÷ Количество сделок (за один год)',
    unit: '₸',
    variants: byYear((y) => [[`base.revenue_${y}`, '₸'], [`base.deals_${y}`, 'count']], (v, y) => div(v[`base.revenue_${y}`], v[`base.deals_${y}`])),
  },
  {
    id: 'win_rate',
    text: 'Сделки ÷ (Сделки + Отказы) × 100% (за один год)',
    unit: '%',
    variants: byYear((y) => [[`base.deals_${y}`, 'count'], [`base.rejections_${y}`, 'count']], (v, y) => pct(v[`base.deals_${y}`], v[`base.deals_${y}`] + v[`base.rejections_${y}`])),
  },
  {
    id: 'loss_rate',
    text: 'Отказы ÷ (Сделки + Отказы) × 100% (за один год)',
    unit: '%',
    variants: byYear((y) => [[`base.deals_${y}`, 'count'], [`base.rejections_${y}`, 'count']], (v, y) => pct(v[`base.rejections_${y}`], v[`base.deals_${y}`] + v[`base.rejections_${y}`])),
  },
  {
    id: 'proposal_to_sale',
    text: 'КП→Переговоры × Переговоры→Договор × Договор→Оплата',
    unit: '%',
    variants: [{
      inputs: [['base.funnel_proposal_to_negotiation', '%'], ['base.funnel_negotiation_to_contract', '%'], ['base.funnel_contract_to_payment', '%']],
      compute: (v) => share((v['base.funnel_proposal_to_negotiation'] * v['base.funnel_negotiation_to_contract'] * v['base.funnel_contract_to_payment']) / 10_000),
    }],
  },
  {
    id: 'arpu',
    text: 'Выручка за год ÷ Активные клиенты',
    unit: '₸',
    variants: [{ inputs: [[REV, '₸'], [ACTIVE_CLIENTS, 'count']], compute: (v) => div(v[REV], v[ACTIVE_CLIENTS]) }],
  },
  {
    id: 'revenue_per_seller',
    text: 'Выручка за год ÷ Менеджеров в отделе продаж',
    unit: '₸',
    variants: [{ inputs: [[REV, '₸'], ['base.sales_managers', 'count']], compute: (v) => div(v[REV], v['base.sales_managers']) }],
  },
  {
    id: 'productivity',
    text: 'Выручка за год ÷ Количество сотрудников',
    unit: '₸',
    variants: [{ inputs: [[REV, '₸'], [EMPLOYEES, 'count']], compute: (v) => div(v[REV], v[EMPLOYEES]) }],
  },
  {
    id: 'export_share',
    text: 'Выручка от экспорта ÷ Выручка × 100%',
    unit: '%',
    variants: [{ inputs: [['base.export_revenue', '₸'], [REV, '₸']], compute: (v) => share(pct(v['base.export_revenue'], v[REV])) }],
  },
  {
    id: 'ad_spend_from_budget_pct',
    text: 'Бюджет на маркетинг (% от выручки) × Выручка за год',
    unit: '₸',
    variants: [{ inputs: [['base.marketing_budget_pct', '%'], [REV, '₸']], compute: (v) => (v['base.marketing_budget_pct'] >= 0 ? (v['base.marketing_budget_pct'] / 100) * v[REV] : null) }],
  },
  {
    id: 'qualified_leads',
    text: 'Лидов в месяц × Конверсия Лид → Звонок',
    unit: 'count',
    variants: [{
      inputs: [[LEADS_MONTH, 'count'], ['base.funnel_lead_to_call', '%']],
      compute: (v) => Math.round((v[LEADS_MONTH] * v['base.funnel_lead_to_call']) / 100),
      note: 'целевые = лиды, дошедшие до разговора (Лид → Звонок)',
    }],
  },
  {
    id: 'cost_per_qualified_lead',
    text: 'Расходы на рекламу в месяц ÷ Целевых лидов в месяц',
    unit: '₸',
    variants: [{ inputs: [[AD_SPEND, '₸'], [QUALIFIED_LEADS, 'count']], compute: (v) => div(v[AD_SPEND] / 12, v[QUALIFIED_LEADS]) }],
  },
  {
    id: 'repeat_sales_share',
    text: 'Повторные продажи ÷ (Новые + Повторные) × 100% (за один год)',
    unit: '%',
    variants: byYear(
      (y) => [[`base.new_sales_${y}`, 'count'], [`base.repeat_sales_${y}`, 'count']],
      (v, y) => pct(v[`base.repeat_sales_${y}`], v[`base.new_sales_${y}`] + v[`base.repeat_sales_${y}`]),
    ).map((x) => ({ ...x, note: `${x.note}; доля повторных продаж (таблица шага 8)` })),
  },
  {
    id: 'repeat_revenue_share',
    text: 'Сумма повторных продаж ÷ Выручка × 100% (за один год)',
    unit: '%',
    variants: byYear(
      (y) => [[`base.repeat_amount_${y}`, '₸'], [`base.revenue_${y}`, '₸']],
      (v, y) => share(pct(v[`base.repeat_amount_${y}`], v[`base.revenue_${y}`])),
    ),
  },
  {
    id: 'purchases_per_client',
    text: 'Сделок за год ÷ Активные клиенты',
    unit: '',
    variants: [
      ...byYear((y) => [[`base.deals_${y}`, 'count'], [ACTIVE_CLIENTS, 'count']], (v, y) => div(v[`base.deals_${y}`], v[ACTIVE_CLIENTS])),
    ],
  },
  {
    id: 'purchase_frequency',
    text: 'Сделок за год ÷ Активные клиенты; иначе 365 ÷ Дней между покупками',
    unit: 'раз/год',
    variants: [
      ...byYear((y) => [[`base.deals_${y}`, 'count'], [ACTIVE_CLIENTS, 'count']], (v, y) => div(v[`base.deals_${y}`], v[ACTIVE_CLIENTS])),
      { inputs: [[TIME_BETWEEN, 'days']], compute: (v) => div(365, v[TIME_BETWEEN]), note: 'для повторного покупателя: 365 ÷ дней между покупками' },
    ],
  },
  {
    id: 'ltv_from_churn',
    text: 'Доход на клиента за год ÷ Отток за год (доля)',
    unit: '₸',
    variants: [{
      inputs: [[ARPU, '₸'], [CHURN_YEAR, '%']],
      compute: (v) => (v[CHURN_YEAR] > 0 && v[CHURN_YEAR] <= 100 ? v[ARPU] / (v[CHURN_YEAR] / 100) : null),
      note: 'отток приведён к году по периоду, указанному в документе',
    }],
  },
  {
    id: 'cac_payback',
    text: 'CAC ÷ (Доход на клиента в месяц × Валовая маржа)',
    unit: 'мес',
    variants: [{
      inputs: [[CAC, '₸'], [ARPU, '₸'], [GROSS_MARGIN, '%']],
      compute: (v) => (v[GROSS_MARGIN] > 0 ? div(v[CAC], (v[ARPU] / 12) * (v[GROSS_MARGIN] / 100)) : null),
    }],
  },
  {
    id: 'referral_share',
    text: 'Клиенты по рекомендации ÷ Новые клиенты × 100%',
    unit: '%',
    variants: [{ inputs: [[REFERRAL_CLIENTS, 'count'], [NEW_CLIENTS, 'count']], compute: (v) => share(pct(v[REFERRAL_CLIENTS], v[NEW_CLIENTS])) }],
  },
  {
    id: 'competitor_share',
    text: 'Клиенты, пришедшие от конкурентов ÷ Новые клиенты × 100%',
    unit: '%',
    variants: [{ inputs: [[COMPETITOR_CLIENTS, 'count'], [NEW_CLIENTS, 'count']], compute: (v) => share(pct(v[COMPETITOR_CLIENTS], v[NEW_CLIENTS])) }],
  },
]

export const METRIC_FORMULAS: Readonly<Record<string, FormulaDef>> = Object.fromEntries(DEFS.map((f) => [f.id, f]))

export function getFormula(id: string | undefined): FormulaDef | undefined {
  return id ? METRIC_FORMULAS[id] : undefined
}

/** Every input id of a formula (all variants). */
export function formulaInputIds(def: FormulaDef): string[] {
  return Array.from(new Set(def.variants.flatMap((v) => v.inputs.map(([id]) => id))))
}
