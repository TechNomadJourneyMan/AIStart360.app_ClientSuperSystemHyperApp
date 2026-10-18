/**
 * lib/point-b/model/levels.ts — which level of data the client has and which model it allows
 * (spec §5), and what is missing for the next step (spec §7.3). Pure.
 *
 *   level 0            no goal or no base revenue: only what can be said without a model
 *   level 1 / funnel   base, goal, leads, conversion, check, in an e-commerce / services template
 *   level 1 / growth   base and goal, but no funnel (other template, or no levers)
 *   level 2            not issued in this phase
 */
import { pickTemplate } from '@/lib/point-a/v4/config'
import type { DataLevel, MissingInput, ModelInputs, ModelKind, TemplateKey } from './types'

const TEMPLATE_KEYS: readonly TemplateKey[] = ['default', 'ecommerce', 'services', 'production']

/** Templates whose business is a flow of leads → customers (the funnel model fits). */
export const FUNNEL_TEMPLATES: readonly TemplateKey[] = ['ecommerce', 'services']

/** The Point A industry template of a company; an unknown industry is `default`. */
export function templateKeyFor(industry: string | null | undefined): TemplateKey {
  const key = pickTemplate(industry).key as TemplateKey
  return TEMPLATE_KEYS.includes(key) ? key : 'default'
}

const has = (s: { value: number | null }): boolean => typeof s.value === 'number' && Number.isFinite(s.value) && s.value > 0

const MISSING: Record<string, Omit<MissingInput, 'key'>> = {
  goal: {
    label: 'Цель по годовой выручке и срок',
    unlocks: 'Разрыв до цели и темп роста, который нужен',
    level: 1,
    actions: ['survey', 'expert'],
  },
  revenue_base: {
    label: 'Текущая годовая выручка',
    unlocks: 'Отправная точка: без неё разрыв, прогноз и сценарии не посчитать',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
  leads: {
    label: 'Лиды в месяц',
    unlocks: 'Разбор цели по воронке: сколько лидов нужно добавить',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
  conversion: {
    label: 'Конверсия из лида в клиента',
    unlocks: 'Разбор цели по воронке: какая конверсия нужна',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
  avgCheck: {
    label: 'Средний чек',
    unlocks: 'Разбор цели по воронке: каким должен быть чек',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
  repeat: {
    label: 'Повторные продажи (доля клиентов, купивших снова за 12 месяцев)',
    unlocks: 'Учёт повторных заказов в прогнозе и вклад удержания в сценарии',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
  cac: {
    label: 'Стоимость привлечения клиента (CAC)',
    unlocks: 'Оценка роста маркетингового бюджета под сценарий',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
  headcount: {
    label: 'Число сотрудников',
    unlocks: 'Оценка потребности в персонале под сценарий',
    level: 1,
    actions: ['survey', 'documents', 'expert'],
  },
}

export const missingInput = (key: keyof typeof MISSING): MissingInput => ({ key, ...MISSING[key] })

export function determineLevel(i: ModelInputs): { level: DataLevel; kind: ModelKind; missing: MissingInput[] } {
  const missing: MissingInput[] = []
  if (!i.goal) missing.push(missingInput('goal'))
  if (!has(i.base.revenueYear)) missing.push(missingInput('revenue_base'))
  if (missing.length) return { level: 0, kind: 'none', missing }

  const funnelData = has(i.levers.leads) && has(i.levers.conversion) && has(i.levers.avgCheck)
  if (funnelData && FUNNEL_TEMPLATES.includes(i.template)) {
    // Optional inputs that make the funnel scenarios fuller.
    if (!has(i.levers.repeat)) missing.push(missingInput('repeat'))
    if (!has(i.levers.cac)) missing.push(missingInput('cac'))
    if (!has(i.levers.headcount)) missing.push(missingInput('headcount'))
    return { level: 1, kind: 'funnel', missing }
  }

  if (!has(i.levers.leads)) missing.push(missingInput('leads'))
  if (!has(i.levers.conversion)) missing.push(missingInput('conversion'))
  if (!has(i.levers.avgCheck)) missing.push(missingInput('avgCheck'))
  if (!has(i.levers.headcount)) missing.push(missingInput('headcount'))
  return { level: 1, kind: 'growth', missing }
}
