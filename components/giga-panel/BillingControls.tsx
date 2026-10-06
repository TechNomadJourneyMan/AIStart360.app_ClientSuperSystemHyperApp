'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  PLAN_SOURCE_LABEL,
  PLAN_STATUS_LABEL,
  PLAN_TIER_LABEL,
  PLAN_TIERS,
  type EffectivePlan,
  type PlanTier,
} from '@/lib/payments/plan-state'

// ─── Тариф клиента в GIGA (W8) ───────────────────────────────────────────────
// Онлайн-эквайринг пока заглушка: тариф назначает администратор. Редактор пишет
// через PATCH /api/giga-admin/users/[id]/billing → billing-сервис
// (subscriptions + profiles.tier одной транзакцией, журнал до изменения).
// История платежей — только чтение.

interface Payment {
  id: string
  provider: string
  amount: number
  currency: string
  planKey: string | null
  status: string
  createdAt: string | null
  amountKzt: number | null
}

const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  succeeded: { label: 'Оплачен', cls: 'text-emerald-300' },
  pending: { label: 'Ожидает', cls: 'text-amber-300' },
  failed: { label: 'Ошибка', cls: 'text-red-300' },
  stub: { label: 'Демо, без списания', cls: 'text-slate-400' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function fmtMoney(p: Payment): string {
  const major = (p.amount / 100).toLocaleString('ru-RU')
  const base = p.currency === 'USD' ? `$${major}` : `${major} ${p.currency}`
  return p.amountKzt ? `${base} (${p.amountKzt.toLocaleString('ru-RU')} ₸)` : base
}

const inputCls = 'rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500/40'

export function BillingControls({ userId }: { userId: string }) {
  const [plan, setPlan] = useState<EffectivePlan | null>(null)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [paymentsError, setPaymentsError] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const [tier, setTier] = useState<PlanTier>('pro')
  const [mode, setMode] = useState<'none' | 'months' | 'date'>('months')
  const [months, setMonths] = useState('1')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [extendMonths, setExtendMonths] = useState('1')

  const load = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        fetch(`/api/giga-admin/users/${userId}/billing`).then((r) => r.json().then((d) => ({ status: r.status, d }))),
        fetch(`/api/giga-admin/users/${userId}/billing/transactions`).then((r) => r.json().then((d) => ({ status: r.status, d }))),
      ])
      if (!p.d?.ok) {
        setLoadError(p.d?.error === 'migration_106_required' ? 'Тариф: миграция 106 не применена' : 'Не удалось загрузить тариф')
      } else {
        setPlan(p.d.plan as EffectivePlan)
        setTier(p.d.plan.tier === 'free' ? 'pro' : (p.d.plan.tier as PlanTier))
        setLoadError(null)
      }
      setPaymentsError(!t.d?.ok)
      setPayments(t.d?.ok ? (t.d.transactions as Payment[]) : [])
    } catch {
      setLoadError('Не удалось загрузить тариф')
    }
  }, [userId])

  useEffect(() => { void load() }, [load])

  const send = async (body: Record<string, unknown>) => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/giga-admin/users/${userId}/billing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || `HTTP ${res.status}`)
      setPlan(d.plan as EffectivePlan)
      setNote('')
      setMessage({ tone: 'ok', text: 'Сохранено. Изменение записано в журнал.' })
    } catch (e) {
      setMessage({ tone: 'error', text: `Не сохранено: ${e instanceof Error ? e.message : 'ошибка'}` })
    } finally {
      setSaving(false)
    }
  }

  const submitSet = () => {
    const body: Record<string, unknown> = { action: 'set', tier, note }
    if (tier !== 'free') {
      if (mode === 'months') body.months = Number(months)
      if (mode === 'date') body.periodEnd = date
    }
    void send(body)
  }

  if (loadError) return <p className="text-[11px] text-slate-500">{loadError}</p>
  if (!plan) return <Loader2 size={14} className="animate-spin text-slate-500" />

  const canExtend = plan.tier !== 'free' && (plan.periodEnd !== null || plan.status === 'expired')

  return (
    <div className="space-y-3" data-testid="billing-controls">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Тариф</span>
        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-medium">
          {PLAN_TIER_LABEL[plan.tier]}
        </span>
        <span className="text-slate-300">{PLAN_STATUS_LABEL[plan.status]}</span>
        {plan.tier !== 'free' && (
          <span className="text-slate-400">
            {plan.periodEnd ? `до ${fmtDate(plan.periodEnd)}` : 'бессрочно'}
          </span>
        )}
        {plan.source && <span className="text-slate-500">· {PLAN_SOURCE_LABEL[plan.source]}</span>}
        <span className="text-slate-600">· доступ {plan.accessTier === 'pro' ? 'Pro' : 'Free'}</span>
      </div>
      {plan.note && <p className="text-[11px] text-slate-500">Заметка: {plan.note}</p>}

      <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Назначить тариф</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={tier} onChange={(e) => setTier(e.target.value as PlanTier)} className={inputCls} aria-label="Тариф">
            {PLAN_TIERS.map((t) => <option key={t} value={t}>{PLAN_TIER_LABEL[t]}</option>)}
          </select>
          {tier !== 'free' && (
            <>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={inputCls} aria-label="Срок">
                <option value="months">на N месяцев</option>
                <option value="date">до даты</option>
                {tier !== 'pilot' && <option value="none">бессрочно</option>}
              </select>
              {mode === 'months' && (
                <input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} className={`${inputCls} w-16`} aria-label="Месяцев" />
              )}
              {mode === 'date' && (
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} aria-label="Дата окончания" />
              )}
            </>
          )}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Заметка (почему) — видна только персоналу"
          className={`${inputCls} w-full`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={submitSet}
            disabled={saving || (tier === 'pilot' && mode === 'none') || (tier !== 'free' && mode === 'date' && !date)}
            className="px-3 py-1 rounded-md text-[11px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 disabled:opacity-40"
          >
            {saving ? 'Сохранение…' : 'Сохранить тариф'}
          </button>
          {canExtend && (
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">или продлить бесплатно на</span>
              <input type="number" min={1} max={36} value={extendMonths} onChange={(e) => setExtendMonths(e.target.value)} className={`${inputCls} w-14`} aria-label="Продлить на месяцев" />
              <button
                onClick={() => void send({ action: 'extend', months: Number(extendMonths), note })}
                disabled={saving}
                className="px-3 py-1 rounded-md text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/25 disabled:opacity-40"
              >
                мес — продлить
              </button>
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-600">Оплата не списывается: онлайн-эквайринг пока демо, тариф назначается вручную.</p>
        {message && (
          <p className={`text-[11px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p>
        )}
      </div>

      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">История платежей</p>
        {payments === null ? (
          <Loader2 size={12} className="animate-spin text-slate-500" />
        ) : paymentsError ? (
          <p className="text-[11px] text-rose-300">Не удалось загрузить историю платежей</p>
        ) : payments.length === 0 ? (
          <p className="text-[11px] text-slate-500">Платежей нет</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="font-normal py-1">Дата</th>
                <th className="font-normal">Провайдер</th>
                <th className="font-normal">План</th>
                <th className="font-normal">Сумма</th>
                <th className="font-normal">Статус</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-white/[0.05] text-slate-300">
                  <td className="py-1">{fmtDate(p.createdAt)}</td>
                  <td>{p.provider}</td>
                  <td>{p.planKey ?? '—'}</td>
                  <td>{fmtMoney(p)}</td>
                  <td className={PAYMENT_STATUS[p.status]?.cls ?? 'text-slate-400'}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
