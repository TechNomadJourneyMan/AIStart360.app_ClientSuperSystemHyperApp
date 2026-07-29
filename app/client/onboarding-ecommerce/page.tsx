'use client'

// E-commerce onboarding flow — 7 specific steps tuned for online retail:
//   1. Платформа         (Shopify / Tilda / Bitrix / InSales / OpenCart / Wix / Своя)
//   2. Маркетплейсы      (WB · Ozon · Kaspi · Uzum · Trendyol · Amazon …)
//   3. Каналы трафика    + бюджет по каналу
//   4. Каталог           (SKU live / active / локомотив / маржинальный)
//   5. Воронка           (Visit → Cart → Checkout → Paid, %)
//   6. Логистика         (склад / ПВЗ / фулфилмент / возвраты %)
//   7. Финансы           (выручка / сезонность / зависимость от 1 поставщика)
//
// Answers persist locally + POST to /api/v1/onboarding/survey on each step.
// On finish → /client/dashboard-ecommerce for an approved client; otherwise the
// completion screen with a link to it (same exit rule as /client/onboarding).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

interface StepDef {
  key: string
  num: string
  icon: string
  shortTitle: string
  title: string
  hint: string
  fields: FieldDef[]
}

type FieldType = 'text' | 'number' | 'select' | 'multi' | 'percent'

interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: string[]
  placeholder?: string
  required?: boolean
  suffix?: string
}

const STEPS: StepDef[] = [
  {
    key: 'platform',
    num: '01',
    icon: 'storefront',
    shortTitle: 'Платформа',
    title: 'Платформа магазина',
    hint: 'На чём крутится сайт. Если несколько — отметь все.',
    fields: [
      {
        key: 'ec_platforms',
        label: 'Платформа(-ы)',
        type: 'multi',
        options: ['Shopify', 'Tilda', '1C-Bitrix', 'InSales', 'OpenCart', 'Wix Stores', 'WordPress / Woo', 'Своя разработка', 'Только маркетплейсы'],
        required: true,
      },
      { key: 'ec_website',      label: 'Сайт магазина (URL)', type: 'text', placeholder: 'https://shop.example.com' },
      { key: 'ec_years_online', label: 'Лет в онлайне',        type: 'number', placeholder: '3' },
    ],
  },
  {
    key: 'marketplaces',
    num: '02',
    icon: 'shopping_bag',
    shortTitle: 'Маркетплейсы',
    title: 'Маркетплейсы',
    hint: 'Где ещё продаёте. Можно несколько или «не работаем».',
    fields: [
      {
        key: 'ec_marketplaces',
        label: 'Маркетплейсы',
        type: 'multi',
        options: ['Wildberries RU', 'Ozon', 'Kaspi Магазин', 'Uzum Market', 'Wildberries KZ', 'Trendyol', 'Amazon', 'Yandex.Market', 'AliExpress', 'Не работаем с маркетплейсами'],
      },
      { key: 'ec_mp_revenue_share', label: 'Доля выручки с маркетплейсов', type: 'percent', placeholder: '40', suffix: '%' },
      { key: 'ec_mp_top_categories', label: 'Топ-3 категории на маркетплейсах', type: 'text', placeholder: 'Аксессуары · Сумки · Часы' },
    ],
  },
  {
    key: 'traffic',
    num: '03',
    icon: 'ads_click',
    shortTitle: 'Трафик',
    title: 'Каналы трафика',
    hint: 'Откуда идёт основная часть посетителей и сколько на это тратите.',
    fields: [
      {
        key: 'ec_traffic_channels',
        label: 'Активные каналы',
        type: 'multi',
        options: ['Прямые заходы (Direct)', 'Поиск (SEO / Organic)', 'Google Ads', 'Yandex Direct', 'Meta Ads (Facebook/Instagram)', 'TikTok Ads', 'VK Ads', 'Telegram-каналы', 'Email-рассылки', 'Партнёры / реферралы', 'Маркетплейсы'],
      },
      { key: 'ec_monthly_ad_budget', label: 'Бюджет рекламы в месяц (₸)', type: 'number', placeholder: '500000' },
      { key: 'ec_visitors_per_month', label: 'Среднее число посетителей сайта в месяц', type: 'number', placeholder: '50000' },
      { key: 'ec_roas',               label: 'ROAS — выручка / реклама',   type: 'number', placeholder: '4.5', suffix: 'x' },
    ],
  },
  {
    key: 'catalog',
    num: '04',
    icon: 'inventory_2',
    shortTitle: 'Каталог',
    title: 'Каталог',
    hint: 'Сколько товаров и какие тащат маржу.',
    fields: [
      { key: 'ec_total_sku',      label: 'Всего SKU в каталоге',  type: 'number', placeholder: '450' },
      { key: 'ec_active_sku',     label: 'Активных SKU за 90 дней', type: 'number', placeholder: '320' },
      { key: 'ec_flagship_sku',   label: 'Продукт-локомотив (название)', type: 'text', placeholder: 'iPhone 16 Pro' },
      { key: 'ec_most_marginal',  label: 'Самый маржинальный продукт',   type: 'text', placeholder: 'Чехлы Premium Line' },
      { key: 'ec_dead_stock_pct', label: 'Доля dead stock (без продаж >180 дн.)', type: 'percent', placeholder: '12', suffix: '%' },
    ],
  },
  {
    key: 'funnel',
    num: '05',
    icon: 'filter_alt',
    shortTitle: 'Воронка',
    title: 'Воронка покупки',
    hint: 'Если не знаете точных цифр — поставьте предположение, потом подключим GA4.',
    fields: [
      { key: 'ec_aov',              label: 'AOV — средний чек заказа (₸)', type: 'number', placeholder: '8500' },
      { key: 'ec_cr_visit_to_cart', label: 'CR Visit → Cart (%)',          type: 'percent', placeholder: '8',  suffix: '%' },
      { key: 'ec_cr_cart_to_pay',   label: 'CR Cart → Paid (%)',           type: 'percent', placeholder: '22', suffix: '%' },
      { key: 'ec_abandon_pct',      label: 'Cart abandonment rate (%)',    type: 'percent', placeholder: '70', suffix: '%' },
      { key: 'ec_repeat_rate',      label: 'Repeat Purchase Rate (%)',     type: 'percent', placeholder: '18', suffix: '%' },
      { key: 'ec_nps',              label: 'NPS (если измеряете)',         type: 'number', placeholder: '38' },
    ],
  },
  {
    key: 'logistics',
    num: '06',
    icon: 'local_shipping',
    shortTitle: 'Логистика',
    title: 'Логистика и возвраты',
    hint: 'Как доставляете и что часто возвращают.',
    fields: [
      {
        key: 'ec_fulfillment',
        label: 'Модель фулфилмента',
        type: 'multi',
        options: ['Свой склад + курьер', 'Свой склад + ПВЗ/постаматы', 'Фулфилмент маркетплейса (FBO)', 'Дропшиппинг', 'Локальные курьерки (СДЭК / Boxberry / Halyk)', 'Самовывоз'],
      },
      { key: 'ec_delivery_days',     label: 'Среднее время доставки (дней)', type: 'number', placeholder: '3' },
      { key: 'ec_returns_pct',       label: 'Процент возвратов',             type: 'percent', placeholder: '5', suffix: '%' },
      { key: 'ec_top_return_reason', label: 'Топ-1 причина возвратов',       type: 'text', placeholder: 'Не подошёл размер' },
      { key: 'ec_geo_regions',       label: 'Регионы поставки',              type: 'text', placeholder: 'РК · РФ · UZ' },
    ],
  },
  {
    key: 'finance',
    num: '07',
    icon: 'payments',
    shortTitle: 'Финансы',
    title: 'Финансы и сезонность',
    hint: 'Опционально — для прогноза кэша и плана роста.',
    fields: [
      { key: 'ec_revenue_2024',          label: 'Выручка 2024 (₸)',           type: 'number', placeholder: '84000000' },
      { key: 'ec_gross_margin',          label: 'Валовая маржа (%)',          type: 'percent', placeholder: '34', suffix: '%' },
      { key: 'ec_seasonality_peaks',     label: 'Пики продаж (выбери)',       type: 'multi', options: ['Новый Год', 'Black Friday', 'Школьная пора', 'Рамадан / Eid', '8 Марта', '11.11 / 12.12', 'День Победы', 'Без выраженных пиков'] },
      { key: 'ec_supplier_concentration', label: 'Доля выручки от топ-1 поставщика (%)', type: 'percent', placeholder: '40', suffix: '%' },
      { key: 'ec_inventory_turnover',    label: 'Оборачиваемость склада (дней)', type: 'number', placeholder: '45' },
    ],
  },
]

const STORAGE_KEY = 'aistart360_onboarding_ecommerce'

// The result page of this vertical — the e-commerce cabinet reads the ec_*
// answers this survey just saved.
const RESULT_PATH = '/client/dashboard-ecommerce'

type AnswerValue = string | number | string[]

export default function OnboardingEcommercePage() {
  const router = useRouter()
  const [stepIdx, setStepIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the survey is finished but the account is not approved yet.
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)

  // Restore draft
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      try { setAnswers(JSON.parse(raw)) } catch { /* ignore */ }
    }
  }, [])

  // Persist draft on every change
  useEffect(() => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers))
  }, [answers])

  const step = STEPS[stepIdx]
  const total = STEPS.length
  const pct = Math.round(((stepIdx + 1) / total) * 100)

  const setField = (key: string, value: AnswerValue) => {
    setAnswers((cur) => ({ ...cur, [key]: value }))
  }

  const canAdvance = useMemo(() => {
    return step.fields.every((f) => {
      if (!f.required) return true
      const v = answers[f.key]
      if (v == null) return false
      if (Array.isArray(v)) return v.length > 0
      return String(v).trim().length > 0
    })
  }, [step, answers])

  const persistRemote = useCallback(async (final: boolean) => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      // API contract: answers must be Record<string, { value: unknown }>
      // (GET unwraps row.answer.value — flat values would break the read path)
      const wrapped = Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, { value: v }]),
      )
      await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          vertical: 'ecommerce',
          step: stepIdx + 1,
          completed: final,
          answers: wrapped,
        }),
      })
    } catch {
      // best-effort — local draft already saved
    }
  }, [stepIdx, answers])

  // Approval status of the current session, or null when the CHECK ITSELF failed.
  const fetchApprovalStatus = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/client/status', { credentials: 'include' })
      if (!res.ok) return null
      const data = await res.json()
      return typeof data?.status === 'string' ? data.status : null
    } catch { return null }
  }

  const next = async () => {
    if (!canAdvance) {
      setError('Заполните обязательные поля')
      return
    }
    setError(null)
    if (stepIdx < total - 1) {
      await persistRemote(false)
      setStepIdx((i) => i + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      // finish
      setSubmitting(true)
      await persistRemote(true)
      sessionStorage.removeItem(STORAGE_KEY)
      // A failed status check counts as approved: middleware re-checks the
      // status server-side, so an optimistic navigation cannot leak access,
      // while defaulting to "not approved" would hide a filled-in cabinet.
      const status = await fetchApprovalStatus()
      if (status === null || status === 'approved') {
        router.replace(RESULT_PATH)
      } else {
        setPendingStatus(status)
      }
      setSubmitting(false)
    }
  }

  const prev = () => {
    if (stepIdx === 0) return
    setStepIdx((i) => i - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Survey done, account still on moderation. Middleware would bounce this user
  // straight off the cabinet, so we keep the link in front of him instead.
  if (pendingStatus) {
    return (
      <div className="min-h-screen bg-[#0c0e14] text-on-surface flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
            <span className="material-symbols-outlined text-2xl text-primary">storefront</span>
          </div>
          <h1 className="text-xl font-bold text-on-surface mb-2">Анкета отправлена</h1>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Данные магазина сохранены. Кабинет откроется, как только администратор
            подтвердит доступ — обычно в течение 24 часов.
          </p>

          {/* Same order as /client/onboarding: the cabinet is behind the
              approval gate, so the waiting room is the honest primary action. */}
          <div className="mt-6 space-y-3">
            <Link
              href="/client/waiting-room"
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm hover:scale-[0.99] transition-all"
            >
              <span className="material-symbols-outlined text-base">schedule</span>
              Статус заявки
            </Link>
            <Link
              href={RESULT_PATH}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:bg-white/[0.04] transition-colors"
            >
              <span className="material-symbols-outlined text-base">arrow_forward</span>
              Открыть кабинет — после одобрения
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0c0e14] text-on-surface">

      {/* Header — same chrome as /client/onboarding */}
      <header className="sticky top-0 z-30 bg-[#0c0e14]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/client/welcome" className="flex items-center gap-2 group">
            <Image src="/logo-icon.svg" alt="AIStart360" width={28} height={28} className="opacity-80 group-hover:opacity-100 transition-opacity" />
            <span className="text-sm font-bold text-on-surface/70 hidden sm:block">AIStart360</span>
            <span className="text-[10px] font-mono text-primary/70 hidden md:inline ml-2">/ e-commerce</span>
          </Link>
          <span className="text-[10px] font-mono text-on-surface-variant">
            Шаг {stepIdx + 1} из {total}
          </span>
        </div>
        <div className="h-0.5 bg-white/[0.04]">
          <div
            className="h-full bg-gradient-to-r from-primary to-[#00e29e] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 md:py-10">
        {/* Step tabs (scrollable) — same as /client/onboarding */}
        <div className="flex gap-1 overflow-x-auto pb-3 mb-6 scrollbar-hide">
          {STEPS.map((s, i) => {
            const isActive = i === stepIdx
            const isPast = i < stepIdx
            return (
              <button
                key={s.key}
                onClick={() => setStepIdx(i)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap transition-all flex-shrink-0 cursor-pointer
                  ${isActive ? 'bg-primary/15 text-primary border border-primary/20' :
                    isPast ? 'bg-white/[0.04] text-on-surface-variant hover:text-on-surface hover:bg-white/[0.06]' :
                    'bg-white/[0.02] text-on-surface-variant/60 hover:text-on-surface-variant hover:bg-white/[0.05]'}
                `}
              >
                <span className="material-symbols-outlined text-xs">{s.icon}</span>
                {s.shortTitle}
              </button>
            )
          })}
        </div>

        {/* Step header — icon-circle + title */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-primary">{step.icon}</span>
            </div>
            <div>
              <p className="text-[10px] font-mono text-primary/60 uppercase tracking-[0.15em]">Шаг {step.num}</p>
              <h1 className="text-xl font-bold text-on-surface">{step.title}</h1>
            </div>
          </div>
          <p className="text-sm text-on-surface-variant ml-[52px]">{step.hint}</p>
        </div>

        {/* Step form */}
        <div className="mb-8 space-y-5">
          {step.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={answers[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-error/10 border border-error/20 p-4 text-sm text-error">
            {error}
          </div>
        )}

        {/* Navigation — same gradient CTA as generic onboarding */}
        <div className="flex items-center gap-3 pb-8">
          {stepIdx > 0 && (
            <button
              onClick={prev}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:bg-white/[0.04] transition-colors"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              Назад
            </button>
          )}
          <button
            onClick={next}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm hover:scale-[0.99] transition-all disabled:opacity-50"
          >
            {submitting ? (
              <><span className="material-symbols-outlined text-base animate-spin">progress_activity</span> Сохранение...</>
            ) : stepIdx === total - 1 ? (
              <><span className="material-symbols-outlined text-base">rocket_launch</span> Получить дашборд</>
            ) : (
              <><span className="material-symbols-outlined text-base">arrow_forward</span> Далее</>
            )}
          </button>
        </div>
      </main>
    </div>
  )
}

// ─── Field input renderer ──────────────────────────────────────────────────

function FieldInput({
  field, value, onChange,
}: {
  field: FieldDef
  value: AnswerValue | undefined
  onChange: (v: AnswerValue) => void
}) {
  if (field.type === 'multi') {
    const arr = Array.isArray(value) ? value : []
    const toggle = (opt: string) => {
      if (arr.includes(opt)) onChange(arr.filter((x) => x !== opt))
      else onChange([...arr, opt])
    }
    return (
      <div>
        <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2.5">
          {field.label} {field.required && <span className="text-primary">*</span>}
        </label>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => {
            const active = arr.includes(opt)
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={`px-3.5 py-2 rounded-xl text-sm transition-all ${
                  active
                    ? 'bg-primary/20 border border-primary/40 text-primary'
                    : 'bg-surface-container border border-white/[0.06] text-on-surface-variant hover:border-primary/30 hover:text-on-surface'
                }`}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2.5">
        {field.label} {field.required && <span className="text-primary">*</span>}
      </label>
      <div className="relative">
        <input
          type={field.type === 'number' || field.type === 'percent' ? 'number' : 'text'}
          inputMode={field.type === 'number' || field.type === 'percent' ? 'decimal' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value
            if (field.type === 'number' || field.type === 'percent') {
              onChange(raw === '' ? '' : Number(raw))
            } else {
              onChange(raw)
            }
          }}
          placeholder={field.placeholder}
          className="w-full bg-surface-container border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {field.suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-mono text-on-surface-variant/60">
            {field.suffix}
          </span>
        )}
      </div>
    </div>
  )
}
