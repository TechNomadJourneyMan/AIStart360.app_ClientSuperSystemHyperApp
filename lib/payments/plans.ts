/**
 * Plan catalog. Mirrors the landing-page pricing. Amounts are integer minor
 * units (cents). `interval` distinguishes recurring subscriptions from one-time
 * (hybrid) purchases; `null` interval = one-time / trial.
 */

export type PlanInterval = 'month' | 'year' | null

export type PlanKind = 'trial' | 'subscription' | 'one_time'

export interface Plan {
  key: string
  kind: PlanKind
  /** Integer minor units (cents). 0 = free. */
  amount: number
  /** ISO 4217 currency code. */
  currency: string
  /** Billing interval for subscriptions; null for trial / one-time. */
  interval: PlanInterval
  /** Trial length in days, if the plan grants one. */
  trialDays?: number
  /** Russian-language UI label. */
  label: string
  /** Russian-language description. */
  description: string
}

export const PLANS = {
  pilot: {
    key: 'pilot',
    kind: 'trial',
    amount: 0,
    currency: 'USD',
    interval: null,
    trialDays: 30,
    label: 'Пилот',
    description:
      'Бесплатный пробный период на 30 дней. Полный доступ к диагностике GRI и Точкам A/B без оплаты.',
  },
  pro_monthly: {
    key: 'pro_monthly',
    kind: 'subscription',
    amount: 30000, // $300.00
    currency: 'USD',
    interval: 'month',
    label: 'Pro (ежемесячно)',
    description:
      'Подписка Pro: полный доступ ко всем модулям, обновления метрик в реальном времени и поддержка. $300 в месяц.',
  },
  pro_onetime: {
    key: 'pro_onetime',
    kind: 'one_time',
    amount: 14900, // $149.00
    currency: 'USD',
    interval: null,
    label: 'Pro (разовый доступ)',
    description:
      'Разовая покупка: единовременный доступ Pro к диагностике и стратегии без ежемесячной подписки. $149.',
  },
} satisfies Record<string, Plan>

export type PlanKey = keyof typeof PLANS

/** Look up a plan by key, or undefined if unknown. */
export function getPlan(key: string): Plan | undefined {
  return (PLANS as Record<string, Plan>)[key]
}
