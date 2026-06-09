import Link from 'next/link'
import Image from 'next/image'
import { InfoHint } from '@/components/landing/InfoHint'

// Логотип портала (/logo.svg) — рендерим напрямую, без клиентского враппера,
// чтобы не создавать client-boundary внутри серверной страницы.
function BrandLogo({ className = 'h-7' }: { className?: string }) {
  return (
    <Link href="/" className="inline-flex items-center select-none">
      <Image
        src="/logo.svg"
        alt="AIStart360"
        width={148}
        height={27}
        priority
        className={`w-auto ${className}`}
      />
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  Public landing — рассказывает о возможностях AIStart360 и ведёт
//  на /register. Стиль строго наследует портал: тёмная тема, teal-акцент,
//  Bricolage Grotesque / JetBrains Mono, glass-панели, Material Symbols.
// ─────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '#features', label: 'Возможности' },
  { href: '#journey',  label: 'Точка А → Б' },
  { href: '#gri',      label: 'GRI' },
  { href: '#metrics',  label: 'Метрики' },
] as const

// Как это работает — путь клиента
const STEPS = [
  {
    n: '01',
    icon: 'app_registration',
    title: 'Регистрация и анкета',
    desc: '12 коротких шагов о бизнесе. Без консультанта, без созвонов — заполняете сами за 10–15 минут.',
    meta: '~15 минут',
  },
  {
    n: '02',
    icon: 'upload_file',
    title: 'Загружаете отчёты',
    desc: 'P&L, баланс, выгрузки из CRM и 1С. AI-парсер сам достаёт 30–60 ключевых цифр из ваших файлов.',
    meta: 'PDF · XLSX · CSV · DOCX',
  },
  {
    n: '03',
    icon: 'my_location',
    title: 'Получаете Точку А',
    desc: 'GRI-балл, сильные и слабые блоки, риски и быстрые победы — диагностика готова в тот же день.',
    meta: 'GRI + 122 метрики',
  },
  {
    n: '04',
    icon: 'route',
    title: 'Идёте в Точку Б',
    desc: '11 целей роста, GAP-анализ и 90-дневная дорожная карта с конкретными шагами на каждую неделю.',
    meta: 'План на 90 дней',
  },
] as const

// Полная витрина функционала — то, что внутри портала
const CAPABILITIES = [
  {
    icon: 'monitor_heart',
    term: 'ии-диагностика',
    title: 'ИИ-диагностика',
    desc: 'Анкета + AI-парсинг документов. Система сама собирает финансы, маркетинг, продажи и операции в единую картину.',
  },
  {
    icon: 'radar',
    term: 'gri',
    title: 'GRI — индекс готовности',
    desc: '7 блоков готовности к росту: бизнес-модель, основатель, доверие, касса, продукт, команда, операции. Один балл /10.',
  },
  {
    icon: 'fact_check',
    term: 'gri-test',
    title: 'GRI-тест',
    desc: 'Быстрый опросник готовности. Отвечаете на блок вопросов — сразу видите расчёт GRI и слабые зоны.',
  },
  {
    icon: 'cell_tower',
    term: 'gri-pulse',
    title: 'GRI Pulse',
    desc: 'Живой мониторинг готовности. Балл пересчитывается на новых данных — видно динамику и отклонения в реальном времени.',
  },
  {
    icon: 'my_location',
    term: 'точка-а',
    title: 'Точка А',
    desc: 'Где бизнес сейчас: GRI-балл, сильные и слабые блоки, риски, быстрые победы и стратегические приоритеты от ИИ.',
  },
  {
    icon: 'flag',
    term: 'точка-б',
    title: 'Точка Б',
    desc: 'Куда идём: 11 целей роста, GAP-анализ между А и Б и дорожная карта на 90 дней.',
  },
  {
    icon: 'monitoring',
    term: 'метрики',
    title: '122 метрики',
    desc: 'Все показатели по 7 отделам. Каждая метрика знает источник: поле анкеты, выгрузка 1С, документ, GA или CRM.',
  },
  {
    icon: 'public',
    term: 'рынок',
    title: 'Рынок',
    desc: 'Объём ниши, динамика и позиция вашей компании — с привязкой к вашим собственным цифрам.',
  },
  {
    icon: 'compare_arrows',
    term: 'конкуренты',
    title: 'Конкуренты',
    desc: 'Сравнение с игроками рынка по ключевым KPI: где вы выигрываете, а где отстаёте.',
  },
  {
    icon: 'lightbulb',
    term: 'инсайты',
    title: 'Инсайты',
    desc: 'ИИ объясняет, что стоит за цифрами: формулирует выводы и гипотезы простым человеческим языком.',
  },
  {
    icon: 'hub',
    term: 'разведка',
    title: 'Разведка',
    desc: 'Сбор и связывание данных о рынке и конкурентах в единую карту для управленческих решений.',
  },
  {
    icon: 'alt_route',
    term: 'сценарии',
    title: 'Сценарии',
    desc: 'What-if моделирование: «что будет с выручкой, если…». Проигрываете решения до того, как потратили деньги.',
  },
] as const

// GRI-блоки для превью score-панели (реальная структура портала)
const GRI_BLOCKS = [
  { label: 'Бизнес-модель',         score: 7.4,  status: 'ok' },
  { label: 'Готовность основателя', score: 6.7,  status: 'ok' },
  { label: 'Доверие и позиция',     score: 5.17, status: 'weak' },
  { label: 'Стабильность кассы',    score: 5.0,  status: 'weak' },
  { label: 'Продукт и спрос',       score: 4.7,  status: 'weak' },
  { label: 'Команда',               score: 2.55, status: 'critical' },
  { label: 'Операции',              score: 2.14, status: 'critical' },
] as const

const DEPTS = [
  { icon: 'payments',    name: 'Финансы',   n: 8, kpis: 'Выручка · EBITDA · ROA · Cash Flow' },
  { icon: 'ads_click',   name: 'Маркетинг', n: 9, kpis: 'CAC · CPL · NPS · ER' },
  { icon: 'handshake',   name: 'Продажи',   n: 7, kpis: 'Чек · Win Rate · TTR' },
  { icon: 'settings',    name: 'Операции',  n: 7, kpis: 'SLA · SKU · Брак' },
  { icon: 'groups',      name: 'HR',        n: 6, kpis: 'Текучка · eNPS · OKR' },
  { icon: 'inventory_2', name: 'Продукт',   n: 5, kpis: 'Доля рынка · Экспорт' },
  { icon: 'person',      name: 'Клиенты',   n: 6, kpis: 'Churn · Retention · ARPU' },
] as const

function griBarColor(status: string) {
  if (status === 'critical') return 'bg-error'
  if (status === 'weak') return 'bg-tertiary-container'
  return 'bg-primary'
}
function griTextColor(status: string) {
  if (status === 'critical') return 'text-error'
  if (status === 'weak') return 'text-tertiary-container'
  return 'text-primary'
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface text-on-surface antialiased">

      {/* ── NAV ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-surface/70 border-b border-white/[0.04]">
        <nav className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <BrandLogo />
          <div className="hidden md:flex items-center gap-8 text-sm text-on-surface-variant">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-primary transition-colors">
                {l.label}
              </a>
            ))}
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
              Начать бесплатно
            </Link>
          </div>
        </nav>
      </header>

      {/* ── HERO ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute -top-48 -right-40 w-[640px] h-[640px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 -left-48 w-[520px] h-[520px] bg-secondary/[0.06] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute inset-0 noise-overlay" />

        <div className="relative max-w-7xl mx-auto px-6 py-20 lg:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-12 items-center">

            {/* Left — message */}
            <div>
              <div className="landing-rise inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full mb-8">
                <span className="status-dot-online" />
                <span className="text-xs font-mono text-primary uppercase tracking-wider">
                  AI-операционка для собственника
                </span>
              </div>

              <h1 className="landing-rise font-headline text-5xl lg:text-[4.25rem] font-extrabold leading-[1.04] tracking-tight" style={{ animationDelay: '0.05s' }}>
                Управляйте бизнесом <br />
                <span className="text-gradient">по цифрам</span>, <br />
                а не по ощущениям
              </h1>

              <p className="landing-rise mt-8 text-lg lg:text-xl text-on-surface-variant max-w-xl leading-relaxed" style={{ animationDelay: '0.12s' }}>
                Загружаете отчёты — ИИ извлекает ключевые цифры и собирает{' '}
                <span className="text-on-surface font-medium">диагностику бизнеса</span>:
                индекс готовности <span className="text-primary font-semibold">GRI</span><InfoHint term="gri" />,{' '}
                <span className="text-primary font-semibold">Точку А</span><InfoHint term="точка-а" />,{' '}
                <span className="text-primary font-semibold">11 целей</span> и{' '}
                <span className="text-primary font-semibold">90-дневный маршрут</span> к{' '}
                <span className="text-primary font-semibold">Точке Б</span><InfoHint term="точка-б" />.
              </p>

              <div className="landing-rise mt-10 flex flex-wrap gap-4" style={{ animationDelay: '0.18s' }}>
                <Link
                  href="/register"
                  className="group bg-primary text-on-primary font-semibold px-6 py-3.5 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all"
                >
                  Запустить диагностику бесплатно
                  <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
                </Link>
                <Link
                  href="/presentation"
                  className="border border-white/[0.08] text-on-surface px-6 py-3.5 rounded-xl flex items-center gap-2 hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined">slideshow</span>
                  Посмотреть презентацию
                </Link>
              </div>

              <p className="landing-rise mt-5 text-xs text-on-surface-variant/70 flex items-center gap-2" style={{ animationDelay: '0.24s' }}>
                <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                Без карты · первая диагностика бесплатно · данные на вашей инфраструктуре
              </p>
            </div>

            {/* Right — product preview (Точка А card) */}
            <div className="landing-rise relative" style={{ animationDelay: '0.16s' }}>
              <div className="landing-float relative bg-surface-container-low/90 backdrop-blur-xl rounded-3xl border border-white/[0.06] p-6 shadow-modal">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-lg">my_location</span>
                    <span className="text-sm font-semibold">Точка А</span>
                  </div>
                  <span className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.05]">
                    демо
                  </span>
                </div>

                {/* GRI score + ring */}
                <div className="flex items-center justify-between bg-surface-container/60 rounded-2xl border border-white/[0.04] p-5 mb-4">
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-1">GRI Score</p>
                    <p className="font-headline text-4xl font-extrabold text-on-surface leading-none">
                      4.6<span className="text-on-surface-variant/40 text-2xl">/10</span>
                    </p>
                    <p className="text-[11px] text-tertiary-container mt-1.5 font-medium">Зона роста · ниже бенчмарка 7.0</p>
                  </div>
                  <div className="relative w-[72px] h-[72px]">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9" />
                      <circle
                        cx="50" cy="50" r="42" fill="none"
                        stroke="currentColor" strokeWidth="9" strokeLinecap="round"
                        className="text-tertiary-container"
                        strokeDasharray={`${(4.6 / 10) * 263.9} 263.9`}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-tertiary-container">46%</span>
                  </div>
                </div>

                {/* Blocks */}
                <div className="space-y-2 mb-4">
                  {GRI_BLOCKS.slice(0, 4).map((b) => (
                    <div key={b.label} className="flex items-center gap-3">
                      <p className="text-[11px] text-on-surface-variant w-32 flex-shrink-0 truncate">{b.label}</p>
                      <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${griBarColor(b.status)}`} style={{ width: `${(b.score / 10) * 100}%` }} />
                      </div>
                      <span className={`text-[11px] font-mono font-bold w-8 text-right ${griTextColor(b.status)}`}>{b.score}</span>
                    </div>
                  ))}
                </div>

                {/* Точка Б mini */}
                <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.07] border border-primary/20 p-3.5">
                  <span className="material-symbols-outlined text-primary">flag</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-on-surface">Точка Б · 90 дней</p>
                    <p className="text-[11px] text-on-surface-variant">GRI 4.6 → 7.2 · 11 целей роста</p>
                  </div>
                  <span className="material-symbols-outlined text-primary/70 text-lg">trending_up</span>
                </div>
              </div>

              {/* Floating metric chip */}
              <div className="hidden sm:flex absolute -left-5 bottom-10 items-center gap-2 bg-surface-container border border-white/[0.08] rounded-2xl px-3.5 py-2.5 shadow-card">
                <span className="material-symbols-outlined text-primary text-base">bolt</span>
                <div>
                  <p className="font-mono text-sm font-bold text-on-surface leading-none">47 полей</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">извлечено за 8 сек</p>
                </div>
              </div>
            </div>

          </div>

          {/* Stats strip */}
          <div className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.04] rounded-2xl overflow-hidden border border-white/[0.04]">
            {[
              { v: '122', l: 'метрики бизнеса' },
              { v: '7',   l: 'блоков GRI' },
              { v: '11',  l: 'целей роста' },
              { v: '90д', l: 'дорожная карта' },
            ].map((s) => (
              <div key={s.l} className="bg-surface-container-low p-6">
                <p className="font-mono text-3xl font-bold text-primary">{s.v}</p>
                <p className="text-xs text-on-surface-variant mt-1 uppercase tracking-wider">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ────────────────────────────────────────────── */}
      <section aria-label="Доверие" className="border-t border-white/[0.04] bg-surface-container-low/60">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-[0.25em] flex-shrink-0">
              нам доверяют
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:flex-1">
              {[
                { icon: 'inventory_2', v: '500+',       l: 'диагностик · 2024–26' },
                { icon: 'category',    v: '27',         l: 'отраслей покрыто' },
                { icon: 'public',      v: 'СНГ + MENA', l: 'регионы запуска' },
                { icon: 'verified',    v: '92%',        l: 'точность AI-парсера' },
                { icon: 'shield_lock', v: 'self-host',  l: 'данные на твоей инфре' },
              ].map((b) => (
                <div key={b.l} className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-surface-container border border-white/[0.06]">
                  <span className="material-symbols-outlined text-primary text-base">{b.icon}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-bold text-on-surface text-sm">{b.v}</span>
                    <span className="text-[10px] text-on-surface-variant/70 uppercase tracking-wider whitespace-nowrap">{b.l}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────── */}
      <section id="how" className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">Как это работает</p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              От анкеты до плана роста — <span className="text-gradient">за один день</span>
            </h2>
            <p className="mt-6 text-lg text-on-surface-variant">
              Без бесконечных Excel, без «общих мест» и без «надо обсудить с консультантом».
              Четыре шага — и у вас есть Точка А и маршрут к Точке Б.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative group bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/30 hover:bg-surface-container transition-all">
                <div className="flex items-start justify-between mb-5">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <span className="material-symbols-outlined text-primary">{s.icon}</span>
                  </div>
                  <span className="font-mono text-xs text-on-surface-variant/50">{s.n}</span>
                </div>
                <h3 className="font-headline text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed mb-4">{s.desc}</p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-primary/80 bg-primary/[0.06] border border-primary/15 px-2.5 py-1 rounded-lg">
                  {s.meta}
                </span>
                {/* connector arrow */}
                {i < STEPS.length - 1 && (
                  <span className="hidden lg:flex material-symbols-outlined text-on-surface-variant/25 text-xl absolute top-9 -right-[18px] z-10">
                    chevron_right
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CAPABILITIES (полный функционал) ───────────────────────── */}
      <section id="features" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">Возможности платформы</p>
              <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
                Всё, что нужно собственнику, <br />
                <span className="text-gradient">в одном кабинете</span>
              </h2>
            </div>
            <p className="text-lg text-on-surface-variant max-w-md">
              Диагностика, метрики, рынок и план роста связаны между собой. Меняется одна цифра — пересчитывается вся картина.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                className="group bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/30 hover:bg-surface-container transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <span className="material-symbols-outlined text-primary">{c.icon}</span>
                </div>
                <h3 className="font-headline text-lg font-bold mb-2">
                  {c.title}
                  <InfoHint term={c.term} />
                </h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── GRI DEEP ───────────────────────────────────────────────── */}
      <section id="gri" className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                GRI · индекс готовности к росту<InfoHint term="gri" />
              </p>
              <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
                Не аудит — <br />
                <span className="text-gradient">маршрут роста</span>
              </h2>
              <p className="mt-6 text-lg text-on-surface-variant">
                7 блоков готовности: бизнес-модель, основатель, доверие, касса, продукт, команда и операции.
                Видно, где «бутылочное горлышко», и куда инвестировать рубль, чтобы получить пять.
              </p>
              <div className="mt-8 space-y-3">
                {[
                  { i: 'fact_check',          t: 'GRI-тест за 10 минут',     d: 'Опросник готовности — расчёт без долгого внедрения', term: 'gri-test' as const },
                  { i: 'calculate',           t: 'Расчёт автоматический',    d: 'Из ответов анкеты и парсинга документов' },
                  { i: 'compass_calibration', t: 'Сравнение с бенчмарком',   d: 'Целевой ≥ 7/10 по каждому блоку' },
                  { i: 'priority_high',       t: 'Топ-5 ограничений',        d: 'Что чинить первым — конкретные действия' },
                  { i: 'cell_tower',          t: 'GRI Pulse — живой балл',   d: 'Пересчёт на новых данных, динамика во времени', term: 'gri-pulse' as const },
                ].map((p) => (
                  <div key={p.t} className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-primary text-base mt-0.5">{p.i}</span>
                    <div>
                      <p className="text-sm font-semibold">
                        {p.t}
                        {'term' in p && p.term ? <InfoHint term={p.term} /> : null}
                      </p>
                      <p className="text-xs text-on-surface-variant">{p.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* GRI score panel */}
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
                {GRI_BLOCKS.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <p className="text-xs text-on-surface w-32 flex-shrink-0 truncate">{b.label}</p>
                    <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${griBarColor(b.status)}`} style={{ width: `${(b.score / 10) * 100}%` }} />
                    </div>
                    <span className={`text-xs font-mono font-bold w-10 text-right ${griTextColor(b.status)}`}>{b.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── JOURNEY: Точка А → Точка Б ──────────────────────────────── */}
      <section id="journey" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">Точка А → Точка Б</p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              Видно, где вы сейчас <br />
              и <span className="text-gradient">куда двигаться</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 items-stretch">
            {/* Точка А */}
            <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-7">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-10 h-10 rounded-xl bg-tertiary-container/15 border border-tertiary-container/25 flex items-center justify-center">
                  <span className="material-symbols-outlined text-tertiary-container">my_location</span>
                </div>
                <div>
                  <p className="font-headline text-lg font-bold">Точка А<InfoHint term="точка-а" /></p>
                  <p className="text-xs text-on-surface-variant">Где бизнес сейчас</p>
                </div>
              </div>
              <ul className="space-y-2.5 text-sm">
                {['GRI-балл и 7 блоков готовности', 'Сильные и слабые зоны', 'Риски и быстрые победы', 'Стратегические приоритеты от ИИ'].map((it) => (
                  <li key={it} className="flex items-start gap-2.5 text-on-surface-variant">
                    <span className="material-symbols-outlined text-tertiary-container text-base mt-0.5">check</span>
                    {it}
                  </li>
                ))}
              </ul>
            </div>

            {/* Arrow / GAP */}
            <div className="flex lg:flex-col items-center justify-center gap-3 px-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary">trending_up</span>
              </div>
              <span className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider text-center">GAP-анализ<br />90 дней</span>
            </div>

            {/* Точка Б */}
            <div className="relative bg-primary/[0.05] rounded-3xl border border-primary/25 p-7 overflow-hidden">
              <div className="absolute -top-16 -right-16 w-56 h-56 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative flex items-center gap-2.5 mb-5">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary">flag</span>
                </div>
                <div>
                  <p className="font-headline text-lg font-bold">Точка Б<InfoHint term="точка-б" /></p>
                  <p className="text-xs text-on-surface-variant">Куда идём за 90 дней</p>
                </div>
              </div>
              <ul className="relative space-y-2.5 text-sm">
                {['11 целей роста с метриками', 'GAP-анализ: что отделяет А от Б', 'Дорожная карта по неделям', 'Сценарии «что если» для решений'].map((it) => (
                  <li key={it} className="flex items-start gap-2.5 text-on-surface">
                    <span className="material-symbols-outlined text-primary text-base mt-0.5">check_circle</span>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── METRICS GRID ───────────────────────────────────────────── */}
      <section id="metrics" className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                122 метрики бизнеса<InfoHint term="метрики" />
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
              <div key={d.name} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/30 transition-colors">
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

      {/* ── AI PARSER ──────────────────────────────────────────────── */}
      <section className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              AI-парсер документов<InfoHint term="ai-парсер" />
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              P&L, баланс, выгрузки CRM — <br />
              <span className="text-gradient">в один клик</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { icon: 'upload_file',   t: 'Загружаете файл',  d: 'PDF · DOCX · XLSX · CSV · TXT до 50 МБ' },
              { icon: 'auto_awesome',  t: 'ИИ извлекает',     d: 'Парсинг + schema-валидация и эвристический fallback' },
              { icon: 'route',         t: 'Поля → отделы',    d: 'Выручка → Финансы, CAC → Маркетинг, SKU → Операции' },
            ].map((s) => (
              <div key={s.t} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
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

      {/* ── FINAL CTA ──────────────────────────────────────────────── */}
      <section className="relative border-t border-white/[0.04] overflow-hidden">
        <div className="absolute left-1/2 -translate-x-1/2 -top-32 w-[700px] h-[500px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full mb-8">
            <span className="status-dot-online" />
            <span className="text-xs font-mono text-primary uppercase tracking-wider">первая диагностика — бесплатно</span>
          </div>
          <h2 className="font-headline text-4xl lg:text-6xl font-extrabold leading-tight max-w-3xl mx-auto">
            Через 90 дней — управление по цифрам, <br />
            <span className="text-gradient">а не по ощущениям</span>
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant max-w-xl mx-auto">
            Зарегистрируйтесь, заполните анкету и загрузите отчёты — и уже сегодня
            получите Точку А, GRI и маршрут к Точке Б.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <Link
              href="/register"
              className="group bg-primary text-on-primary font-semibold px-8 py-4 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all"
            >
              <span className="material-symbols-outlined">rocket_launch</span>
              Запустить диагностику бесплатно
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
            </Link>
            <Link
              href="/login"
              className="border border-white/[0.08] text-on-surface px-8 py-4 rounded-xl flex items-center gap-2 hover:border-primary/40 hover:text-primary transition-colors"
            >
              Войти в аккаунт
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.04] bg-surface-container-low/50">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-6" />
            <span className="text-xs text-on-surface-variant">© 2026</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-on-surface-variant">
            <a href="mailto:hello@aistart360.app" className="hover:text-primary transition-colors">hello@aistart360.app</a>
            <span>Almaty · Tashkent</span>
            <Link href="/login" className="hover:text-primary transition-colors">Войти</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
