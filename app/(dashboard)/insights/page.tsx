export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'

export const metadata: Metadata = { title: 'Инсайты' }

const PRIORITY_COLORS = {
  critical: { text: 'text-error', bg: 'bg-error/10', border: 'border-error/20', dot: 'bg-error' },
  high:     { text: 'text-tertiary-container', bg: 'bg-tertiary-container/10', border: 'border-tertiary-container/20', dot: 'bg-tertiary-container' },
  medium:   { text: 'text-secondary', bg: 'bg-secondary/10', border: 'border-secondary/20', dot: 'bg-secondary' },
  low:      { text: 'text-on-surface-variant', bg: 'bg-surface-container', border: 'border-white/[0.04]', dot: 'bg-outline' },
}

const TYPE_ICONS: Record<string, string> = {
  financial:   'payments',
  market:      'show_chart',
  regulatory:  'gavel',
  competitive: 'compare_arrows',
}

const SIGNAL_FILTERS = [
  { label: 'Все', value: 'all' },
  { label: 'Рынок', value: 'market' },
  { label: 'Финансы', value: 'financial' },
  { label: 'Регуляторика', value: 'regulatory' },
  { label: 'Конкуренты', value: 'competitive' },
] as const

type SignalFilter = (typeof SIGNAL_FILTERS)[number]['value']

function isSignalFilter(value: string | undefined): value is SignalFilter {
  return SIGNAL_FILTERS.some((filter) => filter.value === value)
}

const INSIGHT_CARDS = [
  { icon: 'lightbulb', title: 'FinTech-клиенты растут быстрее', desc: 'Средний GRI FinTech-сегмента — 876, что на 18% выше остальных отраслей.', tag: 'Паттерн', color: 'primary' },
  { icon: 'warning', title: 'Риск оттока: 3 клиента', desc: 'Vortex Labs, Calyx Digital, PulseCore показывают признаки снижения вовлечённости.', tag: 'Риск', color: 'error' },
  { icon: 'trending_up', title: 'Q1 2026 — рекорд NPS', desc: 'NPS достиг 74 — максимум за 18 месяцев. Главный драйвер: скорость отчётов.', tag: 'Достижение', color: 'primary' },
  { icon: 'psychology', title: 'AI-инструменты ускоряют рост', desc: 'Клиенты, использующие AI-диагностику, растут на 34% быстрее.', tag: 'Исследование', color: 'secondary' },
]

async function getInsightStats() {
  try {
    const [reportCount, avgScoreRes] = await Promise.all([
      prisma.griReport.count(),
      prisma.griReport.aggregate({ _avg: { score: true } }),
    ])
    return {
      reportCount,
      avgScore: Number(avgScoreRes._avg.score ?? 0),
      unavailable: false,
    }
  } catch (error) {
    console.error('[insights] live stats unavailable', error)
    return { reportCount: null, avgScore: null, unavailable: true }
  }
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams?: { type?: string | string[] }
}) {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)
  const stats = await getInsightStats()
  const requestedFilter = Array.isArray(searchParams?.type)
    ? searchParams.type[0]
    : searchParams?.type
  const activeFilter: SignalFilter = isSignalFilter(requestedFilter) ? requestedFilter : 'all'
  const activeFilterLabel = SIGNAL_FILTERS.find((filter) => filter.value === activeFilter)?.label ?? 'Все'
  const visibleSignals = activeFilter === 'all'
    ? data.SIGNALS
    : data.SIGNALS.filter((signal) => signal.type === activeFilter)

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Аналитические инсайты · Q1 2026
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          <span className="text-gradient">Инсайты</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Ключевые наблюдения, паттерны и рекомендации на основе данных GRI и рыночных сигналов.
        </p>
      </section>

      {stats.unavailable && (
        <div role="status" className="rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3">
          <p className="text-sm font-medium text-on-surface">Оперативная статистика временно недоступна</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Инсайты и рыночные сигналы доступны; счётчики GRI обновятся после восстановления базы.
          </p>
        </div>
      )}

      {/* Stats Summary */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/20 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">GRI отчёты</p>
            <span className="material-symbols-outlined text-xl text-primary/40 group-hover:text-primary transition-colors">description</span>
          </div>
          <p className="text-3xl font-mono font-bold text-on-surface">{stats.reportCount ?? '—'}</p>
          <p className="text-[10px] font-mono text-primary mt-2 uppercase tracking-tight">Общее количество расчётов</p>
        </div>
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:border-primary/20 transition-colors group">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Средний GRI</p>
            <span className="material-symbols-outlined text-xl text-primary/40 group-hover:text-primary transition-colors">analytics</span>
          </div>
          <p className="text-3xl font-mono font-bold text-on-surface">
            {stats.avgScore === null ? '—' : (stats.avgScore / 10).toFixed(1)}
          </p>
          <p className="text-[10px] font-mono text-primary mt-2 uppercase tracking-tight">Показатель по всей базе</p>
        </div>
      </section>

      {/* Key Insight Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INSIGHT_CARDS.map((card) => (
          <div key={card.title} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl bg-${card.color}/10 flex items-center justify-center border border-${card.color}/20 flex-shrink-0`}>
                <span className={`material-symbols-outlined text-lg text-${card.color}`}>{card.icon}</span>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-sm font-bold text-on-surface">{card.title}</h3>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border border-${card.color}/20 text-${card.color} bg-${card.color}/5 uppercase`}>
                    {card.tag}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">{card.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Signal Feed */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">
              {activeFilter === 'all' ? 'Все сигналы' : `Сигналы: ${activeFilterLabel}`}
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">{visibleSignals.length} активных событий в Choco Ecosystem</p>
          </div>
          <div className="hidden lg:flex gap-1.5">
            {SIGNAL_FILTERS.map((filter) => {
              const active = filter.value === activeFilter
              return (
                <a
                  key={filter.value}
                  href={filter.value === 'all' ? '?' : `?type=${encodeURIComponent(filter.value)}`}
                  aria-current={active ? 'page' : undefined}
                  className={`text-[10px] font-mono px-3 py-1.5 rounded-full border transition-all ${
                    active
                      ? 'bg-primary text-on-primary border-primary shadow-primary-sm'
                      : 'bg-surface-container-low text-on-surface-variant border-white/[0.04] hover:bg-surface-container'
                  }`}
                >
                  {filter.label}
                </a>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {visibleSignals.map((signal) => {
            const colors = PRIORITY_COLORS[signal.priority as keyof typeof PRIORITY_COLORS] ?? PRIORITY_COLORS.low
            return (
              <div
                key={signal.id}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.bg} border ${colors.border}`}>
                    <span className={`material-symbols-outlined text-lg ${colors.text}`}>
                      {TYPE_ICONS[signal.type] ?? 'info'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="text-sm font-bold text-on-surface leading-snug">{signal.title}</h3>
                      <span className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                        {signal.priority}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed mb-3 line-clamp-2 italic">"{signal.description}"</p>
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-md border border-white/[0.04]">{signal.time}</span>
                      {signal.relatedClient && (
                        <div className="flex items-center gap-1.5 bg-primary/5 px-2 py-0.5 rounded-md border border-primary/20">
                           <span className="material-symbols-outlined text-[12px] text-primary">corporate_fare</span>
                           <span className="text-[10px] font-mono text-primary font-bold tracking-tighter">{signal.relatedClient}</span>
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        {signal.tags?.slice(0, 2).map((tag) => (
                          <span key={tag} className="text-[10px] font-mono bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-md border border-white/[0.02]">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {visibleSignals.length === 0 && (
            <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
              <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">filter_alt_off</span>
              <p className="text-sm text-on-surface-variant">В категории «{activeFilterLabel}» сигналов нет</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
