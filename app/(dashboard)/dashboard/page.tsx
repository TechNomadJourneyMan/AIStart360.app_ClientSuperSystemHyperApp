export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import Link from 'next/link'
import { KpiCardsGrid } from '@/components/dashboard/KpiCardsGrid'
import { GriDiagramWidget } from '@/components/dashboard/GriDiagramWidget'
import { GoalsBar } from '@/components/dashboard/GoalsBar'
import { WidgetGrid } from '@/components/dashboard/WidgetGrid'
import { createClient } from '@/lib/supabase/server'
import { AlertCard } from '@/components/dashboard/AlertCard'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import type { Alert, ActivityItem } from '@/types'
import type { AlertCardProps } from '@/components/dashboard/AlertCard'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Дэшборд' }

// ─── types ────────────────────────────────────────────────────────────────────
interface KpiCardData {
  label:    string
  value:    string
  trend:    string
  trendUp:  boolean
  icon:     string
  sublabel: string
  href:     string
}

interface GriDist {
  excellent:  number
  strong:     number
  developing: number
  critical:   number
  total:      number
}

interface DashboardData {
  total:    number
  active:   number
  pending:  number
  griDist:  GriDist
  activity: ActivityItem[]
  alerts:   Alert[]
  companies: { id: string; name: string }[]
}

// ─── data fetching ────────────────────────────────────────────────────────────
async function getDashboardExtendedData(): Promise<DashboardData | null> {
  try {
    // In this schema, 'User' represents the accounts.
    // 'Client' represents the business entities.
    const users = await prisma.user.findMany({
      select: {
        id: true,
        status: true,
        name: true,
        email: true,
        role: true
      }
    })

    const total = users.length
    const active = users.filter(u => u.status === 'active').length
    // Assuming 'pending_approval' or similar might exist in Supabase metadata,
    // but in Prisma schema UserStatus is only 'active' | 'blocked'.
    // Let's check AdminRequests for registrations.
    const pendingRequests = await prisma.adminRequest.count({
      where: { status: 'new', type: 'registration' }
    })

    // Diagnostics for GRI
    // The schema has GriReport and DiagnosticRun.
    const griReports = await prisma.griReport.findMany({
      select: {
        score: true,
        clientId: true
      }
    })

    const scores = griReports.map(r => r.score)
    const griDist: GriDist = {
      excellent:  scores.filter(s => s >= 90).length, // assuming 0-100 scale
      strong:     scores.filter(s => s >= 70 && s < 90).length,
      developing: scores.filter(s => s >= 50 && s < 70).length,
      critical:   scores.filter(s => s < 50).length,
      total:      scores.length,
    }

    // Companies
    const companiesRaw = await prisma.company.findMany({
      take: 10,
      select: {
        id: true,
        name: true
      }
    })
    
    // Activity - using most recent users as a proxy for now
    const recentUsers = [...users].sort((a,b) => b.id.localeCompare(a.id)).slice(0, 6)
    const activity: ActivityItem[] = recentUsers.map(u => ({
      id: u.id,
      actor: (u.name || u.email || 'Клиент'),
      actorRole: u.role.toLowerCase(),
      event: 'Активность в системе',
      gri: 0,
      status: u.status === 'active' ? 'active' : 'inactive',
      time: 'недавно',
    }))

    // Alerts
    const alerts: Alert[] = []
    if (pendingRequests > 0) {
      alerts.push({
        id: 'pending-reg',
        severity: 'info',
        title: `${pendingRequests} заявок ожидают проверки`,
        description: 'Новые клиенты зарегистрировались и ждут подтверждения аккаунта.',
        time: 'сейчас',
        action: { label: 'Просмотреть', href: '/admin?tab=clients' },
      })
    }

    return { 
      total, 
      active, 
      pending: pendingRequests, 
      griDist, 
      activity, 
      alerts, 
      companies: (companiesRaw as any)
    }
  } catch (e) {
    console.error('[Dashboard] data fetch error:', e)
    return null
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function buildKpi(data: DashboardData | null): KpiCardData[] {
  if (!data) {
    return [
      { label: 'Пользователи', value: '—',  trend: '—',    trendUp: true,  icon: 'groups',       sublabel: 'загрузка...', href: '/users'   },
      { label: 'Активных',  value: '—',  trend: '—',    trendUp: true,  icon: 'check_circle', sublabel: 'загрузка...', href: '/users'   },
      { label: 'Заявки',    value: '—',  trend: '—',    trendUp: false, icon: 'hourglass_top',sublabel: 'загрузка...', href: '/admin?tab=clients' },
      { label: 'GRI анализов',value: '—', trend: '—',    trendUp: true,  icon: 'radar',        sublabel: 'загрузка...', href: '/gri'       },
    ]
  }
  const activePct = data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
  return [
    {
      label:    'Пользователи',
      value:    String(data.total),
      trend:    data.total > 0 ? `+${data.total}` : '0',
      trendUp:  true,
      icon:     'groups',
      sublabel: 'в системе',
      href:     '/users',
    },
    {
      label:    'Активных',
      value:    String(data.active),
      trend:    `${activePct}%`,
      trendUp:  data.active > 0,
      icon:     'check_circle',
      sublabel: 'статус active',
      href:     '/users',
    },
    {
      label:    'Заявки',
      value:    String(data.pending),
      trend:    data.pending > 0 ? 'нужна проверка' : 'нет новых',
      trendUp:  data.pending === 0,
      icon:     'hourglass_top',
      sublabel: 'на регистрацию',
      href:     '/admin?tab=clients',
    },
    {
      label:    'GRI анализов',
      value:    String(data.griDist.total),
      trend:    data.griDist.excellent > 0 ? `${data.griDist.excellent} excellent` : '—',
      trendUp:  data.griDist.excellent > 0,
      icon:     'radar',
      sublabel: 'отчётов сформировано',
      href:     '/gri',
    },
  ]
}

function buildGriDistRows(griDist: GriDist) {
  const { excellent, strong, developing, critical, total } = griDist
  if (total === 0) {
    return [
      { label: 'Excellent (90+)', pct: 0, color: 'bg-primary' },
      { label: 'Strong (70-89)',   pct: 0, color: 'bg-primary-fixed-dim' },
      { label: 'Developing (50-69)', pct: 0, color: 'bg-tertiary-container' },
      { label: 'Critical (<50)',    pct: 0, color: 'bg-error' },
    ]
  }
  const p = (n: number) => Math.round((n / total) * 100)
  return [
    { label: 'Excellent (90+)', pct: p(excellent),  color: 'bg-primary' },
    { label: 'Strong (70-89)',   pct: p(strong),     color: 'bg-primary-fixed-dim' },
    { label: 'Developing (50-69)', pct: p(developing), color: 'bg-tertiary-container' },
    { label: 'Critical (<50)',    pct: p(critical),   color: 'bg-error' },
  ]
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const data = await getDashboardExtendedData()
  const kpi = buildKpi(data)
  const alerts = data?.alerts ?? []
  const activity = data?.activity ?? []
  const griDistRows = buildGriDistRows(data?.griDist ?? { excellent: 0, strong: 0, developing: 0, critical: 0, total: 0 })

  const griDomains = [
    { label: 'Продукт и спрос',           score: 4.7 },
    { label: 'Доверие и позиционирование',score: 5.2 },
    { label: 'Бизнес-модель',             score: 7.4 },
    { label: 'Финансовая устойчивость',   score: 5.0 },
    { label: 'Операции',                  score: 2.1 },
    { label: 'Команда',                   score: 2.5 },
    { label: 'Готовность основателя',     score: 6.7 },
  ]
  const griTotalScore = 4.8

  return (
    <div className="space-y-6">
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">
              Q1 2026 · Текущий период
            </p>
            <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
              Ускоряем рост бизнеса до{' '}
              <span className="text-gradient">$2M в год</span>
            </h1>
            <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
              Система выхода на стабильную скорость роста $2M/год на основе AI-трансформации и сопровождения топ-экспертов
            </p>
          </div>
          <Link
            href="/sales-monitoring"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <span className="material-symbols-outlined text-lg">point_of_sale</span>
            Мониторинг продаж
          </Link>
        </div>

        {/* Goals bar */}
        <div className="mb-5">
           <GoalsBar />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
             {/* Left: KPI Cards 2x2 */}
             <div className="xl:col-span-2 grid grid-cols-2 gap-3">
                 {kpi.map(card => (
                      <Link key={card.label} href={card.href}
                        className="bg-surface-container-low rounded-2xl p-5 border border-white/[0.04] hover:border-primary/20 transition-all group cursor-pointer relative overflow-hidden"
                      >
                         <div className="flex items-start justify-between mb-3">
                            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{card.label}</p>
                            <span className="material-symbols-outlined text-base text-primary/40 group-hover:text-primary transition-colors">{card.icon}</span>
                         </div>
                         <h3 className="text-3xl font-mono font-bold text-on-surface mb-2">{card.value}</h3>
                         <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant">
                             <span className={`material-symbols-outlined text-sm ${card.trendUp ? 'text-primary' : 'text-error'}`}>
                                {card.trendUp ? 'trending_up' : 'trending_down'}
                             </span>
                             <span className={card.trendUp ? 'text-primary' : 'text-error'}>{card.trend}</span>
                             <span>{card.sublabel}</span>
                         </div>
                      </Link>
                 ))}
             </div>

             {/* Right: GRI Widget or Alerts */}
             <div className="xl:col-span-3">
                 <GriDiagramWidget 
                    domains={griDomains} 
                    totalScore={griTotalScore} 
                    orgName="Портфельный обзор"
                 />
             </div>
        </div>
      </section>

      {/* ─── Main Content ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-headline text-lg font-bold text-on-surface">Критические сигналы</h2>
                  <span className="px-2 py-0.5 rounded-full bg-error/10 border border-error/20 text-[10px] font-mono text-error">
                    {alerts.filter(a => a.severity === 'critical').length} алерта
                  </span>
                </div>
                {alerts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {alerts.map(alert => (
                      <AlertCard key={alert.id} {...alert} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-primary/20 mb-2">check_circle</span>
                    <p className="text-sm text-on-surface-variant">Все системы в норме</p>
                  </div>
                )}
              </section>

              <WidgetGrid 
                alerts={alerts as AlertCardProps[]}
                activity={activity}
                gri={[]}
                metrics={[]}
                criticalCount={alerts.filter(a => a.severity === 'critical').length}
              />
          </div>

          <aside className="space-y-6">
              <ActivityFeed items={activity} />

              {/* GRI Portfolio Health */}
              <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-5">
                  <h3 className="text-sm font-bold text-on-surface mb-4 uppercase tracking-widest text-[10px]">Здоровье портфеля</h3>
                  <div className="space-y-4">
                      {griDistRows.map(row => (
                           <div key={row.label}>
                               <div className="flex justify-between text-[11px] mb-1.5">
                                   <span className="text-on-surface-variant">{row.label}</span>
                                   <span className="font-mono text-on-surface">{row.pct}%</span>
                               </div>
                               <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                                   <div className={`h-full ${row.color} rounded-full`} style={{ width: `${row.pct}%` }} />
                               </div>
                           </div>
                      ))}
                  </div>
              </div>
          </aside>
      </div>
    </div>
  )
}
