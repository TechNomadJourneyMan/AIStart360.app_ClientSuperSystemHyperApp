export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = { title: 'Intelligence Hub' }

export default async function IntelligencePage() {
  const t = await getTranslations('intelligencePage')
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

  const priorityConfig = {
    critical: { label: t('critical'), color: 'text-error border-error/30 bg-error/10', dot: 'bg-error' },
    high:     { label: t('high'), color: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10', dot: 'bg-tertiary-container' },
    medium:   { label: t('medium'), color: 'text-secondary border-secondary/30 bg-secondary/10', dot: 'bg-secondary' },
    low:      { label: t('low'), color: 'text-on-surface-variant border-outline-variant/30 bg-surface-container', dot: 'bg-outline' },
  }

  const [auditEvents, clientCount] = await Promise.all([
    prisma.auditLog.count(),
    prisma.client.count(),
  ])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Intelligence <span className="text-gradient">Hub</span></h1>
          <p className="text-on-surface-variant text-sm mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 bg-surface-container-low px-4 py-2 rounded-xl border border-white/[0.04]">
          <span className="status-dot-online after:animate-ping after:absolute after:inset-0 after:rounded-full after:bg-primary/50" />
          <span className="text-xs font-mono text-primary font-bold">Live · Real-time Feed</span>
        </div>
      </div>

      {/* Signal Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('auditEvents'), value: String(auditEvents), icon: 'hub', color: 'text-on-surface' },
          { label: t('clientsLabel'), value: String(clientCount), icon: 'groups', color: 'text-primary' },
          { label: t('aiInsights'), value: '12', icon: 'auto_awesome', color: 'text-tertiary-container' },
          { label: t('systemStatus'), value: 'Active', icon: 'cloud_done', color: 'text-success' },
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
        {['All', 'Market', 'Financial', 'Regulatory', 'Technology', 'Competitive'].map((f) => (
          <button
            key={f}
            className={`px-5 py-2 rounded-xl text-xs font-mono font-medium border transition-all hover:scale-[0.98] ${
              f === 'All'
                ? 'bg-primary/10 text-primary border-primary/30 shadow-primary-sm'
                : 'bg-surface-container-low text-on-surface-variant border-white/[0.04] hover:bg-surface-container'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Signal Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.SIGNALS.map((signal) => {
          const cfg = priorityConfig[signal.priority as keyof typeof priorityConfig] ?? priorityConfig.low
          return (
            <div
              key={signal.id}
              className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 hover:bg-surface-container transition-all cursor-pointer group hover:border-primary/10"
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

              <h3 className="font-headline font-bold text-on-surface text-lg mb-2 group-hover:text-primary transition-colors">
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
      </div>
    </div>
  )
}
