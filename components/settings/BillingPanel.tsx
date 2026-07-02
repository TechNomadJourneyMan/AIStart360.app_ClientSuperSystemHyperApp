'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Subscription {
  orgId: string
  tier: string
  status: string
  provider: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

const TIER_LABEL: Record<string, string> = {
  pilot: 'Пилот',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'Пробный период', cls: 'text-amber-300 bg-amber-400/10 border-amber-400/30' },
  active: { label: 'Активна', cls: 'text-primary bg-primary/10 border-primary/30' },
  past_due: { label: 'Просрочена', cls: 'text-error bg-error/10 border-error/30' },
  canceled: { label: 'Отменена', cls: 'text-on-surface-variant bg-white/[0.04] border-white/10' },
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function BillingPanel() {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/settings/billing', { credentials: 'include' })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || !json.ok) {
          setError(json.error || `Ошибка ${res.status}`)
        } else {
          setSub(json.data ?? null)
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

  if (error) {
    return (
      <div className="bg-surface-container rounded-xl p-6 text-sm text-error">
        {error}
      </div>
    )
  }

  const status = sub ? STATUS_META[sub.status] ?? STATUS_META.trialing : null
  const tierLabel = sub ? TIER_LABEL[sub.tier] ?? sub.tier : null
  const renewal = sub ? formatDate(sub.currentPeriodEnd) : null
  const trialEnd = sub ? formatDate(sub.trialEndsAt) : null

  return (
    <div className="space-y-6">
      <div className="bg-surface-container rounded-xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <span className="material-symbols-outlined text-xl text-primary/70 mt-0.5">credit_card</span>
          <div>
            <h3 className="font-headline text-lg font-bold text-on-surface">Тариф и подписка</h3>
            <p className="text-sm text-on-surface-variant mt-0.5">Ваш текущий план и статус оплаты</p>
          </div>
        </div>

        {sub ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-2xl font-bold text-primary">{tierLabel}</span>
              {status && (
                <span className={`text-xs font-mono uppercase tracking-wider rounded-full px-2.5 py-1 border ${status.cls}`}>
                  {status.label}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {trialEnd && sub.status === 'trialing' && (
                <div className="bg-surface-container-high rounded-lg p-3">
                  <dt className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Пробный до</dt>
                  <dd className="text-on-surface font-medium">{trialEnd}</dd>
                </div>
              )}
              {renewal && (
                <div className="bg-surface-container-high rounded-lg p-3">
                  <dt className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Продление</dt>
                  <dd className="text-on-surface font-medium">{renewal}</dd>
                </div>
              )}
              {sub.provider && (
                <div className="bg-surface-container-high rounded-lg p-3">
                  <dt className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Способ оплаты</dt>
                  <dd className="text-on-surface font-medium capitalize">{sub.provider}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <div className="text-center py-6">
            <span className="material-symbols-outlined text-3xl text-primary/40 block mb-2">rocket_launch</span>
            <p className="text-on-surface font-medium">Активной подписки нет</p>
            <p className="text-sm text-on-surface-variant mt-1 max-w-sm mx-auto">
              Вы на бесплатном доступе. Оформите тариф, чтобы открыть полную диагностику и сопровождение роста.
            </p>
          </div>
        )}
      </div>

      {/* Upgrade CTA — routes to the public plans page. History of payments and
          self-serve payment management are honest roadmap items below. */}
      <div className="bg-surface-container rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-on-surface">Сменить или оформить тариф</h4>
          <p className="text-xs text-on-surface-variant mt-1">Пилот · Pro · Enterprise — сравнение и стоимость</p>
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
          <li className="flex items-center gap-2"><span className="material-symbols-outlined text-sm text-on-surface-variant/50">tune</span> Управление оплатой и автопродление</li>
        </ul>
      </div>
    </div>
  )
}
