/**
 * lib/point-b/finmodel/keys.ts — the 11 inputs of the «Финмодель» (level 2 of Point B, spec §5, §7):
 * what they mean, in which unit and range they are typed, where to find the number, what they unlock.
 *
 * Percent keys are stored as FRACTIONS (0.1 = 10%); days are days; money is KZT. The keys live in the
 * table pb_finmodel_inputs (migration 126), NOT in the metric registry of Point A — the registry is
 * untouched on purpose, so the Point A coverage and the survey progress do not move.
 *
 * Pure, no IO. The UI imports `FINMODEL_DEFS` (labels, hints, ranges) and the types from here.
 */
import type { TemplateKey } from '../model/types'

export const FINMODEL_KEYS = [
  'cash_balance',
  'fixed_costs_month',
  'payroll_month',
  'debt_total',
  'debt_service_month',
  'interest_rate_annual',
  'dso_days',
  'dio_days',
  'dpo_days',
  'tax_rate',
  'capex_year',
] as const
export type FinmodelKey = (typeof FINMODEL_KEYS)[number]

export interface FinmodelKeyDef {
  key: FinmodelKey
  label: string
  /** '%' values are stored as fractions 0..1. */
  unit: '₸' | '%' | 'days'
  min: number
  max: number
  /** Where to take the number. */
  hint: string
  /** A hard input of level 2: no safe default exists. */
  required: boolean
  /** The key is required when this holds (debt service and interest when there is a debt). */
  requiredIf?: (v: Partial<Record<FinmodelKey, number | null>>) => boolean
  /** The questionnaire key the value is read from when nobody typed it. */
  surveyKey?: string
  /** The platform metric the value is read from when nobody typed it. */
  metricId?: string
  /** What opens once the value is there. */
  unlocks: string
  /** The group on the form. */
  group: 'money' | 'costs' | 'debt' | 'nwc_tax'
}

const MONEY_MAX = 1e12

export const FINMODEL_DEFS: Record<FinmodelKey, FinmodelKeyDef> = {
  cash_balance: {
    key: 'cash_balance', label: 'Деньги на счетах и в кассе', unit: '₸', min: 0, max: MONEY_MAX,
    hint: 'Сумма на расчётных счетах и в кассе на сегодня — по выписке банка или остаткам из учётной системы.',
    required: true, group: 'money',
    unlocks: 'Касса по месяцам, кассовый разрыв и потребность в финансировании',
  },
  fixed_costs_month: {
    key: 'fixed_costs_month', label: 'Постоянные расходы в месяц', unit: '₸', min: 0, max: MONEY_MAX,
    hint: 'Аренда, коммунальные, сервисы и прочие расходы, которые не зависят от продаж. Без зарплаты и рекламы. Считается из «Аренда» и «Прочие расходы» анкеты (шаг 9), если они указаны числом.',
    required: true, group: 'costs', surveyKey: 's9n_expense_rent',
    unlocks: 'Операционная прибыль и точка безубыточности',
  },
  payroll_month: {
    key: 'payroll_month', label: 'Фонд оплаты труда в месяц', unit: '₸', min: 0, max: MONEY_MAX,
    hint: 'Зарплаты всех сотрудников вместе с налогами и взносами за месяц — из расчётной ведомости или бухгалтерии.',
    required: true, group: 'costs',
    unlocks: 'Операционная прибыль и стоимость найма под рост',
  },
  debt_total: {
    key: 'debt_total', label: 'Долг по кредитам и займам', unit: '₸', min: 0, max: MONEY_MAX,
    hint: 'Остаток основного долга по всем кредитам и займам на сегодня. Если долгов нет, введите 0.',
    required: true, group: 'debt', surveyKey: 's9n_debts_amount',
    unlocks: 'Платежи по долгу в денежном потоке',
  },
  debt_service_month: {
    key: 'debt_service_month', label: 'Платёж по кредитам в месяц', unit: '₸', min: 0, max: MONEY_MAX,
    hint: 'Сколько в месяц уходит на погашение кредитов — проценты вместе с основным долгом, по графику платежей.',
    required: false, requiredIf: (v) => (v.debt_total ?? 0) > 0, group: 'debt',
    unlocks: 'Срок погашения долга и нагрузка на денежный поток',
  },
  interest_rate_annual: {
    key: 'interest_rate_annual', label: 'Ставка по кредитам, % годовых', unit: '%', min: 0, max: 1,
    hint: 'Средневзвешенная годовая ставка по кредитам и займам — из кредитных договоров. Вводится в процентах.',
    required: false, requiredIf: (v) => (v.debt_total ?? 0) > 0, group: 'debt',
    unlocks: 'Проценты по долгу и чистая прибыль',
  },
  dso_days: {
    key: 'dso_days', label: 'Срок оплаты клиентами, дней', unit: 'days', min: 0, max: 365,
    hint: 'Через сколько дней после отгрузки в среднем платят клиенты. Берётся из анкеты (шаг 9); иначе принят по отрасли.',
    required: false, group: 'nwc_tax', surveyKey: 's9n_debtor_days', metricId: 'biz.finansy.debitorskaya_zadolzhennost',
    unlocks: 'Деньги, застрявшие в дебиторке при росте продаж',
  },
  dio_days: {
    key: 'dio_days', label: 'Оборачиваемость запасов, дней', unit: 'days', min: 0, max: 365,
    hint: 'На сколько дней продаж хватает запасов на складе. Без склада — 0. Если не указано, принято по отрасли.',
    required: false, group: 'nwc_tax',
    unlocks: 'Деньги, замороженные в запасах при росте продаж',
  },
  dpo_days: {
    key: 'dpo_days', label: 'Срок оплаты поставщикам, дней', unit: 'days', min: 0, max: 365,
    hint: 'Через сколько дней вы в среднем платите поставщикам. Если не указано, принято по отрасли.',
    required: false, group: 'nwc_tax',
    unlocks: 'Отсрочка поставщиков, которая облегчает денежный поток',
  },
  tax_rate: {
    key: 'tax_rate', label: 'Налоговая нагрузка, % от прибыли', unit: '%', min: 0, max: 1,
    hint: 'Эффективная ставка налога на прибыль или упрощённого режима — у бухгалтера. Вводится в процентах. Если не указано, принято 10%.',
    required: false, group: 'nwc_tax',
    unlocks: 'Налоги и чистая прибыль',
  },
  capex_year: {
    key: 'capex_year', label: 'Капитальные затраты за год', unit: '₸', min: 0, max: MONEY_MAX,
    hint: 'Оборудование, ремонт, автомобили, лицензии — всё, что планируется купить на год вперёд. Если не планируется, введите 0.',
    required: true, group: 'nwc_tax',
    unlocks: 'Плановые траты на развитие в денежном потоке',
  },
}

export const FINMODEL_GROUPS: ReadonlyArray<{ id: FinmodelKeyDef['group']; label: string }> = [
  { id: 'money', label: 'Деньги' },
  { id: 'costs', label: 'Расходы и люди' },
  { id: 'debt', label: 'Долги' },
  { id: 'nwc_tax', label: 'Оборотный капитал и налог' },
]

export function isFinmodelKey(k: unknown): k is FinmodelKey {
  return typeof k === 'string' && (FINMODEL_KEYS as readonly string[]).includes(k)
}

type Defaults = Pick<Record<FinmodelKey, number>, 'tax_rate' | 'dso_days' | 'dio_days' | 'dpo_days'>

const DAYS: Record<TemplateKey, { dso: number; dio: number; dpo: number }> = {
  ecommerce: { dso: 3, dio: 45, dpo: 20 },
  services: { dso: 21, dio: 0, dpo: 0 },
  production: { dso: 30, dio: 60, dpo: 30 },
  default: { dso: 14, dio: 20, dpo: 15 },
}

/** The industry assumptions for the only keys that may have defaults: tax and the working-capital days. */
export function templateDefaults(template: TemplateKey): Defaults {
  const d = DAYS[template] ?? DAYS.default
  return { tax_rate: 0.1, dso_days: d.dso, dio_days: d.dio, dpo_days: d.dpo }
}

/** The keys that may take a default (and only these). */
export const DEFAULTABLE_KEYS: readonly FinmodelKey[] = ['tax_rate', 'dso_days', 'dio_days', 'dpo_days']
