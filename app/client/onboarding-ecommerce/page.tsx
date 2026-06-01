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
// On finish → /client/dashboard-ecommerce.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface StepDef {
  key: string
  num: string
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

type AnswerValue = string | number | string[]

export default function OnboardingEcommercePage() {
  const router = useRouter()
  const [stepIdx, setStepIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          vertical: 'ecommerce',
          step: stepIdx + 1,
          completed: final,
          answers,
        }),
      })
    } catch {
      // best-effort — local draft already saved
    }
  }, [stepIdx, answers])

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
      router.push('/client/dashboard-ecommerce')
    }
  }

  const prev = () => {
    if (stepIdx === 0) return
    setStepIdx((i) => i - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface">

      {/* Top bar */}
      <header className="border-b border-white/[0.04] bg-surface/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/client/welcome" className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span className="text-sm">Изменить тип бизнеса</span>
          </Link>
          <p className="text-xs font-mono text-on-surface-variant">
            E-COM ОНБОРДИНГ · {stepIdx + 1} / {total}
          </p>
        </div>
        <div className="h-0.5 bg-surface-container">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
            Шаг {step.num}
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface mb-3">
            {step.title}
          </h1>
          <p className="text-on-surface-variant text-sm">{step.hint}</p>
        </div>

        <div className="space-y-5">
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
          <div className="mt-6 rounded-xl bg-error/10 border border-error/20 p-4 text-sm text-error">
            {error}
          </div>
        )}

        <div className="mt-10 flex items-center justify-between">
          <button
            onClick={prev}
            disabled={stepIdx === 0}
            className="px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:text-on-surface hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Назад
          </button>
          <button
            onClick={next}
            disabled={submitting}
            className="px-6 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:shadow-lg hover:shadow-primary/30 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {submitting ? 'Завершаем…' : stepIdx === total - 1 ? 'Готово → в кабинет' : 'Дальше →'}
          </button>
        </div>

        {/* Dots */}
        <div className="mt-10 flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStepIdx(i)}
              className={`h-2 rounded-full transition-all ${i === stepIdx ? 'w-6 bg-primary' : i < stepIdx ? 'w-2 bg-primary/40' : 'w-2 bg-on-surface-variant/20 hover:bg-on-surface-variant/40'}`}
              aria-label={`Шаг ${i + 1}`}
            />
          ))}
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
