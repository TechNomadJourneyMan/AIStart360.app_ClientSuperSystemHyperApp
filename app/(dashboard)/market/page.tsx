import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'

export const metadata: Metadata = { title: 'Рынок' }

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

export default async function MarketPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

  const marketSignals = data.SIGNALS.filter(s => ['market', 'financial', 'regulatory'].includes(s.type))

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Рыночная аналитика · Q1 2026
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Анализ{' '}
          <span className="text-gradient">Рынка</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Размер рынка, сегменты, тренды и рыночные сигналы в реальном времени.
        </p>
      </section>

      {/* TAM / SAM / SOM */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'TAM', sublabel: 'Total Addressable Market', value: data.MARKET.tam, icon: 'language', desc: 'Весь доступный рынок' },
          { label: 'SAM', sublabel: 'Serviceable Addressable Market', value: data.MARKET.sam, icon: 'travel_explore', desc: 'Обслуживаемый сегмент' },
          { label: 'SOM', sublabel: 'Serviceable Obtainable Market', value: data.MARKET.som, icon: 'my_location', desc: 'Целевой захват' },
        ].map((m) => (
          <div key={m.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-6 transition-colors group">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs font-mono text-on-surface-variant uppercase tracking-widest">{m.label}</p>
                <p className="text-[10px] text-on-surface-variant/60 mt-0.5">{m.sublabel}</p>
              </div>
              <span className="material-symbols-outlined text-xl text-primary/40 group-hover:text-primary/70 transition-colors">{m.icon}</span>
            </div>
            <p className="text-3xl font-mono font-bold text-on-surface mb-1">{m.value}</p>
            <p className="text-xs text-on-surface-variant">{m.desc}</p>
          </div>
        ))}
      </section>

      {/* Segments + Trends */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Segment breakdown */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Сегменты рынка</p>
              <p className="text-xs text-on-surface-variant mt-1">Распределение по отраслям</p>
            </div>
            <span className="text-xs font-mono text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
              {data.MARKET.growth}
            </span>
          </div>
          <div className="space-y-4">
            {data.MARKET.segments.map((seg) => (
              <div key={seg.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-on-surface-variant">{seg.name}</span>
                  <span className="font-mono text-on-surface font-medium">{seg.share}%</span>
                </div>
                <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${seg.share}%`, backgroundColor: seg.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Market trends */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">
            Ключевые тренды
          </p>
          <div className="space-y-3">
            {data.MARKET.trends.map((trend) => {
              const colors = PRIORITY_COLORS[trend.priority as keyof typeof PRIORITY_COLORS] ?? PRIORITY_COLORS.low
              return (
                <div
                  key={trend.label}
                  className={`flex items-center gap-4 p-4 rounded-xl border ${colors.bg} ${colors.border} transition-colors`}
                >
                  <span className={`material-symbols-outlined text-xl ${colors.text}`}>{trend.icon}</span>
                  <span className="text-sm text-on-surface flex-1">{trend.label}</span>
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                    {trend.priority}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Market Signals */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Рыночные сигналы</h2>
            <p className="text-xs text-on-surface-variant mt-1">Актуальные события и изменения</p>
          </div>
        </div>
        <div className="space-y-3">
          {marketSignals.map((signal) => {
            const colors = PRIORITY_COLORS[signal.priority as keyof typeof PRIORITY_COLORS] ?? PRIORITY_COLORS.low
            return (
              <div
                key={signal.id}
                className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-5 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.bg} border ${colors.border}`}>
                    <span className={`material-symbols-outlined text-lg ${colors.text}`}>
                      {TYPE_ICONS[signal.type] ?? 'info'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="text-sm font-medium text-on-surface leading-snug">{signal.title}</h3>
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                        {signal.priority}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed">{signal.description}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <span className="text-[10px] font-mono text-on-surface-variant">{signal.time}</span>
                      <div className="flex gap-1.5">
                        {signal.tags?.map((tag) => (
                          <span key={tag} className="text-[10px] font-mono bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-md">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
