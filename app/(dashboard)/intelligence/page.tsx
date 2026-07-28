export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'

export const metadata: Metadata = { title: 'Intelligence Hub' }

const priorityConfig = {
  critical: { label: 'Критично', color: 'text-error border-error/30 bg-error/10', dot: 'bg-error' },
  high:     { label: 'Высоко', color: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10', dot: 'bg-tertiary-container' },
  medium:   { label: 'Средне', color: 'text-secondary border-secondary/30 bg-secondary/10', dot: 'bg-secondary' },
  low:      { label: 'Низко', color: 'text-on-surface-variant border-outline-variant/30 bg-surface-container', dot: 'bg-outline' },
}

const SIGNAL_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Market', value: 'market' },
  { label: 'Financial', value: 'financial' },
  { label: 'Regulatory', value: 'regulatory' },
  { label: 'Technology', value: 'technology' },
  { label: 'Competitive', value: 'competitive' },
] as const

type SignalFilter = (typeof SIGNAL_FILTERS)[number]['value']

function isSignalFilter(value: string | undefined): value is SignalFilter {
  return SIGNAL_FILTERS.some((filter) => filter.value === value)
}

async function getIntelligenceStats() {
  try {
    const [auditEvents, clientCount] = await Promise.all([
      prisma.auditLog.count(),
      prisma.client.count(),
    ])
    return { auditEvents, clientCount, unavailable: false }
  } catch (error) {
    console.error('[intelligence] live stats unavailable', error)
    return { auditEvents: null, clientCount: null, unavailable: true }
  }
}

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams?: { type?: string | string[] }
}) {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)
  const stats = await getIntelligenceStats()
  const requestedFilter = Array.isArray(searchParams?.type)
    ? searchParams.type[0]
    : searchParams?.type
  const activeFilter: SignalFilter = isSignalFilter(requestedFilter) ? requestedFilter : 'all'
  const activeFilterLabel = SIGNAL_FILTERS.find((filter) => filter.value === activeFilter)?.label ?? 'All'
  const visibleSignals = activeFilter === 'all'
    ? data.SIGNALS
    : data.SIGNALS.filter((signal) => signal.type === activeFilter)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Intelligence <span className="text-gradient">Hub</span></h1>
          <p className="text-on-surface-variant text-sm mt-1">Рыночные сигналы, риски и возможности Choco Ecosystem</p>
        </div>
        <div className="flex items-center gap-3 bg-surface-container-low px-4 py-2 rounded-xl border border-white/[0.04]">
          <span className="status-dot-online after:animate-ping after:absolute after:inset-0 after:rounded-full after:bg-primary/50" />
          <span className="text-xs font-mono text-primary font-bold">Live · Real-time Feed</span>
        </div>
      </div>

      {stats.unavailable && (
        <div role="status" className="rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3">
          <p className="text-sm font-medium text-on-surface">Live-счётчики временно недоступны</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Лента сигналов продолжает работать на последнем доступном наборе данных.
          </p>
        </div>
      )}

      {/* Signal Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'События аудита', value: stats.auditEvents === null ? '—' : String(stats.auditEvents), icon: 'hub', color: 'text-on-surface' },
          { label: 'Клиенты', value: stats.clientCount === null ? '—' : String(stats.clientCount), icon: 'groups', color: 'text-primary' },
          { label: 'AI Инсайты', value: '12', icon: 'auto_awesome', color: 'text-tertiary-container' },
          { label: 'Статус систем', value: 'Active', icon: 'cloud_done', color: 'text-success' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className={`material-symbols-outlined text-xl ${stat.color}`}>{stat.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
            </div>
            <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-2 pb-2">
        {SIGNAL_FILTERS.map((filter) => {
          const active = filter.value === activeFilter
          return (
            <a
              key={filter.value}
              href={filter.value === 'all' ? '?' : `?type=${encodeURIComponent(filter.value)}`}
              aria-current={active ? 'page' : undefined}
              className={`px-5 py-2 rounded-xl text-xs font-mono font-medium border transition-all hover:scale-[0.98] ${
                active
                  ? 'bg-primary/10 text-primary border-primary/30 shadow-primary-sm'
                  : 'bg-surface-container-low text-on-surface-variant border-white/[0.04] hover:bg-surface-container'
              }`}
            >
              {filter.label}
            </a>
          )
        })}
      </div>

      {/* Signal Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visibleSignals.map((signal) => {
          const cfg = priorityConfig[signal.priority as keyof typeof priorityConfig] ?? priorityConfig.low
          return (
            <div
              key={signal.id}
              className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot} ${signal.priority === 'critical' ? 'animate-pulse shadow-[0_0_8px_rgba(255,82,82,0.8)]' : ''}`} />
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase font-bold ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-lg border border-white/[0.04]">
                  {signal.time}
                </span>
              </div>

              <h3 className="font-headline font-bold text-on-surface text-lg mb-2">
                {signal.title}
              </h3>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-5 line-clamp-3 italic">
                "{signal.description}"
              </p>

              <div className="flex items-center justify-between border-t border-white/[0.04] pt-4">
                <div className="flex flex-wrap gap-1.5">
                  {signal.tags.map((tag) => (
                    <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-surface-container text-on-surface-variant border border-white/[0.04]">
                      #{tag}
                    </span>
                  ))}
                </div>
                {signal.relatedClient && (
                  <div className="flex items-center gap-1.5 bg-primary/5 px-2.5 py-1 rounded-full border border-primary/10">
                    <span className="material-symbols-outlined text-[14px] text-primary">corporate_fare</span>
                    <span className="text-[10px] text-primary font-mono font-bold">{signal.relatedClient}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {visibleSignals.length === 0 && (
          <div className="lg:col-span-2 rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
            <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">filter_alt_off</span>
            <p className="text-sm text-on-surface-variant">No signals in “{activeFilterLabel}”</p>
          </div>
        )}
      </div>
    </div>
  )
}
