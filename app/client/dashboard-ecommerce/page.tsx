'use client'

// E-commerce cabinet — dashboard for online retail.
// Sections: hero · KPI row · funnel · channel mix · marketplaces · SKU health
//   · RFM · cohort LTV · cart recovery · seasonality · logistics/finance
//   · typical e-com goals (suggestions, not progress)
//
// Data rules (no demo data, see lib/ecommerce/survey-view.ts):
//   • Every value comes from the client's own survey answers (ec_* keys saved
//     by /client/onboarding-ecommerce) or is an arithmetic derivation of them,
//     labelled «расчёт по анкете».
//   • Company name: companies.name via GET /api/v1/onboarding/company, else
//     the neutral «Ваш магазин».
//   • No invented targets or trends: no survey key provides them → «Цель не
//     задана» / «—».
//   • Blocks without a survey source (per-channel, per-marketplace, per-SKU,
//     RFM, cohorts, cart flows, monthly sales) are honest empty states — the
//     integrations in lib/integrations/ecommerce/ are not connected yet.
//
// ec_* answers are read straight from survey_answers under RLS (own rows
// only), like /client/onboarding-medical does for medical_* keys:
// GET /api/v1/onboarding/survey returns only 12-step-wizard keys.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ECOMMERCE_SURVEY_HREF,
  INTEGRATION_NOTES,
  buildEcommerceView,
  extractEcommerceAnswers,
  formatKpiValue,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
  type EcommerceView,
  type KpiTile,
  type Provenance,
  type SurveyStep,
} from '@/lib/ecommerce/survey-view'

// ─── Data loading ─────────────────────────────────────────────────────────

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; answers: Record<string, unknown>; companyName: string | null; companyIndustry: string | null }

function useEcommerceView(): { state: LoadState; view: EcommerceView | null } {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sb = createClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) {
          if (!cancelled) setState({ status: 'error' })
          return
        }
        const [answersRes, company] = await Promise.all([
          sb
            .from('survey_answers')
            .select('question_key, answer')
            .eq('user_id', user.id)
            .like('question_key', 'ec_%'),
          // The company record is optional: without it the hero shows «Ваш магазин».
          fetch('/api/v1/onboarding/company', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null) as Promise<{ ok?: boolean; data?: { name?: unknown; industry?: unknown } | null } | null>,
        ])
        if (answersRes.error) throw answersRes.error
        if (cancelled) return
        const record = company?.ok ? company.data : null
        setState({
          status: 'ready',
          answers: extractEcommerceAnswers(answersRes.data),
          companyName: typeof record?.name === 'string' ? record.name : null,
          companyIndustry: typeof record?.industry === 'string' ? record.industry : null,
        })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const view = useMemo(
    () =>
      state.status === 'ready'
        ? buildEcommerceView(state.answers, { companyName: state.companyName, companyIndustry: state.companyIndustry })
        : null,
    [state],
  )
  return { state, view }
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function DashboardEcommercePage() {
  const { state, view } = useEcommerceView()
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Topbar />

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState />}
        {view && (
          <>
            <Hero view={view} />
            <KpiRow kpis={view.kpis} />
            <FunnelSection funnel={view.funnel} />
            <ChannelMix channels={view.channels} />
            <MarketplacesStrip marketplaces={view.marketplaces} />
            <SkuHealth catalog={view.catalog} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <RFMSection customers={view.customers} />
              <CohortLTV />
            </div>
            <CartRecovery cart={view.cartRecovery} />
            <Seasonality seasonality={view.seasonality} />
            <Operations operations={view.operations} />
            <GoalsStrip />
          </>
        )}
      </main>
    </div>
  )
}

// ─── States ───────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загружаем данные кабинета…</span>
      <div className="skeleton h-40 rounded-3xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
      </div>
      <div className="skeleton h-64 rounded-3xl" />
    </div>
  )
}

function ErrorState() {
  return (
    <section className="bg-surface-container-low rounded-3xl border border-error/20 p-8 text-center" role="alert">
      <span className="material-symbols-outlined text-3xl text-error" aria-hidden="true">error</span>
      <h2 className="font-headline text-2xl font-extrabold mt-2">Не удалось загрузить данные</h2>
      <p className="text-sm text-on-surface-variant mt-2">
        Мы не смогли получить ответы анкеты. Обновите страницу или попробуйте позже.
      </p>
      <Link
        href={ECOMMERCE_SURVEY_HREF}
        className="inline-flex items-center gap-1.5 mt-5 px-5 py-2.5 rounded-xl border border-white/[0.08] hover:border-primary/40 hover:text-primary transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">edit_note</span>
        Открыть анкету
      </Link>
    </section>
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
            href={ECOMMERCE_SURVEY_HREF}
            className="text-xs text-on-surface-variant hover:text-primary transition-colors hidden sm:inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
            Анкета
          </Link>
          <Link
            href="/client/onboarding/documents"
            className="text-xs text-on-surface-variant hover:text-primary transition-colors hidden sm:inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">upload</span>
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

function Hero({ view }: { view: EcommerceView }) {
  const { company, hasSurvey } = view
  return (
    <section className="bg-surface-container-low rounded-3xl border border-white/[0.06] p-8">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em]">КАБИНЕТ · E-COMMERCE</p>
            <span className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${
              hasSurvey
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-surface-container border-white/[0.08] text-on-surface-variant'
            }`}>
              {hasSurvey ? 'данные из анкеты' : 'анкета не заполнена'}
            </span>
          </div>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold">{company.name}</h1>
          <p className="text-on-surface-variant mt-1.5 text-sm">
            {company.details.length
              ? company.details.join(' · ')
              : 'Платформа, сайт и стаж магазина появятся после заполнения анкеты'}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={ECOMMERCE_SURVEY_HREF}
            className={`px-5 py-2.5 rounded-xl text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              hasSurvey
                ? 'border border-white/[0.08] hover:border-primary/40 hover:text-primary'
                : 'bg-primary text-on-primary font-semibold hover:bg-primary/90'
            }`}
          >
            <span className="material-symbols-outlined text-base align-middle mr-1" aria-hidden="true">edit_note</span>
            {hasSurvey ? 'Обновить анкету' : 'Заполнить анкету'}
          </Link>
        </div>
      </div>
      {!hasSurvey && (
        <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-sm text-on-surface-variant">
          Анкета e-commerce ещё не заполнена, поэтому показатели ниже пусты. Заполните 7 коротких шагов —
          и кабинет покажет цифры вашего магазина. Мы не подставляем примерные данные.
        </div>
      )}
    </section>
  )
}

function KpiRow({ kpis }: { kpis: KpiTile[] }) {
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((it) => (
        <div key={it.key} className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5 flex flex-col">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-2">{it.label}</p>
          <p className={`font-headline text-2xl font-extrabold ${it.value == null ? 'text-on-surface-variant' : 'text-on-surface'}`}>
            {formatKpiValue(it)}
          </p>
          {it.value != null && it.provenance ? (
            <ProvenanceCaption provenance={it.provenance} text={it.basis ?? undefined} className="mt-1" />
          ) : (
            <Link
              href={ECOMMERCE_SURVEY_HREF}
              className="mt-1 text-[10px] text-on-surface-variant/80 hover:text-primary transition-colors"
            >
              Нет данных · заполните шаг «{it.step}»
            </Link>
          )}
          <div className="flex items-center justify-between mt-auto pt-2 text-[10px] text-on-surface-variant/70">
            <span>{it.target == null ? 'Цель не задана' : `→ ${formatKpiValue({ value: it.target, unit: it.unit })}`}</span>
            <span className="font-mono" title="Динамика появится, когда будут данные за несколько периодов">
              {it.trend == null ? '—' : `${it.trend > 0 ? '+' : ''}${it.trend}%`}
            </span>
          </div>
        </div>
      ))}
    </section>
  )
}

function FunnelSection({ funnel }: { funnel: EcommerceView['funnel'] }) {
  const { stages, rates, missing, status } = funnel
  const max = stages[0]?.n ?? 0
  return (
    <SectionCard
      eyebrow="ВОРОНКА"
      title="Посетители → Корзина → Оплата"
      hint="Потери на каждом этапе. Посетители — из анкеты, остальные этапы — расчёт по вашим конверсиям."
    >
      {status === 'empty' ? (
        <SurveyEmpty step="Воронка" what="посещаемость и конверсии" />
      ) : (
        <div className="space-y-4">
          {stages.length > 0 && (
            <div className="space-y-3">
              {stages.map((stage, i) => {
                const widthPct = max > 0 ? Math.max((stage.n / max) * 100, 2) : 0
                const prevN = i === 0 ? null : stages[i - 1].n
                const drop = prevN ? ((1 - stage.n / prevN) * 100).toFixed(1) : null
                return (
                  <div key={stage.key} className="flex items-center gap-4">
                    <p className="text-sm font-medium w-24 flex-shrink-0">{stage.label}</p>
                    <div className="flex-1 h-10 bg-surface-container rounded-xl overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-xl flex items-center px-4"
                        style={{ width: `${widthPct}%` }}
                      >
                        <span className="text-xs font-mono font-bold text-on-primary">{formatNumber(stage.n)}</span>
                      </div>
                    </div>
                    <p className="text-xs font-mono text-on-surface-variant w-24 flex-shrink-0 text-right">
                      {stage.conv == null ? 'из анкеты' : `CR ${formatPercent(stage.conv * 100)}`}
                    </p>
                    <p className="text-xs font-mono text-error w-20 flex-shrink-0 text-right">
                      {drop ? `−${drop}%` : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
          {stages.length === 0 && (
            <div className="flex flex-wrap gap-3">
              {rates.visitToCart != null && <Fact label="CR Visit → Cart" value={formatPercent(rates.visitToCart)} provenance="survey" />}
              {rates.cartToPaid != null && <Fact label="CR Cart → Paid" value={formatPercent(rates.cartToPaid)} provenance="survey" />}
            </div>
          )}
          {stages.some((s) => s.provenance === 'calculated') && (
            <ProvenanceCaption provenance="calculated" text="расчёт по анкете: посетители × конверсии" />
          )}
          {missing.length > 0 && (
            <p className="text-xs text-on-surface-variant">
              Для полной воронки не хватает: {missing.join(', ')}.{' '}
              <Link href={ECOMMERCE_SURVEY_HREF} className="text-primary hover:underline">Дополнить анкету</Link>
            </p>
          )}
        </div>
      )}
    </SectionCard>
  )
}

function ChannelMix({ channels }: { channels: EcommerceView['channels'] }) {
  return (
    <SectionCard
      eyebrow="КАНАЛЫ ТРАФИКА"
      title="Атрибуция «канал → выручка»"
      hint="Активные каналы, бюджет и общий ROAS — из анкеты. Разбивка по каналам — после подключения аналитики."
    >
      {channels.status === 'empty' ? (
        <SurveyEmpty step="Трафик" what="каналы трафика, рекламный бюджет и ROAS" />
      ) : (
        <div className="space-y-5">
          {channels.active.length > 0 && <Chips label="Активные каналы" items={channels.active} />}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Fact label="Бюджет рекламы / мес" value={channels.monthlyBudget != null ? formatMoney(channels.monthlyBudget) : null} provenance="survey" />
            <Fact label="ROAS (выручка / реклама)" value={channels.roas != null ? formatRatio(channels.roas) : null} provenance="survey" />
            <Fact
              label="Выручка с рекламы / мес"
              value={channels.adRevenueMonthly != null ? formatMoney(channels.adRevenueMonthly) : null}
              provenance="calculated"
              caption="расчёт по анкете: бюджет × ROAS"
            />
          </div>
        </div>
      )}
      <IntegrationNote text={INTEGRATION_NOTES.channels} />
    </SectionCard>
  )
}

function MarketplacesStrip({ marketplaces }: { marketplaces: EcommerceView['marketplaces'] }) {
  return (
    <SectionCard
      eyebrow="МАРКЕТПЛЕЙСЫ"
      title="Где вы продаёте"
      hint="Площадки, доля выручки и топ-категории — из анкеты."
    >
      {marketplaces.status === 'empty' ? (
        <SurveyEmpty step="Маркетплейсы" what="площадки и долю выручки с маркетплейсов" />
      ) : marketplaces.notUsed ? (
        <p className="text-sm text-on-surface-variant">В анкете отмечено: с маркетплейсами вы не работаете.</p>
      ) : (
        <div className="space-y-5">
          {marketplaces.list.length > 0 && <Chips label="Площадки" items={marketplaces.list} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Fact label="Доля выручки с маркетплейсов" value={marketplaces.revenueShare != null ? formatPercent(marketplaces.revenueShare) : null} provenance="survey" />
            <Fact label="Топ-категории" value={marketplaces.topCategories} provenance="survey" />
          </div>
        </div>
      )}
      {!marketplaces.notUsed && <IntegrationNote text={INTEGRATION_NOTES.marketplaces} />}
    </SectionCard>
  )
}

function SkuHealth({ catalog }: { catalog: EcommerceView['catalog'] }) {
  return (
    <SectionCard
      eyebrow="КАТАЛОГ · SKU HEALTH"
      title="Каталог, dead stock и возвраты"
      hint="Размер каталога, доля dead stock и возвраты — из анкеты."
    >
      {catalog.status === 'empty' ? (
        <SurveyEmpty step="Каталог" what="размер каталога, dead stock и возвраты" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Fact label="Всего SKU" value={catalog.totalSku != null ? formatNumber(catalog.totalSku) : null} provenance="survey" />
            <Fact
              label="Активных за 90 дней"
              value={catalog.activeSku != null ? formatNumber(catalog.activeSku) : null}
              provenance="survey"
              caption={catalog.activeSharePct != null ? `${formatPercent(catalog.activeSharePct)} каталога · расчёт по анкете` : undefined}
            />
            <Fact label="Dead stock (>180 дн.)" value={catalog.deadStockPct != null ? formatPercent(catalog.deadStockPct) : null} provenance="survey" />
            <Fact label="Возвраты" value={catalog.returnsPct != null ? formatPercent(catalog.returnsPct) : null} provenance="survey" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Fact label="Продукт-локомотив" value={catalog.flagship} provenance="survey" />
            <Fact label="Самый маржинальный" value={catalog.mostMarginal} provenance="survey" />
            <Fact label="Топ-причина возвратов" value={catalog.topReturnReason} provenance="survey" />
          </div>
        </div>
      )}
      <IntegrationNote text={INTEGRATION_NOTES.catalog} />
    </SectionCard>
  )
}

function RFMSection({ customers }: { customers: EcommerceView['customers'] }) {
  return (
    <SectionCard
      eyebrow="RFM"
      title="Сегменты базы клиентов"
      hint="Recency × Frequency строится по истории заказов."
    >
      {customers.status === 'empty' ? (
        <SurveyEmpty step="Воронка" what="долю повторных покупок и NPS" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Fact label="Повторные покупки" value={customers.repeatRatePct != null ? formatPercent(customers.repeatRatePct) : null} provenance="survey" />
          <Fact label="NPS" value={customers.nps != null ? formatNumber(customers.nps) : null} provenance="survey" />
        </div>
      )}
      <IntegrationNote text={INTEGRATION_NOTES.customers} />
    </SectionCard>
  )
}

function CohortLTV() {
  return (
    <SectionCard
      eyebrow="COHORT LTV"
      title="Удержание по когортам"
      hint="Каждая строка — месяц первой покупки, % активных через N месяцев."
    >
      <EmptyBlock icon="table_chart" text="Нет данных. В анкете нет вопросов о когортах — таблица строится по истории заказов." />
      <IntegrationNote text={INTEGRATION_NOTES.cohorts} />
    </SectionCard>
  )
}

function CartRecovery({ cart }: { cart: EcommerceView['cartRecovery'] }) {
  return (
    <SectionCard
      eyebrow="CART RECOVERY"
      title={cart.abandonPct != null ? `${formatPercent(cart.abandonPct)} корзин брошено` : 'Брошенные корзины'}
      hint="Доля брошенных корзин — из анкеты. Сценарии возврата — после подключения рассылок."
    >
      {cart.status === 'empty' ? (
        <SurveyEmpty step="Воронка" what="долю брошенных корзин" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Fact label="Cart abandonment rate" value={cart.abandonPct != null ? formatPercent(cart.abandonPct) : null} provenance="survey" />
        </div>
      )}
      <IntegrationNote text={INTEGRATION_NOTES.cartRecovery} />
    </SectionCard>
  )
}

function Seasonality({ seasonality }: { seasonality: EcommerceView['seasonality'] }) {
  return (
    <SectionCard
      eyebrow="СЕЗОННОСТЬ"
      title="Пики продаж"
      hint="Месяцы пиков — по вашим ответам в анкете. Объём продаж по месяцам — после подключения источника."
    >
      {seasonality.status === 'empty' ? (
        <SurveyEmpty step="Финансы" what="пики продаж" />
      ) : seasonality.noPeaks ? (
        <p className="text-sm text-on-surface-variant">В анкете отмечено: выраженных пиков продаж нет.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-6 lg:grid-cols-12 gap-1.5" role="list" aria-label="Месяцы пиков продаж">
            {seasonality.months.map((m) => {
              const peak = m.tags.length > 0
              return (
                <div
                  key={m.label}
                  role="listitem"
                  className={`rounded-xl border p-2 text-center min-h-[64px] flex flex-col justify-between ${
                    peak ? 'bg-primary/15 border-primary/30' : 'bg-surface-container border-white/[0.04]'
                  }`}
                >
                  <span className={`text-[10px] font-mono ${peak ? 'text-primary' : 'text-on-surface-variant'}`}>{m.label}</span>
                  {peak && <span className="text-[9px] font-mono text-primary font-bold leading-tight">{m.tags.join(' · ')}</span>}
                </div>
              )
            })}
          </div>
          {seasonality.floating.length > 0 && <Chips label="Плавающие пики" items={seasonality.floating} />}
          <ProvenanceCaption provenance="survey" text="пики из анкеты" />
        </div>
      )}
      <IntegrationNote text={INTEGRATION_NOTES.seasonality} />
    </SectionCard>
  )
}

function Operations({ operations }: { operations: EcommerceView['operations'] }) {
  return (
    <SectionCard
      eyebrow="ЛОГИСТИКА · ФИНАНСЫ"
      title="Операционные показатели"
      hint="Маржа, поставщики, склад и доставка — из анкеты."
    >
      {operations.status === 'empty' ? (
        <SurveyEmpty step="Логистика" what="доставку, фулфилмент, маржу и оборачиваемость склада" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Fact label="Валовая маржа" value={operations.grossMarginPct != null ? formatPercent(operations.grossMarginPct) : null} provenance="survey" />
            <Fact label="Доля топ-1 поставщика" value={operations.supplierConcentrationPct != null ? formatPercent(operations.supplierConcentrationPct) : null} provenance="survey" />
            <Fact label="Оборачиваемость склада" value={operations.inventoryTurnoverDays != null ? `${formatNumber(operations.inventoryTurnoverDays)} дн.` : null} provenance="survey" />
            <Fact label="Доставка в среднем" value={operations.deliveryDays != null ? `${formatNumber(operations.deliveryDays)} дн.` : null} provenance="survey" />
          </div>
          {operations.fulfillment.length > 0 && <Chips label="Фулфилмент" items={operations.fulfillment} />}
          {operations.regions && <Fact label="Регионы поставки" value={operations.regions} provenance="survey" />}
        </div>
      )}
    </SectionCard>
  )
}

function GoalsStrip() {
  // Static reference list of common e-commerce growth levers — suggestions,
  // not the client's goals or progress.
  const goals = [
    { t: 'Привлечение',  d: 'Атрибуция канал/UTM по выручке' },
    { t: 'Удержание',     d: 'RFM + email/SMS retention flow' },
    { t: 'Чек (AOV)',     d: 'Bundles + free-shipping threshold' },
    { t: 'Частота',       d: 'Subscription / replenishment reminders' },
    { t: 'Сарафан',       d: 'UGC + рейтинги + реф-программа' },
    { t: 'BuyBox',        d: 'Win rate на маркетплейсах' },
    { t: 'Спрос',         d: 'Retargeting + abandoned-cart' },
    { t: 'Time-to-Pay',   d: 'Visit → оплата за минуты' },
    { t: 'CAC',           d: 'ROAS по каналу + LTV/CAC per канал' },
    { t: 'Conversion',    d: 'Visit → Cart → Paid funnel' },
    { t: 'Выбор вас',     d: 'Brand share of search + reviews' },
  ]
  return (
    <SectionCard
      eyebrow="ПОДСКАЗКИ · E-COM"
      title="Типовые цели для e-commerce"
      hint="Справочный список рычагов роста — это не ваш прогресс. Выберите приоритетные вместе с экспертом."
    >
      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {goals.map((g) => (
          <li key={g.t} className="bg-surface-container rounded-2xl border border-white/[0.04] p-4 hover:border-primary/30 transition-colors">
            <span className="material-symbols-outlined text-xl text-primary/70" aria-hidden="true">lightbulb</span>
            <p className="text-sm font-semibold mt-2">{g.t}</p>
            <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{g.d}</p>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

// ─── Small building blocks ────────────────────────────────────────────────

const PROVENANCE_TEXT: Record<Provenance, string> = {
  survey: 'из анкеты',
  calculated: 'расчёт по анкете',
}

function ProvenanceCaption({ provenance, text, className = '' }: { provenance: Provenance; text?: string; className?: string }) {
  return (
    <p className={`text-[10px] font-mono uppercase tracking-wider text-on-surface-variant/70 flex items-center gap-1 ${className}`}>
      <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
        {provenance === 'calculated' ? 'calculate' : 'assignment'}
      </span>
      {text ?? PROVENANCE_TEXT[provenance]}
    </p>
  )
}

function Fact({
  label, value, provenance, caption,
}: {
  label: string
  value: string | null
  provenance: Provenance
  caption?: string
}) {
  return (
    <div className="bg-surface-container rounded-2xl border border-white/[0.04] p-4">
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">{label}</p>
      {value != null ? (
        <>
          <p className="font-mono text-lg font-bold text-on-surface mt-1 break-words">{value}</p>
          <ProvenanceCaption provenance={provenance} text={caption} className="mt-1" />
        </>
      ) : (
        <p className="text-sm text-on-surface-variant/70 mt-1">Нет данных</p>
      )}
    </div>
  )
}

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <span key={it} className="px-3 py-1.5 rounded-xl text-xs bg-primary/10 border border-primary/20 text-primary">
            {it}
          </span>
        ))}
      </div>
      <ProvenanceCaption provenance="survey" className="mt-2" />
    </div>
  )
}

function EmptyBlock({ icon, text, children }: { icon: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-surface-container/40 p-6 text-center">
      <span className="material-symbols-outlined text-2xl text-on-surface-variant/60" aria-hidden="true">{icon}</span>
      <p className="text-sm text-on-surface-variant mt-2">{text}</p>
      {children}
    </div>
  )
}

function SurveyEmpty({ step, what }: { step: SurveyStep; what: string }) {
  return (
    <EmptyBlock icon="edit_note" text={`Нет данных. Заполните шаг «${step}» анкеты — ${what}.`}>
      <Link
        href={ECOMMERCE_SURVEY_HREF}
        className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
      >
        Заполнить анкету
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
      </Link>
    </EmptyBlock>
  )
}

function IntegrationNote({ text }: { text: string }) {
  return (
    <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/[0.04] bg-surface-container/60 px-4 py-3">
      <span className="material-symbols-outlined text-base text-on-surface-variant/70 mt-px" aria-hidden="true">link_off</span>
      <p className="text-xs text-on-surface-variant leading-relaxed">{text}</p>
    </div>
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
