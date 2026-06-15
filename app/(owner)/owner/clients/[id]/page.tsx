import Link from 'next/link'
import { GriScoreDial } from '@/components/gri/GriScoreDial'
import { StatusBadge } from '@/components/common/StatusBadge'
import { prisma } from '@/lib/db'

export default async function OwnerClientDetailPage({ params }: { params: { id: string } }) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      manager: true,
      griReports: {
        orderBy: { calculatedAt: 'desc' },
        take: 2,
      },
    },
  })

  if (!client) {
    return (
      <div className="space-y-6">
        <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Link href="/owner/clients" className="hover:text-on-surface transition-colors">Клиенты</Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface">Нет данных</span>
        </nav>

        <div className="bg-surface-container rounded-xl p-8 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 block">database_off</span>
          <p className="text-on-surface font-medium mb-1">Клиент не найден</p>
          <p className="text-sm text-on-surface-variant mb-4">В базе нет записи с таким идентификатором.</p>
          <Link href="/owner/clients" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-outline-variant/30 text-sm hover:bg-surface-container-high transition-colors">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Вернуться к списку
          </Link>
        </div>
      </div>
    )
  }

  const latestScore = client.griReports[0]?.score
  const previousScore = client.griReports[1]?.score
  const griScore = latestScore ? Math.round(latestScore) : 0
  const prev = previousScore ? Math.round(previousScore) : undefined

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/owner/clients" className="hover:text-on-surface transition-colors">Клиенты</Link>
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
            <StatusBadge status={client.status as any} label={client.status} />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">business</span>
              {client.industry}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">person</span>
              {client.manager.name ?? client.manager.email}
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
        <div className="lg:col-span-1">
          <GriScoreDial score={griScore} previousScore={prev} />
        </div>
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'GRI Reports', value: String(client.griReports.length), icon: 'description', trend: '' },
            { label: 'Статус клиента', value: client.status, icon: 'shield_check', trend: '' },
            { label: 'Отрасль', value: client.industry, icon: 'domain', trend: '' },
            { label: 'Орг ID', value: client.orgId.slice(0, 8), icon: 'apartment', trend: '' },
            { label: 'Менеджер', value: client.manager.name ?? 'Назначен', icon: 'person', trend: '' },
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
        {client.griReports[0] ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { domain: 'Product', score: client.griReports[0].productScore },
              { domain: 'Trust', score: client.griReports[0].trustScore },
              { domain: 'Business', score: client.griReports[0].businessModelScore },
              { domain: 'Cash', score: client.griReports[0].cashScore },
              { domain: 'Ops', score: client.griReports[0].operationsScore },
              { domain: 'Team', score: client.griReports[0].teamScore },
              { domain: 'Founder', score: client.griReports[0].founderScore },
            ].map((item) => {
              const pct = Math.max(0, Math.min(100, Math.round(item.score * 10)))
              const color = item.score >= 80 ? 'bg-primary' : item.score >= 70 ? 'bg-primary-fixed-dim' : item.score >= 50 ? 'bg-tertiary-container' : 'bg-error'
              return (
                <div key={item.domain} className="bg-surface-container-high rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-sm font-medium text-on-surface">{item.domain}</p>
                  </div>
                  <p className="text-2xl font-mono font-bold text-on-surface mb-2">{item.score.toFixed(1)}</p>
                  <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">GRI отчёты для клиента пока отсутствуют.</p>
        )}
      </div>
    </div>
  )
}
