'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  PLAN_SOURCE_LABEL,
  PLAN_STATUS_LABEL,
  PLAN_TIER_LABEL,
  type PlanSource,
  type PlanStatus,
  type PlanTier,
} from '@/lib/payments/plan-state'

/** What /api/v1/settings/billing returns: the unified effective plan. */
export interface BillingPlan {
  tier: PlanTier
  status: PlanStatus
  periodEnd: string | null
  source: PlanSource | null
  provider: string | null
  accessTier: 'free' | 'pro'
}

const STATUS_CLS: Record<PlanStatus, string> = {
  trialing: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
  active: 'text-primary bg-primary/10 border-primary/30',
  past_due: 'text-error bg-error/10 border-error/30',
  expired: 'text-error bg-error/10 border-error/30',
  canceled: 'text-on-surface-variant bg-white/[0.04] border-white/10',
  free: 'text-on-surface-variant bg-white/[0.04] border-white/10',
}

const PROVIDER_LABEL: Record<string, string> = {
  kaspi: 'Kaspi.kz',
  stripe: 'Stripe',
  cloudpayments: 'CloudPayments',
  halyk: 'Halyk Pay',
  mir: 'Мир',
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-high rounded-lg p-3">
      <dt className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">{label}</dt>
      <dd className="text-on-surface font-medium">{children}</dd>
    </div>
  )
}

/** Stateless view of the effective plan (rendered by tests with react-dom/server). */
export function BillingPlanView({ plan }: { plan: BillingPlan }) {
  const end = formatDate(plan.periodEnd)
  const isFree = plan.tier === 'free'
  const endLabel = plan.status === 'trialing' ? 'Пробный до' : plan.status === 'expired' ? 'Срок истёк' : 'Действует до'

  if (isFree) {
    return (
      <div className="text-center py-6" data-plan-tier="free">
        <span className="material-symbols-outlined text-3xl text-primary/40 block mb-2">rocket_launch</span>
        <p className="text-on-surface font-medium">Бесплатный доступ</p>
        <p className="text-sm text-on-surface-variant mt-1 max-w-sm mx-auto">
          {plan.status === 'canceled'
            ? plan.source === 'system'
              ? 'Срок прошлого тарифа закончился — открыт бесплатный доступ.'
              : 'Прошлый тариф завершён — открыт бесплатный доступ.'
            : 'Тариф не подключён. Чтобы открыть полную диагностику и сопровождение роста, выберите тариф.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-plan-tier={plan.tier} data-plan-source={plan.source ?? ''}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl font-bold text-primary">{PLAN_TIER_LABEL[plan.tier]}</span>
        <span className={`text-xs font-mono uppercase tracking-wider rounded-full px-2.5 py-1 border ${STATUS_CLS[plan.status]}`}>
          {PLAN_STATUS_LABEL[plan.status]}
        </span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        {plan.source && <Fact label="Как подключён">{capitalize(PLAN_SOURCE_LABEL[plan.source])}</Fact>}
        <Fact label={endLabel}>{end ?? 'Бессрочно'}</Fact>
        {plan.source === 'kaspi' && plan.provider && (
          <Fact label="Способ оплаты">{PROVIDER_LABEL[plan.provider] ?? plan.provider}</Fact>
        )}
      </dl>
      {plan.status === 'expired' && (
        <p className="text-xs text-error">
          Срок тарифа закончился. Доступ будет переведён на бесплатный — чтобы продлить, обратитесь к администратору.
        </p>
      )}
      {plan.source === 'admin' && plan.status !== 'expired' && (
        <p className="text-xs text-on-surface-variant">
          Тариф назначен администратором платформы, оплата через сайт не проводилась.
        </p>
      )}
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function BillingPanel() {
  const [plan, setPlan] = useState<BillingPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/settings/billing', { credentials: 'include' })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || !json.ok || !json.data) {
          setError(json.error || `Ошибка ${res.status}`)
        } else {
          setPlan(json.data as BillingPlan)
        }
      } catch {
        if (!cancelled) setError('Не удалось загрузить данные тарифа')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="bg-surface-container rounded-xl p-6 h-48 skeleton" />
  }

  if (error || !plan) {
    return (
      <div className="bg-surface-container rounded-xl p-6 text-sm text-error">
        {error ?? 'Не удалось загрузить данные тарифа'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface-container rounded-xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <span className="material-symbols-outlined text-xl text-primary/70 mt-0.5">credit_card</span>
          <div>
            <h3 className="font-headline text-lg font-bold text-on-surface">Тариф и подписка</h3>
            <p className="text-sm text-on-surface-variant mt-0.5">Ваш текущий план и срок действия</p>
          </div>
        </div>
        <BillingPlanView plan={plan} />
      </div>

      {/* Online payment is not connected yet: the plan is assigned by an administrator. */}
      <div className="bg-surface-container rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-on-surface">Сменить или оформить тариф</h4>
          <p className="text-xs text-on-surface-variant mt-1">
            Пилот · Pro · Enterprise — сравнение и стоимость. Пока онлайн-оплата подключается, тариф назначает администратор.
          </p>
        </div>
        <Link
          href="/gri-free"
          className="inline-flex items-center gap-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold px-5 py-2.5 rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-base">upgrade</span>
          Выбрать тариф
        </Link>
      </div>

      <div className="bg-surface-container-low rounded-xl p-5 border border-white/[0.04]">
        <p className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Скоро</p>
        <ul className="text-sm text-on-surface-variant space-y-1.5">
          <li className="flex items-center gap-2"><span className="material-symbols-outlined text-sm text-on-surface-variant/50">receipt_long</span> История платежей</li>
          <li className="flex items-center gap-2"><span className="material-symbols-outlined text-sm text-on-surface-variant/50">tune</span> Онлайн-оплата и автопродление</li>
        </ul>
      </div>
    </div>
  )
}
