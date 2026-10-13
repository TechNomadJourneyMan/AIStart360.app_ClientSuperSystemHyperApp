'use client'

/**
 * The left 2×2 of the staff dashboard: the main metrics of the viewer's own
 * company — the same customisable set as the «Главные метрики» strip of Point
 * A (pa_company_config.client_view.keyMetrics), real values with period,
 * source and dynamics. The platform counters (users, requests, GRI) move to a
 * compact row under them. Without a company or metrics the platform cards stay
 * where they were.
 */
import Link from 'next/link'
import { usePointAState } from '@/hooks/usePointAState'
import { KeyMetricTile } from '@/components/point-a-v4/KeyMetricsStrip'

export interface PlatformCard {
  label: string
  value: string
  trend: string
  trendUp: boolean
  icon: string
  sublabel: string
  href: string
}

function PlatformCards({ cards }: { cards: PlatformCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((card) => (
        <Link key={card.label} href={card.href}
          className="bg-surface-container-low rounded-2xl p-5 border border-white/[0.04] hover:border-primary/20 transition-all group cursor-pointer relative overflow-hidden">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{card.label}</p>
            <span className="material-symbols-outlined text-base text-primary/40 group-hover:text-primary transition-colors">{card.icon}</span>
          </div>
          <h3 className="text-3xl font-mono font-bold text-on-surface mb-2">{card.value}</h3>
          <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant">
            <span className={`material-symbols-outlined text-sm ${card.trendUp ? 'text-primary' : 'text-error'}`}>{card.trendUp ? 'trending_up' : 'trending_down'}</span>
            <span className={card.trendUp ? 'text-primary' : 'text-error'}>{card.trend}</span>
            <span>{card.sublabel}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

export function DashboardKeyMetrics({ platform }: { platform: PlatformCard[] }) {
  const { data, isLoading, isError, noCompany } = usePointAState()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[132px] rounded-2xl bg-surface-container-low border border-white/[0.04] animate-pulse" />)}
      </div>
    )
  }
  const metrics = (data?.keyMetrics ?? []).slice(0, 4)
  if (isError || noCompany || !data || metrics.every((m) => m.value === null)) return <PlatformCards cards={platform} />

  const goalOf = (id: string) => data.goals.find((g) => g.goal.metricId === id)
  return (
    <section aria-labelledby="dash-key" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="dash-key" className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Главные метрики</h2>
        <Link href="/point-a" className="text-[11px] font-mono text-primary/80 hover:text-primary">
          {data.canManage ? 'Настроить в Точке А →' : 'Точка А →'}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m) => <KeyMetricTile key={m.id} m={m} goal={goalOf(m.id)} />)}
      </div>
      <nav aria-label="Платформа" className="flex flex-wrap gap-2">
        {platform.map((c) => (
          <Link key={c.label} href={c.href} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-surface-container-low px-2.5 py-1.5 text-[11px] text-on-surface-variant hover:text-on-surface hover:border-primary/20">
            <span className="material-symbols-outlined text-[14px] text-primary/60" aria-hidden="true">{c.icon}</span>
            <span className="font-mono font-semibold text-on-surface">{c.value}</span>
            <span>{c.label.toLowerCase()}</span>
          </Link>
        ))}
      </nav>
    </section>
  )
}
