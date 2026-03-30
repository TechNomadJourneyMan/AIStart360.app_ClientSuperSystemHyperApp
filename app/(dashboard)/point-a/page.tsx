import type { Metadata } from 'next'
import { prisma } from '@/lib/db'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage() {
  const [clientsCount, avgScoreRes, latestReports] = await Promise.all([
    prisma.client.count(),
    prisma.griReport.aggregate({ _avg: { overallScore: true } }),
    prisma.griReport.findMany({
      include: { client: { select: { name: true } } },
      orderBy: { calculatedAt: 'desc' },
      take: 5,
    }),
  ])

  const avgScore = Number(avgScoreRes._avg.overallScore ?? 0)
  const domainScores = latestReports[0]
    ? [
        { id: 'product', label: 'Product', score: latestReports[0].productScore, max: 100, icon: 'inventory_2' },
        { id: 'trust', label: 'Trust', score: latestReports[0].trustScore, max: 100, icon: 'verified_user' },
        { id: 'business', label: 'Business', score: latestReports[0].businessModelScore, max: 100, icon: 'business_center' },
        { id: 'cash', label: 'Cash', score: latestReports[0].cashScore, max: 100, icon: 'payments' },
        { id: 'operations', label: 'Operations', score: latestReports[0].operationsScore, max: 100, icon: 'settings' },
        { id: 'team', label: 'Team', score: latestReports[0].teamScore, max: 100, icon: 'groups' },
        { id: 'founder', label: 'Founder', score: latestReports[0].founderScore, max: 100, icon: 'person' },
      ]
    : []

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Диагностика · Текущее состояние
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Точка{' '}
          <span className="text-gradient">А</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Объективная оценка текущего состояния бизнеса — фундамент для построения стратегии роста.
        </p>
      </section>

      {/* Current State Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Общий GRI', value: avgScore.toFixed(1), icon: 'radar', good: avgScore >= 70, note: 'средний по отчётам' },
          { label: 'Клиенты', value: String(clientsCount), icon: 'groups', good: true, note: 'в текущем пуле' },
          { label: 'GRI отчёты', value: String(latestReports.length), icon: 'description', good: latestReports.length > 0, note: 'последние расчёты' },
          { label: 'Последний апдейт', value: latestReports[0] ? new Date(latestReports[0].calculatedAt).toLocaleDateString('ru-RU') : 'n/a', icon: 'update', good: Boolean(latestReports[0]), note: 'дата расчёта' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
              <span className={`material-symbols-outlined text-base ${stat.good ? 'text-primary/50' : 'text-error/50'}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-1">{stat.value}</p>
            <p className={`text-xs font-mono ${stat.good ? 'text-primary' : 'text-error'}`}>{stat.note}</p>
          </div>
        ))}
      </section>

      {/* Domain Diagnostics */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика доменов</h2>
            <p className="text-xs text-on-surface-variant mt-1">Текущий уровень готовности по каждому направлению</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {domainScores.map((domain) => {
            const pct = (domain.score / domain.max) * 100
            const isStrong = domain.score >= 70
            const isCritical = domain.score < 50
            return (
              <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-colors group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                  </div>
                  <span className={`text-xs font-mono ${isCritical ? 'text-error' : isStrong ? 'text-primary' : 'text-tertiary-container'}`}>
                    {isCritical ? 'Критично' : isStrong ? 'Сильная зона' : 'Развивается'}
                  </span>
                </div>
                <h3 className="text-sm font-medium text-on-surface mb-3">{domain.label}</h3>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-3xl font-mono font-bold text-on-surface">{domain.score.toFixed(1)}</span>
                  <span className="text-xs text-on-surface-variant font-mono">/ 100</span>
                </div>
                <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${isCritical ? 'bg-error' : isStrong ? 'bg-primary' : 'bg-tertiary-container'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}

          {domainScores.length === 0 && (
            <div className="col-span-full bg-surface-container-low rounded-2xl border border-white/[0.04] p-6 text-sm text-on-surface-variant">
              Данные диагностики пока отсутствуют. Раздел покажет домены после первого GRI-расчёта.
            </div>
          )}
        </div>
      </section>

      {/* Problem Areas */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Выявленные проблемы</h2>
        <div className="space-y-3">
          {latestReports.map((report, i) => (
            <div key={i} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex items-start gap-4">
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${report.overallScore < 50 ? 'bg-error' : 'bg-tertiary-container'}`} />
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-[10px] font-mono bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-md uppercase tracking-wider">
                    {report.client.name}
                  </span>
                  <span className={`text-[10px] font-mono uppercase ${report.overallScore < 50 ? 'text-error' : 'text-tertiary-container'}`}>
                    {report.overallScore < 50 ? 'Высокий' : 'Средний'} приоритет
                  </span>
                </div>
                <p className="text-sm text-on-surface mb-1">GRI score: {report.overallScore.toFixed(1)}</p>
                <p className="text-xs text-primary">→ Обновить план роста на основе последнего расчёта</p>
              </div>
            </div>
          ))}

          {latestReports.length === 0 && (
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 text-sm text-on-surface-variant">
              Проблемные зоны будут отображены после появления первых диагностик.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
