import type { Metadata } from 'next'
import { MOCK_SIGNALS } from '@/lib/mock-data'

export const metadata: Metadata = { title: 'Intelligence Hub' }

const priorityConfig = {
  critical: { label: 'Critical', color: 'text-error bg-error/10 border-error/20', dot: 'bg-error' },
  high:     { label: 'High', color: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20', dot: 'bg-tertiary-container' },
  medium:   { label: 'Medium', color: 'text-secondary bg-secondary/10 border-secondary/20', dot: 'bg-secondary' },
  low:      { label: 'Low', color: 'text-on-surface-variant bg-surface-container border-outline-variant/30', dot: 'bg-outline' },
} as const

export default function IntelligencePage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Intelligence Hub</h1>
          <p className="text-on-surface-variant text-sm mt-1">Рыночные сигналы и возможности</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-dot-online" />
          <span className="text-xs font-mono text-primary">Live · Обновлено 2 мин. назад</span>
        </div>
      </div>

      {/* Signal Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Signals', value: '142', icon: 'hub', color: 'text-on-surface' },
          { label: 'Critical', value: '8', icon: 'warning', color: 'text-error' },
          { label: 'Opportunities', value: '23', icon: 'lightbulb', color: 'text-primary' },
          { label: 'Processed', value: '98%', icon: 'check_circle', color: 'text-primary' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`material-symbols-outlined text-xl ${stat.color}`}>{stat.icon}</span>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
            </div>
            <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-2">
        {['All', 'Market', 'Financial', 'Regulatory', 'Technology', 'Competitive'].map((f) => (
          <button
            key={f}
            className={`px-4 py-1.5 rounded-full text-xs font-mono font-medium border transition-colors ${
              f === 'All'
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:border-outline-variant/60'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Signal Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MOCK_SIGNALS.map((signal) => {
          const cfg = priorityConfig[signal.priority as keyof typeof priorityConfig] ?? priorityConfig.low
          return (
            <div
              key={signal.id}
              className="bg-surface-container rounded-xl p-5 hover:bg-surface-container-high transition-colors cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot} ${signal.priority === 'critical' ? 'animate-pulse' : ''}`} />
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant">{signal.time}</span>
              </div>

              <h3 className="font-medium text-on-surface mb-1.5 group-hover:text-primary transition-colors">
                {signal.title}
              </h3>
              <p className="text-sm text-on-surface-variant leading-relaxed mb-4">{signal.description}</p>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {signal.tags.map((tag) => (
                    <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                      {tag}
                    </span>
                  ))}
                </div>
                {signal.relatedClient && (
                  <span className="text-xs text-primary font-mono">→ {signal.relatedClient}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
