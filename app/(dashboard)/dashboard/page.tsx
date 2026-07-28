export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import Link from 'next/link'
import { GoalsBar } from '@/components/dashboard/GoalsBar'
import { WidgetGrid } from '@/components/dashboard/WidgetGrid'
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
  available: boolean
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

    // A real activity log is not connected to this dashboard yet. Recent users
    // must not be presented as if they were verified activity events.
    const activity: ActivityItem[] = []

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
      { label: 'Пользователи', value: '—', trend: 'недоступно', trendUp: false, available: false, icon: 'groups', sublabel: 'источник данных', href: '/users' },
      { label: 'Активных', value: '—', trend: 'недоступно', trendUp: false, available: false, icon: 'check_circle', sublabel: 'источник данных', href: '/users' },
      { label: 'Заявки', value: '—', trend: 'недоступно', trendUp: false, available: false, icon: 'hourglass_top', sublabel: 'источник данных', href: '/admin?tab=clients' },
      { label: 'GRI анализов', value: '—', trend: 'недоступно', trendUp: false, available: false, icon: 'radar', sublabel: 'источник данных', href: '/gri' },
    ]
  }
  const activePct = data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
  return [
    {
      label:    'Пользователи',
      value:    String(data.total),
      trend:    data.total > 0 ? `+${data.total}` : '0',
      trendUp:  true,
      available: true,
      icon:     'groups',
      sublabel: 'в системе',
      href:     '/users',
    },
    {
      label:    'Активных',
      value:    String(data.active),
      trend:    `${activePct}%`,
      trendUp:  data.active > 0,
      available: true,
      icon:     'check_circle',
      sublabel: 'статус active',
      href:     '/users',
    },
    {
      label:    'Заявки',
      value:    String(data.pending),
      trend:    data.pending > 0 ? 'нужна проверка' : 'нет новых',
      trendUp:  data.pending === 0,
      available: true,
      icon:     'hourglass_top',
      sublabel: 'на регистрацию',
      href:     '/admin?tab=clients',
    },
    {
      label:    'GRI анализов',
      value:    String(data.griDist.total),
      trend:    data.griDist.excellent > 0 ? `${data.griDist.excellent} excellent` : '—',
      trendUp:  data.griDist.excellent > 0,
      available: true,
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
  const unavailable = data === null
  const kpi = buildKpi(data)
  const alerts = data?.alerts ?? []
  const activity = data?.activity ?? []
  const griDistRows = data ? buildGriDistRows(data.griDist) : []

  return (
    <div className="space-y-6">
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">
              Оперативный обзор
            </p>
            <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
              Состояние клиентского{' '}
              <span className="text-gradient">портфеля</span>
            </h1>
            <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
              Здесь отображаются только показатели, подтверждённые подключёнными источниками данных.
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

        {unavailable && (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
          >
            <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">cloud_off</span>
            <div>
              <p className="text-sm font-medium text-on-surface">Оперативные данные дэшборда временно недоступны</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                Источник данных не отвечает. Тире в показателях означают отсутствие актуальных данных, а не нулевые значения.
              </p>
            </div>
          </div>
        )}

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
                             <span className={`material-symbols-outlined text-sm ${
                               card.available ? (card.trendUp ? 'text-primary' : 'text-error') : 'text-on-surface-variant'
                             }`}>
                                {card.available ? (card.trendUp ? 'trending_up' : 'trending_down') : 'cloud_off'}
                             </span>
                             <span className={
                               card.available ? (card.trendUp ? 'text-primary' : 'text-error') : 'text-on-surface-variant'
                             }>{card.trend}</span>
                             <span>{card.sublabel}</span>
                         </div>
                      </Link>
                 ))}
             </div>

             {/* Right: GRI Widget or Alerts */}
             <div className="xl:col-span-3">
                 {unavailable ? (
                   <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
                     <div>
                       <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">radar</span>
                       <p className="text-sm font-medium text-on-surface">GRI портфеля не загружен</p>
                       <p className="mt-1 text-xs text-on-surface-variant">
                         Диаграмма и итоговый балл появятся после восстановления источника данных.
                       </p>
                     </div>
                   </div>
                 ) : data.griDist.total === 0 ? (
                   <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
                     <div>
                       <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">radar</span>
                       <p className="text-sm font-medium text-on-surface">GRI-отчётов пока нет</p>
                       <p className="mt-1 text-xs text-on-surface-variant">
                         Распределение появится после первого сохранённого расчёта.
                       </p>
                     </div>
                   </div>
                 ) : (
                   <div className="min-h-[300px] rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
                     <div className="mb-6 flex items-start justify-between gap-4">
                       <div>
                         <p className="text-[10px] font-mono uppercase tracking-widest text-primary/60">GRI портфеля</p>
                         <p className="mt-2 text-3xl font-mono font-bold text-on-surface">{data.griDist.total}</p>
                         <p className="mt-1 text-xs text-on-surface-variant">подтверждённых отчётов</p>
                       </div>
                       <Link href="/gri" className="text-xs text-primary hover:underline">Подробнее</Link>
                     </div>
                     <div className="space-y-4">
                       {griDistRows.map((row) => (
                         <div key={row.label}>
                           <div className="mb-1.5 flex justify-between text-[11px]">
                             <span className="text-on-surface-variant">{row.label}</span>
                             <span className="font-mono text-on-surface">{row.pct}%</span>
                           </div>
                           <div className="h-1.5 overflow-hidden rounded-full bg-surface-container">
                             <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.pct}%` }} />
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
             </div>
        </div>
      </section>

      {/* ─── Main Content ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-headline text-lg font-bold text-on-surface">Критические сигналы</h2>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono ${
                    unavailable
                      ? 'bg-surface-container border-outline-variant/20 text-on-surface-variant'
                      : 'bg-error/10 border-error/20 text-error'
                  }`}>
                    {unavailable ? '— алертов' : `${alerts.filter(a => a.severity === 'critical').length} алерта`}
                  </span>
                </div>
                {unavailable ? (
                  <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-2">warning</span>
                    <p className="text-sm font-medium text-on-surface">Состояние сигналов не проверено</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Нельзя подтвердить отсутствие критических событий, пока источник данных недоступен.
                    </p>
                  </div>
                ) : alerts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {alerts.map(alert => (
                      <AlertCard key={alert.id} {...alert} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-primary/20 mb-2">notifications_none</span>
                    <p className="text-sm text-on-surface-variant">Новых регистрационных сигналов нет</p>
                    <p className="mt-1 text-xs text-on-surface-variant/70">
                      Этот блок не подтверждает состояние остальных систем.
                    </p>
                  </div>
                )}
              </section>

              {unavailable ? (
                <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
                  <p className="text-sm font-medium text-on-surface">Виджеты оперативных данных недоступны</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Активность, GRI и сигналы не отображаются без подтверждённых данных.
                  </p>
                </div>
              ) : (
                <WidgetGrid
                  alerts={alerts as AlertCardProps[]}
                  activity={activity}
                  gri={[]}
                  metrics={[]}
                  criticalCount={alerts.filter(a => a.severity === 'critical').length}
                />
              )}
          </div>

          <aside className="space-y-6">
              {unavailable ? (
                <div className="bg-surface-container rounded-2xl p-8 text-center border border-white/[0.04]">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">history</span>
                  <p className="text-sm font-medium text-on-surface">Активность не загружена</p>
                  <p className="mt-1 text-xs text-on-surface-variant">Это не означает, что активности нет.</p>
                </div>
              ) : activity.length === 0 ? (
                <div className="bg-surface-container rounded-2xl p-8 text-center border border-white/[0.04]">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">history</span>
                  <p className="text-sm font-medium text-on-surface">Журнал активности не подключён</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Последние пользователи не подменяются вымышленными событиями.
                  </p>
                </div>
              ) : (
                <ActivityFeed items={activity} />
              )}

              {/* GRI Portfolio Health */}
              <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-5">
                  <h3 className="text-sm font-bold text-on-surface mb-4 uppercase tracking-widest text-[10px]">Здоровье портфеля</h3>
                  {unavailable ? (
                    <div className="rounded-xl bg-surface-container p-5 text-center">
                      <p className="text-sm font-mono text-on-surface">—</p>
                      <p className="mt-1 text-xs text-on-surface-variant">Распределение GRI недоступно</p>
                    </div>
                  ) : data.griDist.total === 0 ? (
                    <div className="rounded-xl bg-surface-container p-5 text-center">
                      <p className="text-sm font-mono text-on-surface">0</p>
                      <p className="mt-1 text-xs text-on-surface-variant">GRI-отчётов пока нет</p>
                    </div>
                  ) : (
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
                  )}
              </div>
          </aside>
      </div>
    </div>
  )
}
