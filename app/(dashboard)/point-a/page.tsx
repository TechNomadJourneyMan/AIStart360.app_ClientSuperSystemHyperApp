export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
import { DocumentUpload } from '@/components/diagnostics/DocumentUpload'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)

  // Fetch real data from database
  const [clientsCount, avgScoreRes, latestReports] = await Promise.all([
    prisma.client.count(),
    prisma.griReport.aggregate({ _avg: { score: true } }),
    prisma.griReport.findMany({
      include: { client: { select: { name: true, id: true } } },
      orderBy: { calculatedAt: 'desc' },
      take: 5,
    }),
  ])

  const avgScore = Number(avgScoreRes._avg.score ?? 0)
  const client = await prisma.client.findFirst({
    where: { 
      OR: [
        { manager: { email: session?.user?.email ?? '' } },
        { name: session?.user?.email === 'portal@chocofamily.kz' ? 'ChocoFamily' : 'Mock Client' }
      ]
    }
  })

  // Domain scores from the very latest report or mock data as fallback
  const firstReport = latestReports[0]
  const domainScores = firstReport
    ? [
        { id: 'product', label: 'Product & Tech', score: firstReport.productScore, max: 100, icon: 'inventory_2' },
        { id: 'trust', label: 'Trust & Reputation', score: firstReport.trustScore, max: 100, icon: 'verified_user' },
        { id: 'business', label: 'Business Model', score: firstReport.businessModelScore, max: 100, icon: 'business_center' },
        { id: 'cash', label: 'Cash & Finance', score: firstReport.cashScore, max: 100, icon: 'payments' },
        { id: 'operations', label: 'Operations', score: firstReport.operationsScore, max: 100, icon: 'settings' },
        { id: 'team', label: 'Team & Culture', score: firstReport.teamScore, max: 100, icon: 'groups' },
        { id: 'founder', label: 'Founder & Strategy', score: firstReport.founderScore, max: 100, icon: 'person' },
      ]
    : data.GRI_DOMAINS.map(d => ({ ...d, label: d.label, max: 10 })) // Fallback to mocks scaled to 10

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          AI Диагностика · Текущее состояние
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Точка <span className="text-gradient">А</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
          Объективная оценка текущего состояния бизнеса через призму GRI-матрицы. 
          Загрузите документы для автоматического анализа ИИ-агентом.
        </p>
      </section>

      {/* AI Diagnostic Upload */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-1 overflow-hidden">
          <DocumentUpload clientId={client?.id ?? 'default-client-id'} />
        </div>
      </section>

      {/* Current State Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { 
            label: 'Общий GRI', 
            value: firstReport ? firstReport.score.toFixed(0) : avgScore.toFixed(0), 
            icon: 'radar', 
            good: (firstReport?.score ?? avgScore) >= 700, 
            note: firstReport ? 'Последний расчёт' : 'Среднее по системе' 
          },
          { label: 'Клиенты', value: String(clientsCount), icon: 'groups', good: true, note: 'активных в базе' },
          { label: 'GRI отчёты', value: String(latestReports.length), icon: 'description', good: true, note: 'хранится в архиве' },
          { label: 'Health Score', value: 'High', icon: 'favorite', good: true, note: 'стабильный рост' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
              <span className={`material-symbols-outlined text-base ${stat.good ? 'text-primary/50' : 'text-error/50'}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-1">{stat.value}</p>
            <p className={`text-[10px] font-mono uppercase tracking-tighter ${stat.good ? 'text-primary' : 'text-error'}`}>{stat.note}</p>
          </div>
        ))}
      </section>

      {/* Domain Diagnostics */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика доменов</h2>
            <p className="text-xs text-on-surface-variant mt-1">Текущий уровень готовности по каждому направлению GRI</p>
          </div>
          <button className="text-xs font-mono text-primary font-bold hover:underline">Подробный отчет</button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {domainScores.map((domain) => {
            const max = (domain as any).max ?? 100
            const score = domain.score
            const pct = (score / max) * 100
            const isStrong = pct >= 70
            const isCritical = pct < 50

            return (
              <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-5 transition-all group hover:scale-[1.01]">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.04] group-hover:border-primary/20 transition-colors">
                    <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${
                    isCritical ? 'text-error border-error/20 bg-error/5' : 
                    isStrong ? 'text-primary border-primary/20 bg-primary/5' : 
                    'text-tertiary-container border-tertiary-container/20 bg-tertiary-container/5'
                  }`}>
                    {isCritical ? 'Критично' : isStrong ? 'High' : 'Normal'}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-on-surface mb-3">{domain.label}</h3>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-3xl font-mono font-bold text-on-surface">{score.toFixed(1)}</span>
                  <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-widest">/ {max} PTS</span>
                </div>
                <div className="h-1.5 bg-surface-container rounded-full overflow-hidden border border-white/[0.02]">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      isCritical ? 'bg-error' : isStrong ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)]' : 'bg-tertiary-container'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Feed of reports */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Последние расчёты</h2>
        <div className="grid grid-cols-1 gap-3">
          {latestReports.map((report) => (
            <div key={report.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-surface-container transition-colors group">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold border ${report.score >= 700 ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-error/10 border-error/20 text-error'}`}>
                  {Math.round(report.score / 10)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface">{report.client.name}</h3>
                  <p className="text-xs text-on-surface-variant font-mono">
                    {new Date(report.calculatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right hidden md:block">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Growth Plan</p>
                  <p className="text-xs text-primary font-bold">Generated by AI</p>
                </div>
                <button className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-container group-hover:bg-primary group-hover:text-on-primary transition-all">
                  <span className="material-symbols-outlined text-base">download</span>
                </button>
              </div>
            </div>
          ))}

          {latestReports.length === 0 && (
            <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-12 text-center group hover:border-primary/30 transition-colors">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-4 block group-hover:text-primary/20 transition-colors">insert_chart</span>
              <p className="text-sm text-on-surface-variant font-medium">Нет загруженных отчетов</p>
              <p className="text-xs text-on-surface-variant/60 mt-1">Используйте форму выше для загрузки документации</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
