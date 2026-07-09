/**
 * app/(dashboard)/gri/methodology/page.tsx — «Как считается GRI»:
 * статическая whitepaper-лайт страница против эффекта «чёрного ящика».
 * Server component, данных из БД нет — только методика: 7 реальных блоков из
 * lib/gri-assessment/sections.ts, шкала, зоны и честные ограничения самооценки.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

export const metadata: Metadata = {
  title: 'Как считается GRI — методология',
  description:
    'Методология Growth Readiness Index: 7 блоков, шкала 0–10, зоны и честные ограничения самооценки.',
}

// Русские подписи блоков — как BLOCK_RU в GriDynamicsPanel (тот файл — client
// component, импортировать из него в server component нельзя, поэтому копия).
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

// 1–2 предложения «что измеряет блок» (по содержанию критериев sections.ts).
const BLOCK_SUMMARY: Record<string, string> = {
  'product-demand':
    'Сила продукта и реальный спрос: острота боли клиента, готовность платить выше рынка, повторные покупки и динамика рынка.',
  'trust-positioning':
    'Доверие и позиционирование бренда: кейсы с цифрами, ясность оффера за 10 секунд, отличие от конкурентов и прозрачность результата.',
  'business-model':
    'Эффективность бизнес-модели и unit-экономика: регулярная выручка, окупаемость привлечения и способность расти без раздувания штата.',
  'cash-stability':
    'Управление денежными потоками: предоплаты, скорость превращения заявки в оплату и устойчивость к кассовым разрывам при росте.',
  operations:
    'Бизнес-процессы и операционная эффективность: стандарты (SOP), метрики результата и предсказуемое качество без ручного контроля.',
  team: 'Готовность команды к масштабированию: состав ролей, компетенции и способность стабильно выдавать результат при росте объёма.',
  'owner-readiness':
    'Личная готовность собственника: сколько ключевых процессов держится на фаундере и готов ли он делегировать, чтобы не быть узким горлышком.',
}

const BLOCK_ICON: Record<string, string> = {
  'product-demand': 'inventory_2',
  'trust-positioning': 'verified',
  'business-model': 'account_tree',
  'cash-stability': 'savings',
  operations: 'settings_suggest',
  team: 'groups',
  'owner-readiness': 'person',
}

const ZONES = [
  {
    range: '0 – 4.9',
    label: 'Красная зона',
    text: 'Критические разрывы: рост сейчас будет ломать бизнес, а не усиливать его.',
    dot: 'bg-error',
    textColor: 'text-error',
  },
  {
    range: '5 – 6.9',
    label: 'Жёлтая зона',
    text: 'Основа есть, но масштабирование упрётся в слабые блоки — сначала укрепите их.',
    dot: 'bg-amber-400',
    textColor: 'text-amber-400',
  },
  {
    range: '7 – 10',
    label: 'Зелёная зона',
    text: 'Система готова к росту. Целевой уровень для уверенного масштабирования — 8.5+.',
    dot: 'bg-primary',
    textColor: 'text-primary',
  },
]

const LIMITS = [
  {
    icon: 'psychology',
    title: 'Это самооценка',
    text: 'GRI отражает то, как вы сами видите бизнес. Сверка с фактическими данными — задача Reality Check: он подсвечивает расхождения между ощущениями и цифрами.',
  },
  {
    icon: 'data_check',
    title: 'Точность растёт с анкетой',
    text: 'Чем полнее заполнена анкета компании, тем точнее интерпретация индекса, рекомендации и план действий.',
  },
  {
    icon: 'insights',
    title: 'Бенчмарки v1 — экспертные ориентиры',
    text: 'Целевые уровни блоков в первой версии заданы экспертно, а не выведены статистически. По мере накопления данных ориентиры будут уточняться.',
  },
]

/** «критерий / критерия / критериев» по правилам русской плюрализации. */
function pluralCriteria(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'критериев'
  if (mod10 === 1) return 'критерий'
  if (mod10 >= 2 && mod10 <= 4) return 'критерия'
  return 'критериев'
}

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 ${className}`}
    >
      {children}
    </div>
  )
}

export default function GriMethodologyPage() {
  const totalCriteria = GRI_SECTIONS.reduce(
    (sum, s) => sum + s.criteria.length,
    0,
  )

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <header>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          GRI Health Check · Методология
        </p>
        <h1 className="font-headline text-3xl sm:text-4xl font-extrabold text-on-surface leading-tight">
          Как считается GRI
        </h1>
        <p className="text-base text-on-surface-variant leading-relaxed mt-4 max-w-2xl">
          GRI (Growth Readiness Index) — индекс готовности бизнеса к росту по
          шкале от 0 до 10. Это структурированная самооценка по{' '}
          <span className="text-on-surface font-medium">7 блокам</span> и{' '}
          <span className="text-on-surface font-medium">
            {totalCriteria} критериям
          </span>
          : она показывает, какие части системы выдержат масштабирование, а
          какие сломаются первыми.
        </p>
      </header>

      {/* ── Шкала и формула ──────────────────────────────────────────────── */}
      <section aria-labelledby="scale-heading">
        <h2
          id="scale-heading"
          className="font-headline text-xl font-bold text-on-surface mb-4"
        >
          Шкала и формула
        </h2>
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-2">
            <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
              <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1.5">
                Шаг 1
              </p>
              <p className="text-sm text-on-surface">
                Каждый критерий вы оцениваете от 0 до 10
              </p>
            </div>
            <span
              className="material-symbols-outlined text-on-surface-variant self-center rotate-90 sm:rotate-0"
              aria-hidden="true"
            >
              arrow_forward
            </span>
            <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
              <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1.5">
                Шаг 2
              </p>
              <p className="text-sm text-on-surface">
                Оценка блока — среднее его критериев
              </p>
            </div>
            <span
              className="material-symbols-outlined text-on-surface-variant self-center rotate-90 sm:rotate-0"
              aria-hidden="true"
            >
              arrow_forward
            </span>
            <div className="flex-1 rounded-xl bg-primary/[0.06] border border-primary/20 p-4">
              <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1.5">
                Итог
              </p>
              <p className="text-sm text-on-surface">
                GRI — среднее семи блоков,{' '}
                <span className="font-mono font-bold text-primary">0–10</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            {ZONES.map((z) => (
              <div
                key={z.label}
                className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${z.dot}`}
                    aria-hidden="true"
                  />
                  <span className={`font-mono text-sm font-bold ${z.textColor}`}>
                    {z.range}
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    {z.label}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {z.text}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ── 7 блоков ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="blocks-heading">
        <h2
          id="blocks-heading"
          className="font-headline text-xl font-bold text-on-surface mb-4"
        >
          7 блоков индекса
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {GRI_SECTIONS.map((section, i) => (
            <Card key={section.id} className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span
                  className="material-symbols-outlined text-xl text-primary"
                  aria-hidden="true"
                >
                  {BLOCK_ICON[section.id] ?? 'category'}
                </span>
              </div>
              <div>
                <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
                  Блок {i + 1} · {section.criteria.length}{' '}
                  {pluralCriteria(section.criteria.length)}
                </p>
                <h3 className="font-headline text-base font-bold text-on-surface">
                  {BLOCK_RU[section.id] ?? section.shortTitle}
                </h3>
                <p className="text-xs font-mono text-on-surface-variant/70 mb-2">
                  {section.shortTitle}
                </p>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  {BLOCK_SUMMARY[section.id] ?? section.description}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Честные ограничения ──────────────────────────────────────────── */}
      <section aria-labelledby="limits-heading">
        <h2
          id="limits-heading"
          className="font-headline text-xl font-bold text-on-surface mb-4"
        >
          Честные ограничения
        </h2>
        <Card>
          <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
            Мы не хотим, чтобы GRI воспринимался как «магическое число из
            чёрного ящика». Вот что важно понимать про его природу:
          </p>
          <div className="space-y-4">
            {LIMITS.map((l) => (
              <div key={l.title} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                  <span
                    className="material-symbols-outlined text-base text-primary"
                    aria-hidden="true"
                  >
                    {l.icon}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface mb-0.5">
                    {l.title}
                  </p>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    {l.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ── Назад к результату ───────────────────────────────────────────── */}
      <footer className="pb-6">
        <Link
          href="/gri?tab=result"
          className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-5 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            arrow_back
          </span>
          Вернуться к результату GRI
        </Link>
      </footer>
    </main>
  )
}
