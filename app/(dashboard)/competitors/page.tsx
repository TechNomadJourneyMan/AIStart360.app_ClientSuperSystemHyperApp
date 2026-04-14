export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getDashboardData } from '@/lib/get-dashboard-data'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

export const metadata: Metadata = { 
  title: 'Конкурентный Analysis | AIStart360',
  description: 'Deep competitive analysis and market positioning.'
}

const THREAT_LEVELS = {
  high: { label: 'High Threat', color: 'bg-error/10 text-error border-error/20', icon: 'priority_high' },
  medium: { label: 'Moderate Threat', color: 'bg-warning/10 text-warning border-warning/20', icon: 'trending_flat' },
  low: { label: 'Low Threat', color: 'bg-success/10 text-success border-success/20', icon: 'check_circle' },
}

export default async function CompetitorsPage() {
  const session = await auth()
  const data = getDashboardData(session?.user?.email)
  
  const [clientsCount, orgsCount] = await Promise.all([
    prisma.client.count(),
    prisma.organization.count(),
  ])

  return (
    <div className="max-w-[1600px] mx-auto space-y-10 pb-20">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-surface-container-low border border-white/[0.05] p-10 lg:p-14">
        <div className="absolute top-0 right-0 w-1/2 h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[80%] h-[80%] bg-primary rounded-full blur-[120px] animate-pulse" />
        </div>
        
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest">Market Intelligence v4.0</span>
          </div>
          
          <h1 className="text-4xl lg:text-5xl xl:text-6xl font-headline font-extrabold text-on-surface leading-[1.1] mb-6 tracking-tight">
            Analysis <br/>
            <span className="text-gradient">Competitive Landscape</span>
          </h1>
          
          <p className="text-lg text-on-surface-variant leading-relaxed mb-8">
            Monitoring market shares, technological superiority, and growth strategies of major industry players на Q1 2026.
          </p>

          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-3 bg-surface/50 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/[0.05]">
              <span className="material-symbols-outlined text-primary">sensors</span>
              <div>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest leading-none mb-1">Live Tracking</p>
                <p className="text-sm font-bold text-on-surface">6 источников активно</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-surface/50 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/[0.05]">
              <span className="material-symbols-outlined text-primary">update</span>
              <div>
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest leading-none mb-1">Last Update</p>
                <p className="text-sm font-bold text-on-surface">14 минут назад</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Snapshot Stats */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          { label: 'Мониторинг', value: data.COMPETITORS.length, icon: 'visibility', trend: '+2', color: 'text-primary' },
          { label: 'Пересечение баз', value: '42%', icon: 'hub', trend: '+5%', color: 'text-secondary' },
          { label: 'Общий ARR сегмента', value: '$840M', icon: 'monetization_on', trend: '+12%', color: 'text-success' },
          { label: 'Индекс агрессии', value: '7.4/10', icon: 'bolt', trend: 'High', color: 'text-error' },
        ].map((stat, i) => (
          <Card key={i} className="p-6 border-white/[0.05] hover:border-primary/20 transition-all group overflow-hidden relative">
            <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
              <span className="material-symbols-outlined text-8xl">{stat.icon}</span>
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center text-on-surface-variant group-hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[22px]">{stat.icon}</span>
              </div>
              <Badge variant="default" className="font-mono text-[10px]">{stat.trend}</Badge>
            </div>
            <div>
              <p className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">{stat.label}</p>
              <h3 className="text-2xl font-bold text-on-surface font-headline">{stat.value}</h3>
            </div>
          </Card>
        ))}
      </section>

      {/* Competitor Grid */}
      <section>
        <div className="flex items-center justify-between mb-8 px-2">
          <div>
            <h2 className="text-2xl font-headline font-bold text-on-surface mb-1">Основные игроки</h2>
            <p className="text-sm text-on-surface-variant">Сравнительный анализ по ключевым метрикам</p>
          </div>
          <button className="h-10 px-4 bg-surface-container-high hover:bg-surface-container-highest border border-white/[0.05] rounded-xl text-xs font-bold text-on-surface transition-all flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">filter_list</span>
            Настроить фильтры
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {data.COMPETITORS.map((comp) => {
            const threat = THREAT_LEVELS[comp.threat as keyof typeof THREAT_LEVELS] || THREAT_LEVELS.low
            return (
              <div 
                key={comp.id} 
                className="group relative bg-surface-container-low/40 backdrop-blur-md rounded-[2rem] border border-white/[0.04] p-8 hover:bg-surface-container-low transition-all duration-500 overflow-hidden"
              >
                {/* Threat badge */}
                <div className="absolute top-8 right-8 z-10">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-mono font-bold uppercase ${threat.color}`}>
                    <span className="material-symbols-outlined text-[14px]">{threat.icon}</span>
                    {threat.label}
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                  {/* Left info */}
                  <div className="flex-1 space-y-6">
                    <div>
                      <h3 className="text-2xl font-headline font-bold text-on-surface mb-2 tracking-tight group-hover:text-primary transition-colors">
                        {comp.name}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                        <span className="bg-surface-container-high px-2 py-0.5 rounded-md">{comp.funding}</span>
                        <span className="w-1 h-1 rounded-full bg-on-surface-variant/20" />
                        <span>{comp.market}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-surface-container/50 rounded-2xl p-4 border border-white/[0.03]">
                        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Estimate ARR</p>
                        <p className="text-lg font-bold text-on-surface font-headline">{comp.arr}</p>
                      </div>
                      <div className="bg-surface-container/50 rounded-2xl p-4 border border-white/[0.03]">
                        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Clientская база</p>
                        <p className="text-lg font-bold text-on-surface font-headline">{comp.clients}</p>
                      </div>
                    </div>
                  </div>

                  {/* Divider (mobile only) */}
                  <div className="h-px w-full bg-white/[0.05] md:hidden" />
                  
                  {/* Right comparison */}
                  <div className="w-full md:w-[240px] space-y-6">
                    <div>
                      <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span className="w-4 h-px bg-primary/30" />
                        Преимущества
                      </p>
                      <div className="space-y-2">
                        {comp.strengths.map(s => (
                          <div key={s} className="flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-primary" />
                            <span className="text-xs text-on-surface-variant leading-tight">{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-mono text-error uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span className="w-4 h-px bg-error/30" />
                        Слабые стороны
                      </p>
                      <div className="space-y-2">
                        {comp.weaknesses.map(w => (
                          <div key={w} className="flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-error" />
                            <span className="text-xs text-on-surface-variant leading-tight">{w}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom action row */}
                <div className="mt-8 pt-6 border-t border-white/[0.05] flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="w-6 h-6 rounded-full border-2 border-surface bg-surface-container-highest flex items-center justify-center text-[10px]">
                          <span className="material-symbols-outlined text-[12px] opacity-40">person</span>
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] text-on-surface-variant font-mono">12 экспертов следят</span>
                  </div>
                  <button className="text-xs font-bold text-primary hover:underline flex items-center gap-1 group/btn">
                    Полный отчёт
                    <span className="material-symbols-outlined text-sm group-hover/btn:translate-x-1 transition-transform">arrow_forward</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Landscape Map (Premium Version) */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-surface-container-low to-surface border border-white/[0.05] p-10 lg:p-14 text-center">
        <div className="max-w-xl mx-auto space-y-6">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-8 border border-primary/20">
            <span className="material-symbols-outlined text-4xl text-primary animate-pulse">explore</span>
          </div>
          <h2 className="text-3xl font-headline font-extrabold text-on-surface">Рыночное Позиционирование</h2>
          <p className="text-on-surface-variant leading-relaxed">
            Интерактивная карта рыночного ландшафта (Magic Quadrant AIStart360) формируется в реальном времени. 
            Пожалуйста, подключите дополнительные источники данных для построения точной проекции.
          </p>
          <div className="pt-4">
            <button className="px-8 h-14 bg-primary text-on-primary font-bold rounded-2xl shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all">
              Подключить Аналитику
            </button>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-1/2 left-10 -translate-y-1/2 opacity-5 pointer-events-none hidden lg:block">
           <span className="material-symbols-outlined text-[200px]">language</span>
        </div>
        <div className="absolute top-1/2 right-10 -translate-y-1/2 opacity-5 pointer-events-none hidden lg:block">
           <span className="material-symbols-outlined text-[200px]">radar</span>
        </div>
      </section>
    </div>
  )
}
