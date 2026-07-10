'use client'

// E-commerce cabinet — full dashboard tuned for online retail.
// Sections: hero · funnel sankey · channel mix · marketplaces · SKU health
//   · RFM heatmap · cohort LTV · cart recovery · seasonality · 11 e-com goals
//
// Data layering:
//   1. Survey answers (ec_* keys from /client/onboarding-ecommerce) overlay
//      the hero, KPI row and funnel as soon as the user has filled them.
//   2. Everything without a survey source renders demo data with a badge.
//   3. Real integrations (GA4 / WB / Ozon / Kaspi) later replace both via
//      the same EcommerceData contract (lib/integrations/ecommerce/).

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Mock data (shape mirrors what real integrations will produce) ──────

const DATA = {
  company:  { name: 'Demo Shop', industry: 'Электроника · аксессуары', platform: 'Shopify + Wildberries + Kaspi' },
  revenue:  { current: 84_200_000, target: 110_000_000, trend: 12.4 },
  aov:      { current: 8_500, target: 10_500, trend: 4.1 },
  ordersMo: { current: 1_240, target: 1_800, trend: 9.2 },
  ltvCac:   { current: 4.78, target: 5.0, trend: 0.3 },

  funnel: [
    { stage: 'Visit',    n: 150_000, conv: 1.00 },
    { stage: 'Cart',     n: 12_000,  conv: 0.08 },
    { stage: 'Checkout', n: 4_800,   conv: 0.40 },
    { stage: 'Paid',     n: 1_240,   conv: 0.26 },
  ],

  channels: [
    { name: 'Direct',         revenue: 25_300_000, cac: 0,      roas: Infinity, share: 30 },
    { name: 'Organic (SEO)',  revenue: 18_500_000, cac: 1_200,  roas: 12.5,     share: 22 },
    { name: 'Yandex Direct',  revenue: 14_700_000, cac: 4_500,  roas: 3.8,      share: 17 },
    { name: 'Meta Ads',       revenue: 12_900_000, cac: 5_200,  roas: 3.2,      share: 15 },
    { name: 'TikTok Ads',     revenue:  7_400_000, cac: 3_800,  roas: 2.5,      share: 9  },
    { name: 'Email',          revenue:  3_600_000, cac: 200,    roas: 18.0,     share: 4  },
    { name: 'Реферралы',      revenue:  1_800_000, cac: 0,      roas: Infinity, share: 3  },
  ],

  marketplaces: [
    { name: 'Wildberries', share: 38, rating: 4.7, buybox: 72, payout: 86, badge: 'ok'   },
    { name: 'Ozon',         share: 24, rating: 4.5, buybox: 64, payout: 81, badge: 'ok'   },
    { name: 'Kaspi',        share: 22, rating: 4.8, buybox: 88, payout: 92, badge: 'ok'   },
    { name: 'Uzum',         share: 10, rating: 4.2, buybox: 51, payout: 74, badge: 'warn' },
    { name: 'Trendyol',     share:  6, rating: 4.0, buybox: 42, payout: 68, badge: 'warn' },
  ],

  sku: [
    { name: 'iPhone 16 Pro 256',         sales: 142, margin: 18, returns: 1.2, status: 'live'  },
    { name: 'Чехол Premium Leather',     sales: 528, margin: 64, returns: 2.8, status: 'live'  },
    { name: 'AirPods Pro USB-C',         sales: 287, margin: 22, returns: 1.0, status: 'live'  },
    { name: 'Зарядка GaN 65W',           sales: 196, margin: 41, returns: 4.7, status: 'risk'  },
    { name: 'Чехол силикон базовый',     sales:  18, margin: 12, returns: 0.5, status: 'dead'  },
    { name: 'Apple Watch S9 GPS',        sales:  78, margin: 14, returns: 2.1, status: 'live'  },
    { name: 'Стекло защитное HD',        sales: 412, margin: 71, returns: 1.4, status: 'live'  },
    { name: 'MagSafe powerbank',         sales:   9, margin: 33, returns: 6.2, status: 'dead'  },
  ],

  rfm: [
    // 5x5 grid Recency × Frequency, value = customers count
    [12, 18, 25, 31, 42],
    [22, 28, 36, 48, 58],
    [38, 44, 52, 61, 67],
    [54, 62, 71, 74, 68],
    [78, 84, 76, 65, 47],
  ],

  cohort: [
    { month: 'Янв', months: [100, 42, 28, 22, 19, 17, 15, 14, 13, 12, 11, 10] },
    { month: 'Фев', months: [100, 45, 31, 24, 21, 18, 16, 15, 14, 13, 12] },
    { month: 'Мар', months: [100, 48, 33, 27, 23, 20, 18, 17, 15, 14] },
    { month: 'Апр', months: [100, 52, 36, 29, 25, 22, 19, 18, 16] },
    { month: 'Май', months: [100, 51, 35, 30, 26, 23, 20, 18] },
    { month: 'Июн', months: [100, 49, 34, 28, 25, 22, 19] },
  ],

  cartRecovery: {
    abandoned:    1_870,
    recovered:    412,
    recoveredRev: 3_502_000,
    rate:         22,
    flows: [
      { name: 'Email +1ч',  triggered: 1_870, opened: 980, recovered: 178 },
      { name: 'Email +24ч', triggered: 1_692, opened: 740, recovered: 134 },
      { name: 'SMS +3д',    triggered: 1_558, opened: 1_244, recovered: 67 },
      { name: 'Скидка 10%', triggered: 1_491, opened: 822, recovered: 33  },
    ],
  },

  seasonality: [
    { m: 'Янв', v: 0.62 }, { m: 'Фев', v: 0.55 }, { m: 'Мар', v: 0.78 },
    { m: 'Апр', v: 0.82 }, { m: 'Май', v: 0.71 }, { m: 'Июн', v: 0.68 },
    { m: 'Июл', v: 0.72 }, { m: 'Авг', v: 0.85 }, { m: 'Сен', v: 0.92 },
    { m: 'Окт', v: 0.88 }, { m: 'Ноя', v: 1.00, label: 'BF' }, { m: 'Дек', v: 0.96, label: 'НГ' },
  ] as Array<{ m: string; v: number; label?: string }>,
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat('ru-KZ').format(n)
const fmtMoney = (n: number) => `₸${(n / 1_000_000).toFixed(1)}М`

const statusColor = (s: string) =>
  s === 'live' ? 'text-primary' :
  s === 'risk' ? 'text-tertiary-container' :
  s === 'dead' ? 'text-error' :
  s === 'ok'   ? 'text-primary' :
  s === 'warn' ? 'text-tertiary-container' :
  'text-on-surface-variant'

// ─── Survey overlay ────────────────────────────────────────────────────────
// Pulls ec_* answers saved by /client/onboarding-ecommerce and derives the
// view model for hero / KPI row / funnel. Missing answers → demo fallback.

interface KpiView { current: number; target: number; trend: number | null }

interface SurveyView {
  fromSurvey: boolean
  company: { name: string; industry: string; platform: string }
  revenue: KpiView
  aov: KpiView
  ordersMo: KpiView
  ltvCac: KpiView
  funnel: Array<{ stage: string; n: number; conv: number }>
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

function buildView(answers: Record<string, unknown> | null): SurveyView {
  const base: SurveyView = {
    fromSurvey: false,
    company: { ...DATA.company },
    revenue: { ...DATA.revenue },
    aov: { ...DATA.aov },
    ordersMo: { ...DATA.ordersMo },
    ltvCac: { ...DATA.ltvCac },
    funnel: DATA.funnel.map((f) => ({ ...f })),
  }
  if (!answers) return base

  const revenue = num(answers.ec_revenue_2024)
  const aov = num(answers.ec_aov)
  const visitors = num(answers.ec_visitors_per_month)
  const crVisitCart = num(answers.ec_cr_visit_to_cart)
  const crCartPay = num(answers.ec_cr_cart_to_pay)
  const roas = num(answers.ec_roas)
  const platforms = Array.isArray(answers.ec_platforms)
    ? (answers.ec_platforms as string[]).join(' + ')
    : null

  const anySurvey = Boolean(revenue || aov || visitors || platforms)
  if (!anySurvey) return base

  base.fromSurvey = true
  if (platforms) base.company = { ...base.company, name: 'Мой магазин', platform: platforms }

  // Trends are unknown from a one-shot survey → null renders as "—".
  if (revenue) base.revenue = { current: revenue, target: Math.round(revenue * 1.3), trend: null }
  if (aov)     base.aov     = { current: aov,     target: Math.round(aov * 1.25),     trend: null }
  if (roas)    base.ltvCac  = { current: roas,    target: Math.max(3, roas),          trend: null }

  if (visitors && crVisitCart && crCartPay) {
    const cart = Math.round(visitors * (crVisitCart / 100))
    const paid = Math.round(cart * (crCartPay / 100))
    base.funnel = [
      { stage: 'Visit', n: visitors, conv: 1 },
      { stage: 'Cart',  n: cart,     conv: crVisitCart / 100 },
      { stage: 'Paid',  n: paid,     conv: crCartPay / 100 },
    ]
    base.ordersMo = { current: paid, target: Math.round(paid * 1.45), trend: null }
  }
  return base
}

function useEcommerceSurveyView(): { view: SurveyView; loading: boolean } {
  const [answers, setAnswers] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sb = createClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) return
        const res = await fetch(`/api/v1/onboarding/survey?user_id=${user.id}`, { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as { ok: boolean; data?: { answers?: Record<string, unknown> } }
        if (!cancelled && json.ok && json.data?.answers) setAnswers(json.data.answers)
      } catch {
        // demo fallback already in place
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const view = useMemo(() => buildView(answers), [answers])
  return { view, loading }
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function DashboardEcommercePage() {
  const { view } = useEcommerceSurveyView()
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Topbar />

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <Hero view={view} />
        <KpiRow view={view} />
        <FunnelSankey view={view} />
        <ChannelMix />
        <MarketplacesStrip />
        <SkuHealth />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <RFMHeatmap />
          <CohortLTV />
        </div>
        <CartRecovery />
        <Seasonality />
        <GoalsStrip />
      </main>
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────

function Topbar() {
  // Header chrome matches /client/dashboard-medical for cross-vertical
  // consistency: eyebrow + title on the left, action set on the right.
  return (
    <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">
            AI-операционка для онлайн-ритейла
          </p>
          <h1 className="text-xl font-headline font-bold text-on-surface mt-0.5">
            Кабинет интернет-магазина
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/client/onboarding-ecommerce"
            className="text-xs text-on-surface-variant hover:text-primary transition-colors hidden sm:inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
            Анкета
          </Link>
          <Link
            href="/client/onboarding-ecommerce"
            className="text-xs text-on-surface-variant hover:text-primary transition-colors hidden sm:inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">upload</span>
            Файлы
          </Link>
          <Link
            href="/settings"
            className="text-xs text-on-surface-variant hover:text-primary transition-colors hidden md:inline"
          >
            Настройки
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero({ view }: { view: SurveyView }) {
  const { company, fromSurvey } = view
  return (
    <section className="bg-surface-container-low rounded-3xl border border-white/[0.06] p-8">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em]">КАБИНЕТ · E-COMMERCE</p>
            <span className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${
              fromSurvey
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-surface-container border-white/[0.08] text-on-surface-variant'
            }`}>
              {fromSurvey ? 'данные из анкеты' : 'демо-данные'}
            </span>
          </div>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold">{company.name}</h1>
          <p className="text-on-surface-variant mt-1.5 text-sm">{company.industry} · {company.platform}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/client/onboarding-ecommerce" className="px-5 py-2.5 rounded-xl border border-white/[0.08] hover:border-primary/40 hover:text-primary transition-colors text-sm">
            <span className="material-symbols-outlined text-base align-middle mr-1">upload</span>
            Загрузить отчёт
          </Link>
        </div>
      </div>
    </section>
  )
}

function KpiRow({ view }: { view: SurveyView }) {
  const t = (v: number | null, suffix = '%') => (v == null ? '—' : `+${v}${suffix}`)
  const items = [
    { label: 'Выручка',    cur: fmtMoney(view.revenue.current),  tgt: fmtMoney(view.revenue.target),  trend: t(view.revenue.trend) },
    { label: 'AOV (чек)',  cur: `₸${fmt(view.aov.current)}`,     tgt: `₸${fmt(view.aov.target)}`,     trend: t(view.aov.trend) },
    { label: 'Заказов/мес', cur: fmt(view.ordersMo.current),     tgt: fmt(view.ordersMo.target),      trend: t(view.ordersMo.trend) },
    { label: 'LTV/CAC',    cur: `${view.ltvCac.current}x`,       tgt: `${view.ltvCac.target}x`,       trend: t(view.ltvCac.trend, 'x') },
  ]
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((it) => (
        <div key={it.label} className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-2">{it.label}</p>
          <p className="font-headline text-2xl font-extrabold text-on-surface">{it.cur}</p>
          <div className="flex items-center justify-between mt-2 text-[10px] text-on-surface-variant/70">
            <span>→ {it.tgt}</span>
            <span className="text-primary font-mono">{it.trend}</span>
          </div>
        </div>
      ))}
    </section>
  )
}

function FunnelSankey({ view }: { view: SurveyView }) {
  const funnel = view.funnel
  const max = funnel[0].n
  return (
    <SectionCard
      eyebrow="ВОРОНКА"
      title={funnel.map((f) => f.stage).join(' → ')}
      hint="Потери на каждом этапе. Цель: поднять Cart→Paid >50%."
    >
      <div className="space-y-3">
        {funnel.map((stage, i) => {
          const widthPct = (stage.n / max) * 100
          const prevN = i === 0 ? null : funnel[i - 1].n
          const drop = prevN ? ((1 - stage.n / prevN) * 100).toFixed(1) : null
          return (
            <div key={stage.stage} className="flex items-center gap-4">
              <p className="text-sm font-medium w-24 flex-shrink-0">{stage.stage}</p>
              <div className="flex-1 h-10 bg-surface-container rounded-xl overflow-hidden relative">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-xl flex items-center px-4"
                  style={{ width: `${widthPct}%` }}
                >
                  <span className="text-xs font-mono font-bold text-on-primary">{fmt(stage.n)}</span>
                </div>
              </div>
              <p className="text-xs font-mono text-on-surface-variant w-24 flex-shrink-0 text-right">
                CR {(stage.conv * 100).toFixed(1)}%
              </p>
              {drop && (
                <p className="text-xs font-mono text-error w-20 flex-shrink-0 text-right">
                  −{drop}%
                </p>
              )}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function ChannelMix() {
  const totalRev = DATA.channels.reduce((s, c) => s + c.revenue, 0)
  return (
    <SectionCard
      eyebrow="КАНАЛЫ ТРАФИКА"
      title="Атрибуция «канал → выручка»"
      hint="Сравни ROAS — отключи всё ниже 2.5x, докинь в Email и Organic."
    >
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
              <th className="text-left py-2 px-2">Канал</th>
              <th className="text-right py-2 px-2">Выручка</th>
              <th className="text-right py-2 px-2">Доля</th>
              <th className="text-right py-2 px-2">CAC</th>
              <th className="text-right py-2 px-2">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {DATA.channels.map((c) => {
              const share = (c.revenue / totalRev) * 100
              return (
                <tr key={c.name} className="border-t border-white/[0.04]">
                  <td className="py-3 px-2 font-medium">{c.name}</td>
                  <td className="py-3 px-2 text-right font-mono">{fmtMoney(c.revenue)}</td>
                  <td className="py-3 px-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-surface-container rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-xs font-mono w-10">{share.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-on-surface-variant">
                    {c.cac > 0 ? `₸${fmt(c.cac)}` : '—'}
                  </td>
                  <td className="py-3 px-2 text-right font-mono">
                    <span className={c.roas === Infinity ? 'text-primary' : c.roas >= 4 ? 'text-primary' : c.roas >= 2.5 ? 'text-tertiary-container' : 'text-error'}>
                      {c.roas === Infinity ? '∞' : `${c.roas.toFixed(1)}x`}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function MarketplacesStrip() {
  return (
    <SectionCard
      eyebrow="МАРКЕТПЛЕЙСЫ"
      title="WB · Ozon · Kaspi · Uzum · Trendyol"
      hint="BuyBox, рейтинг, % выкупа. Цель Uzum/Trendyol — поднять до 75%."
    >
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {DATA.marketplaces.map((mp) => (
          <div key={mp.name} className="bg-surface-container rounded-2xl border border-white/[0.04] p-4">
            <div className="flex items-start justify-between mb-3">
              <p className="font-bold">{mp.name}</p>
              <span className={`material-symbols-outlined text-base ${statusColor(mp.badge)}`}>
                {mp.badge === 'ok' ? 'check_circle' : 'warning'}
              </span>
            </div>
            <p className="font-mono text-2xl font-bold text-primary">{mp.share}%</p>
            <p className="text-[10px] text-on-surface-variant/70 uppercase tracking-wider mt-0.5">доля выручки</p>
            <div className="mt-3 space-y-1.5 text-xs">
              <Row k="Рейтинг" v={`${mp.rating}/5`} />
              <Row k="BuyBox"  v={`${mp.buybox}%`} />
              <Row k="Выкуп"   v={`${mp.payout}%`} />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-on-surface-variant/70">{k}</span>
      <span className="font-mono text-on-surface">{v}</span>
    </div>
  )
}

function SkuHealth() {
  return (
    <SectionCard
      eyebrow="КАТАЛОГ · SKU HEALTH"
      title="ABC/XYZ + Dead stock"
      hint="Чисти dead stock (>180 дн. без продаж) — заморожено ~₸4М."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
              <th className="text-left py-2 px-2">SKU</th>
              <th className="text-right py-2 px-2">Продаж/мес</th>
              <th className="text-right py-2 px-2">Маржа</th>
              <th className="text-right py-2 px-2">Возвраты</th>
              <th className="text-right py-2 px-2">Статус</th>
            </tr>
          </thead>
          <tbody>
            {DATA.sku.map((s) => (
              <tr key={s.name} className="border-t border-white/[0.04]">
                <td className="py-3 px-2 font-medium truncate max-w-[280px]">{s.name}</td>
                <td className="py-3 px-2 text-right font-mono">{s.sales}</td>
                <td className="py-3 px-2 text-right font-mono">{s.margin}%</td>
                <td className="py-3 px-2 text-right font-mono">
                  <span className={s.returns >= 5 ? 'text-error' : s.returns >= 3 ? 'text-tertiary-container' : 'text-on-surface-variant'}>
                    {s.returns}%
                  </span>
                </td>
                <td className="py-3 px-2 text-right">
                  <span className={`text-[10px] font-mono uppercase tracking-wider ${statusColor(s.status)}`}>
                    {s.status === 'live' ? 'LIVE' : s.status === 'risk' ? 'RISK' : 'DEAD'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function RFMHeatmap() {
  const labels = ['1', '2', '3', '4', '5']
  const max = useMemo(() => Math.max(...DATA.rfm.flat()), [])
  return (
    <SectionCard
      eyebrow="RFM"
      title="Сегменты базы клиентов"
      hint="Recency × Frequency. Champions (5×5) — кампания «just for you»."
    >
      <div className="grid grid-cols-[auto_repeat(5,1fr)] gap-1 text-[10px] font-mono text-on-surface-variant">
        <span />
        {labels.map((l) => <span key={l} className="text-center">F{l}</span>)}
        {DATA.rfm.map((row, ri) => (
          <Row2 key={ri} ri={ri} row={row} max={max} />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[10px] text-on-surface-variant">
        <span>← давно покупали</span>
        <span>покупали недавно →</span>
      </div>
    </SectionCard>
  )
}

function Row2({ ri, row, max }: { ri: number; row: readonly number[]; max: number }) {
  return (
    <>
      <span className="self-center text-center">R{ri + 1}</span>
      {row.map((v, ci) => {
        const intensity = v / max
        return (
          <div
            key={ci}
            className="aspect-square rounded-md flex items-center justify-center text-[10px] text-on-primary font-mono font-bold"
            style={{ backgroundColor: `rgba(110, 255, 192, ${0.15 + intensity * 0.85})` }}
          >
            {v}
          </div>
        )
      })}
    </>
  )
}

function CohortLTV() {
  return (
    <SectionCard
      eyebrow="COHORT LTV"
      title="Удержание по когортам"
      hint="Каждая строка = месяц первой покупки. % активны через N мес."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-on-surface-variant/60">
              <th className="text-left py-1 pr-2">Когорта</th>
              {Array.from({ length: 12 }).map((_, i) => (
                <th key={i} className="text-center py-1 px-1">M{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DATA.cohort.map((c) => (
              <tr key={c.month}>
                <td className="py-0.5 pr-2 text-on-surface">{c.month}</td>
                {Array.from({ length: 12 }).map((_, i) => {
                  const v = c.months[i]
                  if (v == null) return <td key={i} />
                  const intensity = v / 100
                  return (
                    <td key={i} className="py-0.5 px-0.5">
                      <div
                        className="aspect-square rounded text-on-primary font-bold flex items-center justify-center text-[9px]"
                        style={{ backgroundColor: `rgba(110, 255, 192, ${0.1 + intensity * 0.9})` }}
                      >
                        {v}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function CartRecovery() {
  const { abandoned, recovered, recoveredRev, rate, flows } = DATA.cartRecovery
  return (
    <SectionCard
      eyebrow="CART RECOVERY"
      title={`${rate}% брошенных корзин возвращаются`}
      hint="Email+1ч даёт самый высокий ROI. Скидка 10% — последний триггер."
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-5">
        <Stat label="Брошено" value={fmt(abandoned)} />
        <Stat label="Возвращено" value={fmt(recovered)} accent />
        <Stat label="Выручка" value={fmtMoney(recoveredRev)} accent />
        <Stat label="Recovery rate" value={`${rate}%`} accent />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
              <th className="text-left py-2 px-2">Flow</th>
              <th className="text-right py-2 px-2">Триггер</th>
              <th className="text-right py-2 px-2">Открыто</th>
              <th className="text-right py-2 px-2">Куплено</th>
              <th className="text-right py-2 px-2">Конверсия</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f) => {
              const cr = (f.recovered / f.triggered) * 100
              return (
                <tr key={f.name} className="border-t border-white/[0.04]">
                  <td className="py-3 px-2 font-medium">{f.name}</td>
                  <td className="py-3 px-2 text-right font-mono">{fmt(f.triggered)}</td>
                  <td className="py-3 px-2 text-right font-mono">{fmt(f.opened)}</td>
                  <td className="py-3 px-2 text-right font-mono text-primary">{fmt(f.recovered)}</td>
                  <td className="py-3 px-2 text-right font-mono">{cr.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface-container rounded-xl border border-white/[0.04] p-4">
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className={`font-headline text-2xl font-extrabold mt-1 ${accent ? 'text-primary' : 'text-on-surface'}`}>{value}</p>
    </div>
  )
}

function Seasonality() {
  const max = Math.max(...DATA.seasonality.map((s) => s.v))
  return (
    <SectionCard
      eyebrow="СЕЗОННОСТЬ"
      title="Прогноз кэша по месяцам"
      hint="Пики: BF, НГ, школа, Рамадан. Закупка под пик — за 2 мес."
    >
      <div className="grid grid-cols-12 gap-1.5 items-end h-40">
        {DATA.seasonality.map((s) => {
          const h = (s.v / max) * 100
          return (
            <div key={s.m} className="flex flex-col items-center justify-end h-full">
              <div
                className={`w-full rounded-t-md ${s.label ? 'bg-primary' : 'bg-primary/40'}`}
                style={{ height: `${h}%` }}
              />
              <span className="text-[9px] font-mono text-on-surface-variant mt-1">{s.m}</span>
              {s.label && <span className="text-[9px] font-mono text-primary font-bold">{s.label}</span>}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function GoalsStrip() {
  const goals = [
    { n: '01', t: 'Привлечение',  d: 'Атрибуция канал/UTM по выручке' },
    { n: '02', t: 'Удержание',     d: 'RFM + email/SMS retention flow' },
    { n: '03', t: 'Чек (AOV)',     d: 'Bundles + free-shipping threshold' },
    { n: '04', t: 'Частота',       d: 'Subscription / replenishment reminders' },
    { n: '05', t: 'Сарафан',       d: 'UGC + рейтинги + реф-программа' },
    { n: '06', t: 'BuyBox',        d: 'Win rate на маркетплейсах' },
    { n: '07', t: 'Спрос',         d: 'Retargeting + abandoned-cart' },
    { n: '08', t: 'Time-to-Pay',   d: 'Visit → оплата за минуты' },
    { n: '09', t: 'CAC',           d: 'ROAS по каналу + LTV/CAC per канал' },
    { n: '10', t: 'Conversion',    d: 'Visit → Cart → Paid funnel' },
    { n: '11', t: 'Выбор вас',     d: 'Brand share of search + reviews' },
  ]
  return (
    <SectionCard
      eyebrow="11 ЦЕЛЕЙ РОСТА · E-COM"
      title="План на 90 дней"
      hint="Стабилизация → Атрибуция → Рычаги. По 3 цели на фазу."
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {goals.map((g) => (
          <div key={g.n} className="bg-surface-container rounded-2xl border border-white/[0.04] p-4 hover:border-primary/30 transition-colors">
            <p className="font-headline text-2xl font-extrabold text-primary">{g.n}</p>
            <p className="text-sm font-semibold mt-2">{g.t}</p>
            <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{g.d}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

// ─── Layout primitive ─────────────────────────────────────────────────────

function SectionCard({
  eyebrow, title, hint, children,
}: {
  eyebrow: string
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-surface-container-low rounded-3xl border border-white/[0.06] p-6 lg:p-8">
      <div className="mb-6">
        <p className="text-[10px] font-mono text-primary uppercase tracking-[0.25em] mb-1.5">{eyebrow}</p>
        <h2 className="font-headline text-2xl font-extrabold">{title}</h2>
        {hint && <p className="text-sm text-on-surface-variant mt-2">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
