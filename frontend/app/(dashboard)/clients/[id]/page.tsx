import type { Metadata } from 'next'
import Link from 'next/link'
import { GriScoreDial } from '@/components/gri/GriScoreDial'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MOCK_CLIENTS } from '@/lib/mock-data'

export const metadata: Metadata = { title: 'Client Profile' }

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const client = MOCK_CLIENTS.find((c) => c.id === params.id) ?? MOCK_CLIENTS[0]

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/clients" className="hover:text-on-surface transition-colors">Clients</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface">{client.name}</span>
      </nav>

      {/* Client Header */}
      <div className="flex flex-col lg:flex-row items-start gap-6">
        <div className="w-16 h-16 rounded-2xl bg-surface-container-high flex items-center justify-center text-2xl font-headline font-bold text-primary flex-shrink-0">
          {client.name[0]}
        </div>
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
            <h1 className="font-headline text-3xl font-bold text-on-surface">{client.name}</h1>
            <StatusBadge status={client.status} label={client.status} />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">business</span>
              {client.industry}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">trending_up</span>
              {client.stage}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">person</span>
              {client.manager}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button className="inline-flex items-center gap-2 px-4 py-2 border border-outline-variant/30 rounded-lg text-sm text-on-surface hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-lg">edit</span>
            Редактировать
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg hover:scale-[0.98] transition-all">
            <span className="material-symbols-outlined text-lg">description</span>
            Run Report
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
        {['Overview', 'GRI Report', 'Growth Plan', 'Reports', 'Activity'].map((tab, i) => (
          <button
            key={tab}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              i === 0
                ? 'text-primary border-primary'
                : 'text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* GRI Score */}
        <div className="lg:col-span-1">
          <GriScoreDial score={client.griScore} previousScore={client.previousGriScore} />
        </div>

        {/* Metrics Grid */}
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'LTV/CAC', value: '4.82x', icon: 'currency_exchange', trend: '+0.15' },
            { label: 'GMV', value: '$340K', icon: 'payments', trend: '+8.4%' },
            { label: 'Growth Rate', value: '22%', icon: 'trending_up', trend: '+3%' },
            { label: 'NPS Score', value: '67', icon: 'star', trend: '+5' },
            { label: 'Engagement', value: '8.4/10', icon: 'bar_chart', trend: '+0.6' },
            { label: 'Risk Score', value: 'Low', icon: 'shield_check', trend: '' },
          ].map((metric) => (
            <div key={metric.label} className="bg-surface-container-low p-4 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-on-surface-variant text-base">{metric.icon}</span>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{metric.label}</p>
              </div>
              <p className="text-xl font-mono font-bold text-on-surface">{metric.value}</p>
              {metric.trend && (
                <p className="text-xs font-mono text-primary mt-1">{metric.trend}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Domain Breakdown */}
      <div className="bg-surface-container rounded-xl p-6">
        <h3 className="font-headline text-lg font-bold text-on-surface mb-5">GRI Domain Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { domain: 'Strategy & Vision', score: 840, weight: '20%' },
            { domain: 'Financial Health', score: 760, weight: '20%' },
            { domain: 'Operations', score: 820, weight: '15%' },
            { domain: 'Team & Talent', score: 710, weight: '15%' },
            { domain: 'Market Position', score: 780, weight: '15%' },
            { domain: 'Technology', score: 690, weight: '15%' },
          ].map((item) => {
            const pct = Math.round(item.score / 10)
            const color = item.score >= 800 ? 'bg-primary' : item.score >= 700 ? 'bg-primary-fixed-dim' : 'bg-tertiary-container'
            return (
              <div key={item.domain} className="bg-surface-container-high rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-sm font-medium text-on-surface">{item.domain}</p>
                  <span className="text-[10px] font-mono text-on-surface-variant">{item.weight}</span>
                </div>
                <p className="text-2xl font-mono font-bold text-on-surface mb-2">{item.score}</p>
                <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
