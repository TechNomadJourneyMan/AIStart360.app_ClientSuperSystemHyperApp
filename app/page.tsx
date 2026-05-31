import Link from 'next/link'

// Public landing — рассказывает о AIStart360 и ведёт на /login
// Auth'd users всё равно увидят landing; кликают «Войти» → middleware вернёт их в их панель.

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

export default function LandingPage() {
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
            <a href="#metrics" className="hover:text-primary transition-colors">Метрики</a>
            <a href="#gri" className="hover:text-primary transition-colors">GRI Pulse</a>
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
                AI-операционка · v1.0
              </span>
            </div>

            <h1 className="font-headline text-5xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight">
              Управляйте бизнесом <br />
              <span className="text-gradient">по цифрам</span>, <br />
              а не по ощущениям
            </h1>

            <p className="mt-8 text-xl text-on-surface-variant max-w-2xl leading-relaxed">
              AIStart360 — диагностика, метрики и план роста для собственника.
              Закидываете отчёты — AI извлекает 30–60 ключевых полей.
              Получаете <span className="text-primary font-semibold">Точку А</span>, <span className="text-primary font-semibold">11 целей</span> и <span className="text-primary font-semibold">90-дневный маршрут</span>.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
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

            {/* Stats strip */}
            <div className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.04] rounded-2xl overflow-hidden border border-white/[0.04]">
              {[
                { v: '122', l: 'метрики бизнеса' },
                { v: '7',   l: 'блоков GRI Pulse' },
                { v: '11',  l: 'целей роста' },
                { v: '90д', l: 'roadmap' },
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

      {/* ── MODULES ────────────────────────────────────────── */}
      <section id="modules" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
              4 модуля
            </p>
            <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
              От анкеты до <span className="text-gradient">$2M / год</span>
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
                GRI Pulse
              </p>
              <h2 className="font-headline text-4xl lg:text-5xl font-extrabold leading-tight">
                Не аудит — <br />
                <span className="text-gradient">маршрут роста</span>
              </h2>
              <p className="mt-6 text-lg text-on-surface-variant">
                7 блоков готовности: бизнес-модель, основатель, доверие, касса, продукт,
                команда, операции. Видно где «бутылочное горлышко» и куда инвестировать
                рубль, чтобы получить пять.
              </p>
              <div className="mt-8 space-y-3">
                {[
                  { i: 'check_circle', t: 'Расчёт автоматический', d: 'Из ответов анкеты + парсинга документов' },
                  { i: 'compass_calibration', t: 'Сравнение с бенчмарком', d: 'Целевой ≥7/10 по каждому блоку' },
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

      {/* ── PRICING / CTA ─────────────────────────────────── */}
      <section id="pricing" className="border-t border-white/[0.04] bg-surface-container-low/30">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-8 flex flex-col">
              <p className="text-xs font-mono text-on-surface-variant uppercase tracking-[0.2em] mb-3">
                Pilot
              </p>
              <h3 className="font-headline text-3xl font-extrabold mb-4">30 дней бесплатно</h3>
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
                className="border border-white/[0.08] text-on-surface text-center font-semibold px-6 py-3.5 rounded-xl hover:border-primary/40 hover:text-primary transition-colors"
              >
                Начать пилот
              </Link>
            </div>

            <div className="bg-primary/5 rounded-3xl border border-primary/30 p-8 flex flex-col relative overflow-hidden">
              <div className="absolute -top-20 -right-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
              <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">
                Pro · подписка
              </p>
              <h3 className="font-headline text-3xl font-extrabold mb-4">
                $300–800 / мес
              </h3>
              <p className="text-on-surface-variant mb-6 flex-1">
                После пилота. Цена зависит от объёма документов и числа пользователей.
                Окупается за ~6 недель только за счёт снижения CAC на 5%.
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
              <Link
                href="/register"
                className="bg-primary text-on-primary text-center font-semibold px-6 py-3.5 rounded-xl hover:shadow-xl hover:shadow-primary/30 transition-all"
              >
                Запустить → demo на 30 минут
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────── */}
      <section className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-24 text-center">
          <h2 className="font-headline text-4xl lg:text-6xl font-extrabold leading-tight max-w-3xl mx-auto">
            Через 90 дней управляйте по цифрам, <br />
            <span className="text-gradient">а не по ощущениям</span>
          </h2>
          <p className="mt-6 text-lg text-on-surface-variant max-w-xl mx-auto">
            3 шага: демо 30 минут → бесплатный пилот → внедрение.
            Сегодня + 5 рабочих дней — и у вас есть Точка А.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <Link
              href="/register"
              className="bg-primary text-on-primary font-semibold px-8 py-4 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all"
            >
              <span className="material-symbols-outlined">rocket_launch</span>
              Запустить диагностику
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
