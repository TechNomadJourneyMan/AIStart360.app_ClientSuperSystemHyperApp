import Link from 'next/link'
import { headers } from 'next/headers'
import CheckoutButton from '@/app/_components/CheckoutButton'
import { getPlan } from '@/lib/payments'

// Public landing — рассказывает о AIStart360 и ведёт на /login
// Auth'd users всё равно увидят landing; кликают «Войти» → middleware вернёт их в их панель.

// ── A/B POSITIONING VARIANTS ──────────────────────────────────────────────
// Switchable via ?v=1|2|3|4. v2 «GRI Health Check» is the baseline
// (решение ПО, Option 2). Each variant swaps the hero badge, headline,
// subheadline and CTAs; the rest of the page is shared. Pick with searchParams.v.
type HeroVariant = {
  badge: string
  headlineTop: string
  headlineAccent: string
  headlineBottom?: string
  subheadline: React.ReactNode
  primaryCta: { label: string; href: string }
  secondaryCta: { label: string; href: string }
}

const VARIANTS: Record<'1' | '2' | '3' | '4', HeroVariant> = {
  // v1 — Операционная система роста (legacy A/B)
  '1': {
    badge: 'Операционная система роста · v1.0',
    headlineTop: 'Управляйте ростом',
    headlineAccent: 'по цифрам —',
    headlineBottom: 'от диагностики до маршрута',
    subheadline: (
      <>
        AIStart360 — операционная система роста для собственника: от{' '}
        <span className="text-primary font-semibold">диагностики</span> до{' '}
        <span className="text-primary font-semibold">90-дневного маршрута</span> и{' '}
        <span className="text-primary font-semibold">живых метрик</span>. Закидываете
        отчёты — AI извлекает 30–60 ключевых полей.
      </>
    ),
    primaryCta: { label: 'Запустить диагностику бесплатно', href: '/register' },
    secondaryCta: { label: 'Узнать GRI бесплатно за 5 минут', href: '/gri-free' },
  },
  // v2 — GRI Health Check (baseline, решение ПО)
  '2': {
    badge: 'GRI Health Check · индекс за 5 минут',
    headlineTop: 'Проверьте готовность',
    headlineAccent: 'бизнеса к росту',
    headlineBottom: 'за 5 минут',
    subheadline: (
      <>
        Индекс готовности <span className="text-primary font-semibold">0–10</span> по{' '}
        <span className="text-primary font-semibold">7 блокам</span> бизнеса, главные
        ограничения и <span className="text-primary font-semibold">план на 90 дней</span>.
        Самооценка за 5 минут, дальше — сверка с данными из ваших отчётов и экспертные
        ориентиры вместо «магии».
      </>
    ),
    primaryCta: { label: 'Узнать свой индекс бесплатно', href: '/gri-free' },
    secondaryCta: { label: 'Полная диагностика — регистрация', href: '/register' },
  },
  // v3 — AI-агентство роста
  '3': {
    badge: 'AI-агентство роста',
    headlineTop: 'Ваша внешняя',
    headlineAccent: 'команда роста',
    headlineBottom: 'AI · эксперты · внедрение',
    subheadline: (
      <>
        <span className="text-primary font-semibold">AI-диагностика</span> +{' '}
        <span className="text-primary font-semibold">эксперты</span> +{' '}
        <span className="text-primary font-semibold">внедрение</span>. Внешняя команда
        роста, которая берёт цифры из ваших отчётов и доводит план до результата.
      </>
    ),
    primaryCta: { label: 'Собрать команду роста', href: '/register' },
    secondaryCta: { label: 'Узнать GRI бесплатно за 5 минут', href: '/gri-free' },
  },
  // v4 — Точка А → Точка Б
  '4': {
    badge: 'Точка А → Точка Б · 90 дней',
    headlineTop: 'Где вы сейчас,',
    headlineAccent: 'куда хотите —',
    headlineBottom: 'и как пройти путь за 90 дней',
    subheadline: (
      <>
        <span className="text-primary font-semibold">Точка А</span> — честная картина по
        цифрам. <span className="text-primary font-semibold">Точка Б</span> — 11 целей
        роста. Между ними — <span className="text-primary font-semibold">90-дневный
        маршрут</span> с gap-анализом и экспертными ориентирами.
      </>
    ),
    primaryCta: { label: 'Построить маршрут А → Б', href: '/register' },
    secondaryCta: { label: 'Узнать GRI бесплатно за 5 минут', href: '/gri-free' },
  },
}

function pickVariant(v: string | string[] | undefined): HeroVariant {
  const raw = Array.isArray(v) ? v[0] : v
  if (raw === '1' || raw === '3' || raw === '4') return VARIANTS[raw]
  return VARIANTS['2'] // default — «GRI Health Check» (Option 2, решение ПО)
}

// ── ГЕО-ВАЛЮТА (№18) ──────────────────────────────────────────────────────
// Каталог PLANS хранит цены в USD (minor units). Для витрины конвертируем в
// валюту региона по заголовку `x-vercel-ip-country`: KZ → ₸, RU/BY → ₽,
// остальные страны → $. Нет заголовка (локально/не-Vercel) → fallback ₸.
// Курсы — статические витринные ориентиры (не биржевые), суммы для не-USD
// показываются с «≈»; списание в USD по курсу на день оплаты (см. сноску).
type GeoCurrency = { code: 'USD' | 'KZT' | 'RUB'; symbol: string; perUsd: number }

const GEO_CURRENCIES: Record<GeoCurrency['code'], GeoCurrency> = {
  USD: { code: 'USD', symbol: '$', perUsd: 1 },
  KZT: { code: 'KZT', symbol: '₸', perUsd: 520 },
  RUB: { code: 'RUB', symbol: '₽', perUsd: 95 },
}

function resolveGeoCurrency(): GeoCurrency {
  let country: string | null = null
  try {
    country = headers().get('x-vercel-ip-country')
  } catch {
    country = null
  }
  if (!country) return GEO_CURRENCIES.KZT // fallback — ₸
  const c = country.toUpperCase()
  if (c === 'KZ') return GEO_CURRENCIES.KZT
  if (c === 'RU' || c === 'BY') return GEO_CURRENCIES.RUB
  return GEO_CURRENCIES.USD
}

// Human-readable amount from PLANS in the visitor's currency.
// USD — точная цена ($300); KZT/RUB — округлённый ориентир с «≈».
function planPrice(key: string, cur: GeoCurrency): string {
  const p = getPlan(key)
  if (!p) return ''
  const usd = p.amount / 100
  if (cur.code === 'USD') return `$${usd.toLocaleString('ru-RU')}`
  const raw = usd * cur.perUsd
  const rounded =
    cur.code === 'KZT' ? Math.round(raw / 1000) * 1000 : Math.round(raw / 500) * 500
  return `≈${rounded.toLocaleString('ru-RU')} ${cur.symbol}`
}

function freePrice(cur: GeoCurrency): string {
  return cur.code === 'USD' ? '$0' : `0 ${cur.symbol}`
}

const MODULES = [
  {
    n: '01',
    icon: 'monitor_heart',
    title: 'Диагностика',
    desc: 'Анкета 12 шагов + AI-парсинг ваших P&L, баланса, отчётов CRM. Берёт цифры из ваших документов автоматически.',
  },
  {
    n: '02',
    icon: 'bar_chart',
    title: '122 метрики',
    desc: 'По 7 отделам с привязкой к источнику. Каждая метрика знает откуда брать данные: поле анкеты, выгрузка из 1С, документ, GA или CRM.',
  },
  {
    n: '03',
    icon: 'route',
    title: 'Точка А → Точка Б',
    desc: '11 целей роста + 90-дневный план. Видно куда двигаться, gap-анализ автоматом, бенчмарки по отрасли.',
  },
  {
    n: '04',
    icon: 'bolt',
    title: 'Исполнение',
    desc: 'Интеграции с Bitrix24, AmoCRM, n8n, Telegram, e-mail. Алёрты при отклонениях, weekly digest.',
  },
] as const

const GRI_BLOCKS = [
  { label: 'Бизнес-модель',        score: 7.4,  status: 'ok' },
  { label: 'Готовность основателя', score: 6.7,  status: 'ok' },
  { label: 'Доверие и позиция',     score: 5.17, status: 'weak' },
  { label: 'Стабильность кассы',    score: 5.0,  status: 'weak' },
  { label: 'Продукт и спрос',       score: 4.7,  status: 'weak' },
  { label: 'Команда',               score: 2.55, status: 'critical' },
  { label: 'Операции',              score: 2.14, status: 'critical' },
] as const

const DEPTS = [
  { icon: 'payments',     name: 'Финансы',  n: 8,  kpis: 'Выручка · EBITDA · ROA · Cash Flow' },
  { icon: 'ads_click',    name: 'Маркетинг', n: 9, kpis: 'CAC · CPL · NPS · ER' },
  { icon: 'handshake',    name: 'Продажи',  n: 7,  kpis: 'Чек · Win Rate · TTR' },
  { icon: 'settings',     name: 'Операции', n: 7,  kpis: 'SLA · SKU · Брак' },
  { icon: 'groups',       name: 'HR',       n: 6,  kpis: 'Текучка · eNPS · OKR' },
  { icon: 'inventory_2',  name: 'Продукт',  n: 5,  kpis: 'Доля рынка · Экспорт' },
  { icon: 'person',       name: 'Клиенты',  n: 6,  kpis: 'Churn · Retention · ARPU' },
] as const

function griColor(s: string) {
  if (s === 'critical') return 'bg-error text-error'
  if (s === 'weak') return 'bg-tertiary-container text-tertiary-container'
  return 'bg-primary text-primary'
}

export default function LandingPage({
  searchParams,
}: {
  searchParams: { v?: string | string[] }
}) {
  const variant = pickVariant(searchParams?.v)
  const currency = resolveGeoCurrency()
  const proMonthlyPrice = planPrice('pro_monthly', currency)
  const proOnetimePrice = planPrice('pro_onetime', currency)

  return (
    <div className="min-h-screen bg-surface text-on-surface">

      {/* ── NAV ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-surface/70 border-b border-white/[0.04]">
        <nav className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl">radar</span>
            <span className="font-headline text-xl font-extrabold tracking-tight">
              AIStart<span className="text-primary">360</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-on-surface-variant">
            <a href="#modules" className="hover:text-primary transition-colors">Модули</a>
            <a href="#gri" className="hover:text-primary transition-colors">GRI Health Check</a>
            <a href="#sample" className="hover:text-primary transition-colors">Пример отчёта</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Тарифы</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Войти
            </Link>
            <Link
              href="/register"
              className="bg-primary text-on-primary text-sm font-semibold px-4 py-2 rounded-xl hover:bg-primary-fixed transition-all hover:shadow-lg hover:shadow-primary/30"
            >
              Попробовать
            </Link>
          </div>
        </nav>
      </header>

      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Glow blobs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-20 lg:py-32">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full mb-8">
              <span className="status-dot-online" />
              <span className="text-xs font-mono text-primary uppercase tracking-wider">
                {variant.badge}
              </span>
            </div>

            <h1 className="font-headline text-5xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight">
              {variant.headlineTop} <br />
              <span className="text-gradient">{variant.headlineAccent}</span>
              {variant.headlineBottom && (
                <>
                  <br />
                  {variant.headlineBottom}
                </>
              )}
            </h1>

            <p className="mt-8 text-xl text-on-surface-variant max-w-2xl leading-relaxed">
              {variant.subheadline}
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href={variant.primaryCta.href}
                className="group bg-primary text-on-primary font-semibold px-6 py-3.5 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all"
              >
                {variant.primaryCta.label}
                <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
              </Link>
              <Link
                href={variant.secondaryCta.href}
                className="group border border-primary/30 text-primary px-6 py-3.5 rounded-xl flex items-center gap-2 hover:border-primary/60 hover:bg-primary/5 transition-colors"
              >
                <span className="material-symbols-outlined">bolt</span>
                {variant.secondaryCta.label}
              </Link>
            </div>

            {/* Stats strip */}
            <div className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.04] rounded-2xl overflow-hidden border border-white/[0.04]">
              {[
                { v: '0–10',  l: 'индекс готовности' },
                { v: '7',     l: 'блоков бизнеса' },
                { v: '5 мин', l: 'на самооценку' },
                { v: '90 дн', l: 'план действий' },
              ].map((s, i) => (
                <div key={i} className="bg-surface-container-low p-6">
                  <p className="font-mono text-3xl font-bold text-primary">{s.v}</p>
                  <p className="text-xs text-on-surface-variant mt-1 uppercase tracking-wider">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ───────────────────────────────────── */}
      <section aria-label="Доверие" className="border-t border-white/[0.04] bg-surface-container-low/60">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-[0.25em] flex-shrink-0">
              нам доверяют
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:flex-1">
              {[
                { icon: 'inventory_2',    v: '500+',          l: 'диагностик · 2024–26' },
                { icon: 'category',       v: '27',            l: 'отраслей покрыто' },
                { icon: 'public',         v: 'СНГ + MENA',    l: 'регионы запуска' },
                { icon: 'verified',       v: '92%',           l: 'точность AI-парсера' },
                { icon: 'shield_lock',    v: 'self-host',     l: 'данные на твоей инфре' },
              ].map((b) => (
                <div
                  key={b.l}
                  className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-surface-container border border-white/[0.06]"
                >
                  <span className="material-symbols-outlined text-primary text-base">{b.icon}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-bold text-on-surface text-sm">{b.v}</span>
                    <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-wider whitespace-nowrap">
                      {b.l}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── MODULES ────────────────────────────────────────── */}
      <section id="modules" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              4 модуля
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              От самооценки до <span className="text-gradient">плана на 90 дней</span>
            </h2>
            <p className="mt-6 text-lg text-on-surface-variant">
              Диагностика → Метрики → План → Исполнение. Без бесконечных Excel,
              без «общих мест», без «надо обсудить с консультантом».
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {MODULES.map((m) => (
              <div
                key={m.n}
                className="group bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/30 hover:bg-surface-container transition-all"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <span className="material-symbols-outlined text-primary">{m.icon}</span>
                  </div>
                  <span className="font-mono text-xs text-on-surface-variant/50">{m.n}</span>
                </div>
                <h3 className="font-headline text-xl font-bold mb-2">{m.title}</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── METRICS GRID ──────────────────────────────────── */}
      <section id="metrics" className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                Все метрики бизнеса
              </p>
              <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
                Каждая метрика знает <br />
                <span className="text-gradient">откуда взять данные</span>
              </h2>
            </div>
            <p className="text-lg text-on-surface-variant max-w-md">
              Поле анкеты, выгрузка из CRM, документ от поставщика, GA или внешний API.
              Не «общее место», а конкретный путь к цифре.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {DEPTS.map((d) => (
              <div
                key={d.name}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-surface-container border border-white/[0.04] flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-lg">{d.icon}</span>
                  </div>
                  <span className="font-mono text-2xl font-bold text-primary">{d.n}</span>
                </div>
                <p className="text-sm font-semibold mb-1">{d.name}</p>
                <p className="text-xs text-on-surface-variant/80 leading-relaxed">{d.kpis}</p>
              </div>
            ))}
            <div className="bg-primary/10 border border-primary/30 rounded-2xl p-5 flex flex-col justify-between min-h-[140px]">
              <p className="text-xs font-mono text-primary uppercase tracking-wider">всего</p>
              <p className="font-headline text-4xl font-extrabold text-primary">122</p>
              <p className="text-xs text-on-primary-container">метрики</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── GRI PULSE PREVIEW ─────────────────────────────── */}
      <section id="gri" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                GRI Health Check
              </p>
              <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
                Индекс готовности <br />
                <span className="text-gradient">0–10 по 7 блокам</span>
              </h2>
              <p className="mt-6 text-lg text-on-surface-variant">
                Бизнес-модель, основатель, доверие, касса, продукт, команда, операции.
                Одна цифра на блок — и сразу видно, где «бутылочное горлышко»
                и что чинить первым.
              </p>
              <div className="mt-8 space-y-3">
                {[
                  { i: 'check_circle', t: 'Самооценка + сверка с данными', d: 'Ответы анкеты сверяются с цифрами из ваших документов' },
                  { i: 'compass_calibration', t: 'Экспертные ориентиры', d: 'Целевой уровень ≥7/10 по каждому блоку — не «средняя по больнице»' },
                  { i: 'priority_high', t: 'Топ-5 ограничений', d: 'Что чинить первым — конкретные действия' },
                ].map((p) => (
                  <div key={p.t} className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-primary text-base mt-0.5">{p.i}</span>
                    <div>
                      <p className="text-sm font-semibold">{p.t}</p>
                      <p className="text-xs text-on-surface-variant">{p.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual: GRI score panel */}
            <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-1">GRI Score</p>
                  <p className="font-headline text-4xl font-extrabold text-on-surface">
                    4.59<span className="text-on-surface-variant/50 text-2xl">/10</span>
                  </p>
                </div>
                <div className="relative w-20 h-20">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke="currentColor" strokeWidth="10" strokeLinecap="round"
                      className="text-tertiary-container"
                      strokeDasharray={`${(4.59 / 10) * 251.2} 251.2`}
                    />
                  </svg>
                </div>
              </div>
              <div className="space-y-2.5">
                {GRI_BLOCKS.map((b) => {
                  const clr = griColor(b.status)
                  return (
                    <div key={b.label} className="flex items-center gap-3">
                      <p className="text-xs text-on-surface w-32 flex-shrink-0 truncate">{b.label}</p>
                      <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${clr.split(' ')[0]}`}
                          style={{ width: `${(b.score / 10) * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono font-bold w-10 text-right ${clr.split(' ')[1]}`}>
                        {b.score}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SAMPLE REPORT (№13) ───────────────────────────── */}
      <section id="sample" className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              Пример отчёта
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              Что вы получите <br />
              <span className="text-gradient">после диагностики</span>
            </h2>
            <p className="mt-6 text-lg text-on-surface-variant">
              Четыре части отчёта GRI Health Check. Цифры ниже — условный пример,
              ваш отчёт строится на ваших ответах и данных.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* 1 — Индекс */}
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary">speed</span>
              </div>
              <h3 className="font-headline text-lg font-bold mb-3">Индекс готовности</h3>
              <div className="bg-surface-container rounded-xl border border-white/[0.04] p-4 mb-4">
                <p className="font-mono text-3xl font-extrabold text-primary">
                  6.2<span className="text-on-surface-variant/50 text-lg">/10</span>
                </p>
                <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider mt-1">
                  цель ≥ 7.0
                </p>
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed mt-auto">
                Одна цифра — насколько бизнес готов к росту. Взвешенная сумма 7 блоков.
              </p>
            </div>

            {/* 2 — Радар 7 блоков */}
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary">radar</span>
              </div>
              <h3 className="font-headline text-lg font-bold mb-3">Радар 7 блоков</h3>
              <div className="bg-surface-container rounded-xl border border-white/[0.04] p-4 mb-4 space-y-1.5">
                {[
                  { l: 'Бизнес-модель', ok: true },
                  { l: 'Касса', ok: false },
                  { l: 'Команда', ok: false },
                  { l: '… ещё 4 блока', ok: true },
                ].map((b) => (
                  <div key={b.l} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${b.ok ? 'bg-primary' : 'bg-error'}`} />
                    <span className="text-xs text-on-surface-variant">{b.l}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed mt-auto">
                Профиль сильных и слабых блоков — видно, что тянет индекс вниз.
              </p>
            </div>

            {/* 3 — Топ-5 ограничений */}
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary">priority_high</span>
              </div>
              <h3 className="font-headline text-lg font-bold mb-3">Топ-5 ограничений</h3>
              <div className="bg-surface-container rounded-xl border border-white/[0.04] p-4 mb-4 space-y-1.5">
                {[
                  '1. Процессы держатся на основателе',
                  '2. Нет управленческой отчётности',
                  '3. Один канал даёт 80% выручки',
                  '…',
                ].map((line) => (
                  <p key={line} className="text-xs text-on-surface-variant leading-snug">{line}</p>
                ))}
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed mt-auto">
                Главные «бутылочные горлышки» и почему именно они держат рост.
              </p>
            </div>

            {/* 4 — План 90 дней */}
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary">route</span>
              </div>
              <h3 className="font-headline text-lg font-bold mb-3">План на 90 дней</h3>
              <div className="bg-surface-container rounded-xl border border-white/[0.04] p-4 mb-4 space-y-1.5">
                {[
                  { p: 'Дни 1–30', t: 'навести учёт' },
                  { p: 'Дни 31–60', t: 'разгрузить основателя' },
                  { p: 'Дни 61–90', t: 'второй канал продаж' },
                ].map((s) => (
                  <div key={s.p} className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-primary uppercase tracking-wider flex-shrink-0">{s.p}</span>
                    <span className="text-xs text-on-surface-variant">{s.t}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed mt-auto">
                Последовательность шагов под ваши ограничения — с чего начать уже на этой неделе.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <Link
              href="/gri-free"
              className="group bg-primary text-on-primary font-semibold px-6 py-3.5 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Попробовать бесплатный mini-GRI
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
            </Link>
            <p className="text-sm text-on-surface-variant">
              5 минут · без карты · сокращённая версия отчёта сразу на экране
            </p>
          </div>
        </div>
      </section>

      {/* ── AI PARSER ─────────────────────────────────────── */}
      <section className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              AI-парсер документов
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              P&L, баланс, CRM-выгрузки — <br />
              <span className="text-gradient">в один клик</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: 'upload_file',
                t: 'Файл',
                d: 'PDF · DOCX · XLSX · CSV · TXT до 50 МБ',
              },
              {
                icon: 'auto_awesome',
                t: 'AI извлекает',
                d: 'OpenRouter Sonnet парсит, schema-валидация zod, эвристический fallback',
              },
              {
                icon: 'route',
                t: 'Поля → отделы',
                d: 'Выручка → Финансы, CAC → Маркетинг, SKU → Операции',
              },
            ].map((s, i) => (
              <div key={i} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-primary">{s.icon}</span>
                </div>
                <h3 className="font-headline text-xl font-bold mb-2">{s.t}</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 bg-primary/5 border border-primary/20 rounded-2xl p-6 flex items-center gap-4">
            <span className="material-symbols-outlined text-primary text-3xl">verified</span>
            <p className="text-sm text-on-surface">
              <span className="text-primary font-semibold">47 полей за 8 секунд, точность маппинга 92%</span>
              {' '}— замер на 3-страничном P&L в демо.
            </p>
          </div>
        </div>
      </section>

      {/* ── VS CONSULTING (№14) ───────────────────────────── */}
      <section id="vs-consulting" className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              Честное сравнение
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              Тот же первый шаг — <br />
              <span className="text-gradient">без консалтингового прайса</span>
            </h2>
            <p className="mt-6 text-lg text-on-surface-variant">
              Мы не заменяем консультанта. Мы делаем первый честный срез —
              до того, как вы решите за него платить.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Консультант-диагност */}
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8">
              <p className="text-xs font-mono text-on-surface-variant uppercase tracking-[0.2em] mb-3">
                Консультант-диагност
              </p>
              <p className="font-headline text-3xl font-extrabold mb-1">$5 000–25 000</p>
              <p className="font-mono text-sm text-on-surface-variant mb-6">4–6 недель на диагностику</p>
              <ul className="space-y-2.5 text-sm">
                {[
                  'Интервью, воркшопы, погружение в контекст',
                  'Глубокая отраслевая экспертиза — если повезёт с консультантом',
                  'Отчёт и стратегическая сессия в конце',
                  'Оправдан, когда нужен взгляд извне и сопровождение',
                ].map((it) => (
                  <li key={it} className="flex items-start gap-2 text-on-surface-variant">
                    <span className="material-symbols-outlined text-on-surface-variant/50 text-base mt-0.5">remove</span>
                    {it}
                  </li>
                ))}
              </ul>
            </div>

            {/* AIStart360 */}
            <div className="bg-primary/5 rounded-2xl border border-primary/30 p-8">
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                AIStart360 · GRI Health Check
              </p>
              <p className="font-headline text-3xl font-extrabold mb-1">Индекс + план за вечер</p>
              <p className="font-mono text-sm text-on-surface-variant mb-6">старт — бесплатный mini-GRI</p>
              <ul className="space-y-2.5 text-sm">
                {[
                  'Самооценка за 5 минут + сверка с данными из отчётов',
                  'Экспертные ориентиры по 7 блокам — целевой ≥7/10',
                  'Топ-5 ограничений и план на 90 дней',
                  'Честно: глубину живого консультанта не заменяет',
                ].map((it) => (
                  <li key={it} className="flex items-start gap-2 text-on-surface">
                    <span className="material-symbols-outlined text-primary text-base mt-0.5">check_circle</span>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Мини-ROI строка */}
          <div className="mt-6 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 flex items-start gap-4">
            <span className="material-symbols-outlined text-primary text-3xl">schedule</span>
            <p className="text-sm text-on-surface leading-relaxed">
              <span className="font-semibold">Простая арифметика:</span> один час «хаоса»
              в неделю — это ~50 часов в год. Если диагностика поможет вернуть хотя бы
              его — вечер на прохождение уже окупился. Результат мы не обещаем:
              мы показываем узкие места, решения принимаете вы.
            </p>
          </div>
        </div>
      </section>

      {/* ── PRICING / CTA ─────────────────────────────────── */}
      <section id="pricing" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              Тарифы
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              Начните бесплатно — <br />
              <span className="text-gradient">платите, когда увидите ценность</span>
            </h2>
            <p className="mt-6 text-lg text-on-surface-variant">
              30 дней пилота без карты. Дальше — подписка {proMonthlyPrice}/мес или разовый
              доступ {proOnetimePrice}. Без скрытых платежей.
            </p>
            <Link
              href="/gri-free"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline underline-offset-4"
            >
              <span className="material-symbols-outlined text-base">bolt</span>
              Узнать GRI бесплатно за 5 минут
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ── PILOT ── */}
            <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-8 flex flex-col">
              <p className="text-xs font-mono text-on-surface-variant uppercase tracking-[0.2em] mb-3">
                Pilot · бесплатно
              </p>
              <h3 className="font-headline text-3xl font-extrabold mb-1">30 дней бесплатно</h3>
              <p className="font-mono text-sm text-on-surface-variant mb-4">{freePrice(currency)} · без карты</p>
              <p className="text-on-surface-variant mb-6 flex-1">
                Анкета + парсинг 2 кварталов отчётов. Получаете Точку А, GRI, 11 целей,
                90-дневный план. Без обязательств.
              </p>
              <ul className="space-y-2 mb-8 text-sm">
                {['Полный доступ к 122 метрикам', 'AI-парсер до 20 документов', 'Email + Telegram алёрты', '1 пользователь'].map((it) => (
                  <li key={it} className="flex items-center gap-2 text-on-surface-variant">
                    <span className="material-symbols-outlined text-primary text-base">check</span>
                    {it}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className="border border-white/[0.08] text-on-surface text-center font-semibold px-6 py-3.5 rounded-xl hover:border-primary/40 hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                Начать пилот
              </Link>
            </div>

            {/* ── PRO (hybrid: subscription + one-time) ── */}
            <div className="bg-primary/5 rounded-3xl border border-primary/30 p-8 flex flex-col relative overflow-hidden">
              <div className="absolute -top-20 -right-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                Pro · полный доступ
              </p>
              <h3 className="font-headline text-3xl font-extrabold mb-1">
                {proMonthlyPrice} / мес
                <span className="text-on-surface-variant/60 text-lg font-bold">
                  {' '}или {proOnetimePrice} разово
                </span>
              </h3>
              <p className="font-mono text-sm text-on-surface-variant mb-4">подписка или разовая покупка</p>
              <p className="text-on-surface-variant mb-6 flex-1">
                После пилота. Подписка обновляет метрики и сопровождение каждый месяц;
                разовый доступ — для одного полного цикла диагностики и стратегии.
              </p>
              <ul className="space-y-2 mb-8 text-sm">
                {[
                  'Всё из Pilot',
                  'Безлимитный парсинг документов',
                  'Интеграции Bitrix24 / AmoCRM / 1С / GA',
                  'Эксперт-сопровождение раз в месяц',
                  'До 10 пользователей',
                ].map((it) => (
                  <li key={it} className="flex items-center gap-2 text-on-surface">
                    <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                    {it}
                  </li>
                ))}
              </ul>

              {/* Two checkout options — both map to PLANS via /api/checkout */}
              <div className="flex flex-col gap-3">
                <CheckoutButton
                  planKey="pro_monthly"
                  label={`Оформить подписку · ${proMonthlyPrice}/мес`}
                  variant="primary"
                />
                <CheckoutButton
                  planKey="pro_onetime"
                  label={`Разовый доступ · ${proOnetimePrice}`}
                  variant="outline"
                />
                <p className="text-[11px] text-on-surface-variant/60 text-center mt-1">
                  Оплата через Stripe · CloudPayments · Kaspi · Halyk · Мир
                </p>
                {currency.code !== 'USD' && (
                  <p className="text-[11px] text-on-surface-variant/60 text-center">
                    Суммы в {currency.symbol} — ориентир. Расчёт в USD
                    (${(getPlan('pro_monthly')!.amount / 100)}/мес или $
                    {getPlan('pro_onetime')!.amount / 100} разово) по курсу на день оплаты.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────── */}
      <section className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-24 text-center">
          <h2 className="font-headline text-4xl lg:text-6xl font-extrabold leading-tight max-w-3xl mx-auto">
            5 минут сегодня — <br />
            <span className="text-gradient">и вы знаете, что чинить первым</span>
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant max-w-xl mx-auto">
            Бесплатный mini-GRI → полная диагностика с данными → план на 90 дней.
            Без карты и без звонка менеджера.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <Link
              href="/gri-free"
              className="bg-primary text-on-primary font-semibold px-8 py-4 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all"
            >
              <span className="material-symbols-outlined">bolt</span>
              Проверить готовность к росту
            </Link>
            <Link
              href="/register"
              className="border border-white/[0.08] text-on-surface px-8 py-4 rounded-xl flex items-center gap-2 hover:border-primary/40 hover:text-primary transition-colors"
            >
              Полная диагностика
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.04] bg-surface-container-low/50">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">radar</span>
            <span className="font-headline text-base font-bold">
              AIStart<span className="text-primary">360</span>
            </span>
            <span className="text-xs text-on-surface-variant ml-3">© 2026</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-on-surface-variant">
            <a href="mailto:hello@aistart360.app" className="hover:text-primary transition-colors">
              hello@aistart360.app
            </a>
            <span>Almaty · Tashkent</span>
            <a href="/login" className="hover:text-primary transition-colors">Войти</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
