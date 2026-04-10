export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import Link from 'next/link'
import { KpiCardsGrid } from '@/components/dashboard/KpiCardsGrid'
import { GriDiagramWidget } from '@/components/dashboard/GriDiagramWidget'
import { GoalsBar } from '@/components/dashboard/GoalsBar'
import { WidgetGrid } from '@/components/dashboard/WidgetGrid'
import { createServerClient } from '@/lib/supabase-server'
import { AlertCard } from '@/components/dashboard/AlertCard'
import { CrmActivity } from '@/components/dashboard/CrmActivity'
import type { CrmRequest, CrmClient } from '@/components/dashboard/CrmActivity'
import type { Alert } from '@/types'
import type { AlertCardProps } from '@/components/dashboard/AlertCard'
import { PointARadarWidget } from '@/components/dashboard/PointARadarWidget'
import type { PointA, BlockScore } from '@/types/onboarding'
import { prisma } from '@/lib/db'

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
  alerts:   Alert[]
  companies: { id: string; name: string }[]
}

// ─── data fetching ────────────────────────────────────────────────────────────
async function getDashboardExtendedData(): Promise<DashboardData | null> {
  try {
    const sb = createServerClient()

    // Users from profiles
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, full_name, email, role, status, created_at')
      .order('created_at', { ascending: false })

    const users = profiles ?? []
    const total = users.length
    const active = users.filter(u => u.status === 'approved').length
    const pending = users.filter(u => u.status === 'pending_approval').length

    // Diagnostics for GRI distribution
    const { data: diagnostics } = await sb
      .from('diagnostics')
      .select('overall_score, user_id')

    const scores = (diagnostics ?? []).map(d => d.overall_score ?? 0)
    const griDist: GriDist = {
      excellent:  scores.filter(s => s >= 90).length,
      strong:     scores.filter(s => s >= 70 && s < 90).length,
      developing: scores.filter(s => s >= 50 && s < 70).length,
      critical:   scores.filter(s => s < 50).length,
      total:      scores.length,
    }

    // Companies
    const { data: companies } = await sb
      .from('companies')
      .select('id, name')
      .limit(10)

    // Alerts
    const alerts: Alert[] = []
    if (pending > 0) {
      alerts.push({
        id: 'pending-reg',
        severity: 'info',
        title: `${pending} заявок ожидают проверки`,
        description: 'Новые клиенты зарегистрировались и ждут подтверждения.',
        time: 'сейчас',
        action: { label: 'Просмотреть', href: '/admin-giga-panel' },
      })
    }

    return { total, active, pending, griDist, alerts, companies: (companies ?? []) as { id: string; name: string }[] }
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
      { label: 'Заявки',    value: '—',  trend: '—',    trendUp: false, icon: 'hourglass_top',sublabel: 'загрузка...', href: '/admin/requests' },
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
      href:     '/admin/requests',
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

// ─── client dashboard data ────────────────────────────────────────────────────
function emptyBlock(score = 0): BlockScore {
  return { score, status: score < 30 ? 'critical' : score < 60 ? 'weak' : 'average', top_issues: [], recommendations: [] }
}

function diagToPointA(diag: Record<string, unknown>): PointA {
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index:  (diag.health_index  as number) ?? 0,
    stage:         ((diag.stage as string) ?? 'seed') as import('@/types/onboarding').DiagnosticStage,
    blocks: {
      finance:    (diag.finance_score    as BlockScore) ?? emptyBlock(),
      marketing:  (diag.marketing_score  as BlockScore) ?? emptyBlock(),
      operations: (diag.operations_score as BlockScore) ?? emptyBlock(),
      strategy:   (diag.strategy_score   as BlockScore) ?? emptyBlock(),
      sales:      (diag.sales_score      as BlockScore) ?? emptyBlock(),
    },
    risks:       (diag.risks       as PointA['risks'])       ?? [],
    insights:    (diag.insights    as PointA['insights'])    ?? [],
    quick_wins:  (diag.quick_wins  as PointA['quick_wins'])  ?? [],
    data_gaps:   (diag.data_gaps   as PointA['data_gaps'])   ?? [],
  }
}

function scoreColor(s: number) {
  if (s < 30) return '#ff6b6b'
  if (s < 60) return '#ffbd60'
  return '#6effc0'
}

function stageLabel(s: string) {
  const m: Record<string, string> = { seed: 'Seed', early: 'Early', growth: 'Growth', scale: 'Scale', mature: 'Mature' }
  return m[s] ?? s
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  // Detect viewer role — clients get their personal Point A view
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    // Read role via service-role REST API to bypass RLS (profiles table has RLS recursion issue)
    let role: string | null = null
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=role`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' }
      )
      if (profileRes.ok) {
        const rows = await profileRes.json() as Array<{ role: string }>
        role = rows[0]?.role ?? null
      }
    } catch {
      // fall through — treat as client if role unknown
    }
    // Show client view for: explicit 'client' role, OR unknown role (safety fallback)
    // Only admin/super_admin/expert/manager see the admin dashboard
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'expert' || role === 'manager'
    if (!isAdmin) {
      // Fetch latest diagnostic via REST API to avoid RLS issues
      let diag: Record<string, unknown> | null = null
      let orgName: string | undefined = undefined
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const [diagRes, companyRes] = await Promise.all([
          fetch(
            `${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${user.id}&order=calculated_at.desc&limit=1`,
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' }
          ),
          fetch(
            `${supabaseUrl}/rest/v1/companies?user_id=eq.${user.id}&select=name&limit=1`,
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' }
          ),
        ])
        if (diagRes.ok) {
          const diagRows = await diagRes.json() as Record<string, unknown>[]
          diag = diagRows?.[0] ?? null
        }
        if (companyRes.ok) {
          const companyRows = await companyRes.json() as Array<{ name: string }>
          orgName = companyRows?.[0]?.name ?? undefined
        }
      } catch {
        // diagnostics not available yet
      }

      const pointA = diag ? diagToPointA(diag as Record<string, unknown>) : null
      const totalScore = pointA?.overall_score ?? 0
      const healthIndex = pointA?.health_index ?? 0

      return (
        <div className="space-y-6">
          <section>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">
                  Точка А · Текущая диагностика
                </p>
                <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
                  {orgName ?? 'Мой дашборд'}
                </h1>
                <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
                  Ваши текущие показатели на основе заполненной анкеты
                </p>
              </div>
              {pointA && (
                <Link href="/client/onboarding"
                  className="flex items-center gap-2 bg-surface-container hover:bg-surface-container-high border border-white/[0.06] hover:border-primary/20 text-on-surface-variant hover:text-primary text-sm px-4 py-2.5 rounded-xl transition-all flex-shrink-0">
                  <span className="material-symbols-outlined text-base">edit_note</span>
                  Обновить анкету
                </Link>
              )}
            </div>

            {pointA ? (
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
                {/* KPI cards */}
                <div className="xl:col-span-2 grid grid-cols-2 gap-3">
                  {[
                    {
                      label: 'Общий балл', value: totalScore.toFixed(0),
                      sub: '/ 100', color: scoreColor(totalScore), icon: 'stars',
                    },
                    {
                      label: 'Health Index', value: healthIndex.toFixed(0),
                      sub: '/ 100', color: scoreColor(healthIndex), icon: 'monitor_heart',
                    },
                    {
                      label: 'Стадия', value: stageLabel(pointA.stage),
                      sub: 'бизнеса', color: '#6effc0', icon: 'trending_up',
                    },
                    {
                      label: 'Финансы', value: (pointA.blocks.finance.score / 10).toFixed(1),
                      sub: '/ 10', color: scoreColor(pointA.blocks.finance.score), icon: 'paid',
                    },
                  ].map(card => (
                    <div key={card.label}
                      className="bg-surface-container-low rounded-2xl p-5 border border-white/[0.04]">
                      <div className="flex items-start justify-between mb-3">
                        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{card.label}</p>
                        <span className="material-symbols-outlined text-base" style={{ color: card.color + '80' }}>{card.icon}</span>
                      </div>
                      <h3 className="text-3xl font-mono font-bold mb-2" style={{ color: card.color }}>{card.value}</h3>
                      <p className="text-[10px] text-on-surface-variant">{card.sub}</p>
                    </div>
                  ))}
                </div>
                {/* Radar */}
                <div className="xl:col-span-3">
                  <PointARadarWidget pointA={pointA} orgName={orgName} />
                </div>
              </div>
            ) : (
              <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-12 text-center">
                <span className="material-symbols-outlined text-5xl text-primary/20 mb-4 block">assignment</span>
                <p className="text-on-surface font-medium mb-2">Анкета ещё не заполнена</p>
                <p className="text-sm text-on-surface-variant mb-6">Заполните анкету, чтобы получить AI-диагностику вашего бизнеса</p>
                <Link href="/client/onboarding"
                  className="inline-flex items-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-sm px-5 py-2.5 rounded-xl transition-all">
                  <span className="material-symbols-outlined text-base">edit_note</span>
                  Заполнить анкету
                </Link>
              </div>
            )}
          </section>

          {/* Quick nav */}
          <section>
            <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Быстрый доступ</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { href: '/point-a', icon: 'analytics', label: 'Точка А', sub: 'AI-диагностика' },
                { href: '/client/onboarding', icon: 'edit_note', label: 'Обновить анкету', sub: 'Изменить ответы' },
                { href: '/metrics', icon: 'bar_chart', label: 'Метрики', sub: 'Финансовые показатели' },
                { href: '/client/onboarding/documents', icon: 'upload_file', label: 'Документы', sub: 'P&L, баланс, отчёты' },
              ].map(item => (
                <Link key={item.href} href={item.href}
                  className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-all group">
                  <span className="material-symbols-outlined text-2xl text-primary/60 group-hover:text-primary transition-colors">{item.icon}</span>
                  <span className="text-xs font-medium text-on-surface text-center">{item.label}</span>
                  <span className="text-[10px] text-on-surface-variant text-center">{item.sub}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )
    }
  }

  const [data, crmRequests, crmClients] = await Promise.all([
    getDashboardExtendedData(),
    prisma.adminRequest.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, status: true, priority: true, createdAt: true,
        company: { select: { name: true } },
      },
    }).catch(() => []),
    prisma.client.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, industry: true, stage: true, status: true },
    }).catch(() => []),
  ])

  const kpi = buildKpi(data)
  const alerts = data?.alerts ?? []
  const griDistRows = buildGriDistRows(data?.griDist ?? { excellent: 0, strong: 0, developing: 0, critical: 0, total: 0 })

  const crmReqMapped: CrmRequest[] = crmRequests.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    priority: r.priority,
    companyName: r.company?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }))

  const crmClientsMapped: CrmClient[] = crmClients.map((c) => ({
    id: c.id,
    name: c.name,
    industry: c.industry,
    stage: c.stage,
    status: c.status,
  }))

  const crmPending = crmRequests.filter(r => r.status === 'new' || r.status === 'in_review').length

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
        <div className="mb-4">
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
                activity={[]}
                gri={[]}
                metrics={[]}
                criticalCount={alerts.filter(a => a.severity === 'critical').length}
              />
          </div>

          <aside className="space-y-6">
              <CrmActivity
                requests={crmReqMapped}
                clients={crmClientsMapped}
                pendingCount={crmPending}
              />

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
