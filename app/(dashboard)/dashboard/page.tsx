export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PortfolioGriPanel } from '@/components/dashboard/PortfolioGriPanel'
// Staff-view widgets: loaded only when the staff view is rendered (W4).
import { CrmActivity, DashboardKeyMetrics, GoalsBar, WidgetGrid } from '@/components/dashboard/staff-widgets-lazy'
import { createServerClient } from '@/lib/supabase-server'
import { getRequestUser } from '@/lib/request-user'
import { AlertCard } from '@/components/dashboard/AlertCard'
import type { CrmRequest, CrmClient } from '@/components/dashboard/CrmActivity'
import type { Alert } from '@/types'
import type { AlertCardProps } from '@/components/dashboard/AlertCard'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import GrowthSnapshotHero from '@/components/dashboard/GrowthSnapshotHero'
import { NextBestActionCard } from '@/components/dashboard/NextBestActionCard'
import { FirstRunWizard } from '@/components/dashboard/FirstRunWizard'
import KeyMetricsHero from '@/components/point-a/v2/KeyMetricsHero'
import MetricZonesGrid from '@/components/point-a/v2/MetricZonesGrid'
import CompanyDataCard from '@/components/point-a/v2/CompanyDataCard'
import InsightsFeed from '@/components/point-a/v2/InsightsFeed'
import { completedStepsFromRows } from '@/lib/survey/steps'
import { visibleSectionKeysFor } from '@/lib/platform/sections'
import PointAQuickPills from '@/components/point-a/v2/PointAQuickPills'
import PointAFilterSection from '@/components/point-a/v2/PointAFilterSection'
import PointADashboardSummary from '@/components/dashboard/PointADashboardSummary'
import type { PointA, BlockScore } from '@/types/onboarding'
import { prisma } from '@/lib/db'
import {
  aggregatePortfolioGri,
  griIndexDistribution,
  loadCurrentGriAssessments,
  type GriAssessmentRow,
  type GriIndexDistribution,
} from '@/lib/portfolio-gri'
import { quarterLabel } from '@/lib/format/period'
import { plural } from '@/lib/crm/digest'
import { ShareButton } from '@/components/share/ShareButton'
import { requireServiceRoleKey } from '@/lib/supabase-service'

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

interface DashboardData {
  total:    number
  active:   number
  pending:  number
  /** Profiles created in the last 30 days. */
  new30:    number
  alerts:   Alert[]
  companies: { id: string; name: string }[]
}

// ─── data fetching ────────────────────────────────────────────────────────────
async function getDashboardExtendedData(): Promise<DashboardData | null> {
  try {
    const sb = createServerClient()

    // User counts (count queries: a row list is capped at 1000 by PostgREST).
    // A failed read throws, so the cards say «не удалось загрузить», not 0.
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const profiles = () => sb.from('profiles').select('id', { count: 'exact', head: true })
    const [all, approved, waiting, recent] = await Promise.all([
      profiles(),
      profiles().eq('status', 'approved'),
      profiles().eq('status', 'pending_approval'),
      profiles().gte('created_at', since30),
    ])
    for (const r of [all, approved, waiting, recent]) if (r.error) throw r.error
    const total = all.count ?? 0
    const active = approved.count ?? 0
    const pending = waiting.count ?? 0
    const new30 = recent.count ?? 0

    // Companies
    const { data: companies, error: companiesError } = await sb
      .from('companies')
      .select('id, name')
      .limit(10)
    if (companiesError) throw companiesError

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

    return { total, active, pending, new30, alerts, companies: (companies ?? []) as { id: string; name: string }[] }
  } catch (e) {
    console.error('[Dashboard] data fetch error:', e)
    return null
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
type GriLoad =
  | { ok: true; rows: GriAssessmentRow[] }
  | { ok: false }

/** A CRM read for the staff widgets: a failure is logged and shown, never an empty list. */
type CrmLoad<T> = { ok: true; rows: T[] } | { ok: false }
function crmLoad<T>(what: string, p: Promise<T[]>): Promise<CrmLoad<T>> {
  return p.then<CrmLoad<T>, CrmLoad<T>>(
    (rows) => ({ ok: true, rows }),
    (err) => {
      console.error(`[Dashboard] CRM ${what} read failed:`, err)
      return { ok: false }
    },
  )
}

/** Card «Оценки GRI»: current gri_assessments (one per client), not Point A diagnostics. */
function buildGriCard(gri: GriLoad, dist: GriIndexDistribution | null): KpiCardData {
  if (!gri.ok || !dist) {
    return { label: 'Оценки GRI', value: '—', trend: '—', trendUp: false, icon: 'radar', sublabel: 'не удалось загрузить', href: '/gri' }
  }
  return {
    label:    'Оценки GRI',
    value:    String(dist.total),
    trend:    dist.excellent > 0 ? `${dist.excellent} с индексом 8+` : '—',
    trendUp:  dist.excellent > 0,
    icon:     'radar',
    sublabel: dist.excellent > 0 ? 'среди текущих оценок' : 'текущие оценки клиентов',
    href:     '/gri',
  }
}

function buildKpi(data: DashboardData | null, griCard: KpiCardData): KpiCardData[] {
  if (!data) {
    return [
      { label: 'Пользователи', value: '—',  trend: '—',    trendUp: true,  icon: 'groups',       sublabel: 'не удалось загрузить', href: '/admin-giga-panel/users'   },
      { label: 'Активных',  value: '—',  trend: '—',    trendUp: true,  icon: 'check_circle', sublabel: 'не удалось загрузить', href: '/admin-giga-panel/users'   },
      { label: 'Заявки',    value: '—',  trend: '—',    trendUp: false, icon: 'hourglass_top',sublabel: 'не удалось загрузить', href: '/admin-giga-panel/requests' },
      griCard,
    ]
  }
  const activePct = data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
  return [
    {
      label:    'Пользователи',
      value:    String(data.total),
      trend:    `+${data.new30} за 30 дн.`,
      trendUp:  data.new30 > 0,
      icon:     'groups',
      sublabel: 'в системе',
      href:     '/admin-giga-panel/users',
    },
    {
      label:    'Активных',
      value:    String(data.active),
      trend:    `${activePct}%`,
      trendUp:  data.active > 0,
      icon:     'check_circle',
      sublabel: 'статус active',
      href:     '/admin-giga-panel/users',
    },
    {
      label:    'Заявки',
      value:    String(data.pending),
      trend:    data.pending > 0 ? 'нужна проверка' : 'нет новых',
      trendUp:  data.pending === 0,
      icon:     'hourglass_top',
      sublabel: 'на регистрацию',
      href:     '/admin-giga-panel/requests',
    },
    griCard,
  ]
}

/** gri_index bands of the current assessments (GIGA panel bands). */
function buildGriDistRows(dist: GriIndexDistribution) {
  const { excellent, strong, developing, critical, total } = dist
  const p = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  return [
    { label: 'Отлично (8–10)',       pct: p(excellent),  color: 'bg-primary' },
    { label: 'Сильный уровень (6–8)', pct: p(strong),     color: 'bg-primary-fixed-dim' },
    { label: 'Развивается (4–6)',    pct: p(developing), color: 'bg-tertiary-container' },
    { label: 'Критично (0–4)',       pct: p(critical),   color: 'bg-error' },
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


// Client view data (service-role REST — RLS on profiles recurses). Never
// rejects: a failed read leaves the defaults, as before.
async function loadClientDashboardData(userId: string): Promise<{
  diag: Record<string, unknown> | null
  orgName: string | undefined
  companyId: string | null
  surveyStepsDone: number
  docsCount: number
}> {
  // Fetch latest diagnostic via REST API to avoid RLS issues
  let diag: Record<string, unknown> | null = null
  let orgName: string | undefined = undefined
  let companyId: string | null = null
  // First-run wizard signals (ON-1): survey progress + document count.
  let surveyStepsDone = 0
  let docsCount = 0
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = requireServiceRoleKey()
    const authHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    const [diagRes, companyRes, surveyRes, docsRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${userId}&order=calculated_at.desc&limit=1`,
        { headers: authHeaders, cache: 'no-store' }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/companies?user_id=eq.${userId}&select=id,name&limit=1`,
        { headers: authHeaders, cache: 'no-store' }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${userId}&select=step,question_key,answer`,
        { headers: authHeaders, cache: 'no-store' }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/documents?user_id=eq.${userId}&select=id`,
        { headers: authHeaders, cache: 'no-store' }
      ),
    ])
    if (diagRes.ok) {
      const diagRows = await diagRes.json() as Record<string, unknown>[]
      diag = diagRows?.[0] ?? null
    }
    if (companyRes.ok) {
      const companyRows = await companyRes.json() as Array<{ id: string; name: string }>
      orgName = companyRows?.[0]?.name ?? undefined
      companyId = companyRows?.[0]?.id ? String(companyRows[0].id) : null
    }
    if (surveyRes.ok) {
      const rows = await surveyRes.json() as Array<{ step: number; question_key: string; answer: unknown }>
      surveyStepsDone = completedStepsFromRows(rows).length
    }
    if (docsRes.ok) {
      const rows = await docsRes.json() as Array<{ id: string }>
      docsCount = Array.isArray(rows) ? rows.length : 0
    }
  } catch {
    // diagnostics not available yet
  }
  return { diag, orgName, companyId, surveyStepsDone, docsCount }
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  // Detect viewer role — clients get their personal Point A view.
  // Same verified getUser() as the cabinet layout, memoised per request.
  const user = await getRequestUser()
  // Middleware already requires a session here; without one, never fall
  // through to the platform-wide staff view.
  if (!user) redirect('/login')
  if (user) {
    // Clients are the common case: their own data is read together with the
    // role lookup instead of after it (one round trip less). Staff never see
    // it — the promise is simply not awaited (it cannot reject).
    const clientDataP = loadClientDashboardData(user.id)
    // Read role via service-role REST API to bypass RLS (profiles table has RLS recursion issue)
    let role: string | null = null
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const serviceKey = requireServiceRoleKey()
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
    // A legacy profiles.role 'admin' without a staff_roles row has no panel
    // access (migration 099, owner decision): no platform-wide view either.
    if (role === 'admin') {
      let hasStaffRole = false
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const serviceKey = requireServiceRoleKey()
        const staffRes = await fetch(
          `${supabaseUrl}/rest/v1/staff_roles?user_id=eq.${user.id}&select=role`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store' }
        )
        hasStaffRole = staffRes.ok && ((await staffRes.json()) as unknown[]).length > 0
      } catch {
        hasStaffRole = false
      }
      if (!hasStaffRole) role = 'client'
    }
    // Show client view for: explicit 'client' role, OR unknown role (safety fallback)
    // Only admin/super_admin/expert/manager see the admin dashboard
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'expert' || role === 'manager'
    if (!isAdmin) {
      const { diag, orgName, companyId, surveyStepsDone, docsCount } = await clientDataP

      const pointA = diag ? diagToPointA(diag as Record<string, unknown>) : null

      // Sections switched off in GIGA-CRM disappear from the cabinet entirely:
      // their blocks and shortcuts are not rendered, not just unreachable.
      const visibleKeys = await visibleSectionKeysFor(user.id)
      const shortcuts = [
        { href: '/point-a', section: 'point_a', icon: 'analytics', label: 'Точка А', sub: 'AI-диагностика' },
        { href: '/client/onboarding', section: null, icon: 'edit_note', label: 'Обновить анкету', sub: 'Изменить ответы' },
        { href: '/metrics', section: 'metrics', icon: 'bar_chart', label: 'Метрики', sub: 'Финансовые показатели' },
        { href: '/client/onboarding/documents', section: 'documents', icon: 'upload_file', label: 'Документы', sub: 'P&L, баланс, отчёты' },
      ].filter((i) => !i.section || visibleKeys.has(i.section))

      return (
        <div className="space-y-6 relative pb-24">
          {/* Sticky bottom pill bar — scroll-spy across the page sections */}
          <PointAQuickPills visibleSections={Array.from(visibleKeys)} />

          {/* «1 действие сейчас» (Фаза 5, №2) — единый приоритетный next-step. */}
          <NextBestActionCard />

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
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                {pointA && companyId && (
                  <ShareButton type="point_a" companyId={companyId} />
                )}
                <OnboardingStatusBadges />
              </div>
            </div>

            {/* Point A v4 — the important data (plan 2026-10-22, W1): score,
                confidence, completeness, key metrics, «Требует внимания»,
                risks / quick wins / strengths and the ONE goals block (synced
                with the questionnaire). Replaces the v1 ExecutiveOverview. */}
            <PointADashboardSummary className="mb-6" />

            {/* «AI · Карта роста» (shows the synced goals) + the GRI next step.
                The snapshot column is not repeated: the goals are above. */}
            <GrowthSnapshotHero visibleSections={Array.from(visibleKeys)} hideSnapshot />

            {pointA || (surveyStepsDone === 0 && docsCount === 0) ? (
              /* Inline AIInsightsCarousel removed — InsightsFeed below owns the
                 unified AI / Эксперт / Клиент Q&A stream. With nothing filled
                 yet the overview above already shows the same 3-step start
                 (survey → documents → GRI), so the wizard is not repeated. */
              null
            ) : (
              /* First-run wizard (ON-1): consolidated 3-step path to the GRI
                 with real per-step completion, instead of a flat prompt. */
              <FirstRunWizard
                surveyStepsDone={surveyStepsDone}
                docsCount={docsCount}
                hasDiagnostic={false}
              />
            )}
          </section>

          {/* The v1 risks / quick wins (diagnostics row) are not shown any more:
              Point A v4 risks and quick wins are in the block above. */}

          {/* Metrics blocks belong to the «Метрики» section: hidden there —
              hidden here, together with the filters that drive them. */}
          {visibleKeys.has('metrics') && (
            <>
              {/* Filters drive the KeyMetricsHero report below via URL params */}
              <PointAFilterSection />

              {/* Key metrics hero — 6 главных KPI + бейджи зон */}
              <section id="key-metrics" aria-label="Ключевые метрики">
                <KeyMetricsHero />
              </section>

              {/* 3-column zones grid */}
              <section id="metric-zones" aria-label="Метрики по зонам">
                <MetricZonesGrid />
              </section>
            </>
          )}

          {/* Company anketa — full-width row, all 7 blocks expanded inline */}
          <section id="company-data" aria-label="Данные компании">
            {/* Streams in on its own: the rest of the page does not wait for
                the card's survey/company reads. */}
            <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface-container-low" aria-busy="true" aria-label="Загрузка данных компании" />}>
              <CompanyDataCard userId={user.id} />
            </Suspense>
          </section>

          {/* Insights mega-block — AI / Эксперт / Клиент Q&A feed */}
          <section id="insights" aria-label="Уточняющие вопросы">
            <InsightsFeed />
          </section>

          {/* Quick nav — only the sections that are switched on */}
          {shortcuts.length > 0 && (
          <section>
            <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Быстрый доступ</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {shortcuts.map(item => (
                <Link key={item.href} href={item.href}
                  className="flex flex-col items-center gap-2 bg-surface-container-low hover:bg-surface-container rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-all group">
                  <span className="material-symbols-outlined text-2xl text-primary/60 group-hover:text-primary transition-colors">{item.icon}</span>
                  <span className="text-xs font-medium text-on-surface text-center">{item.label}</span>
                  <span className="text-[10px] text-on-surface-variant text-center">{item.sub}</span>
                </Link>
              ))}
            </div>
          </section>
          )}
        </div>
      )
    }
  }

  // GRI: the clients' current GRI assessments, read once for the card, the
  // portfolio radar and the band distribution. A failed read is shown as such.
  const [data, crmRequestsLoad, crmClientsLoad, gri] = await Promise.all([
    getDashboardExtendedData(),
    crmLoad('requests', prisma.adminRequest.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, status: true, priority: true, createdAt: true,
        company: { select: { name: true } },
      },
    })),
    crmLoad('clients', prisma.client.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, industry: true, stage: true, status: true },
    })),
    loadCurrentGriAssessments().then<GriLoad, GriLoad>(
      (rows) => ({ ok: true, rows }),
      (err) => {
        console.error('[Dashboard] GRI assessments read failed:', err)
        return { ok: false }
      },
    ),
  ])
  const griDist = gri.ok ? griIndexDistribution(gri.rows) : null
  const portfolioGRI = gri.ok ? aggregatePortfolioGri(gri.rows) : null

  const kpi = buildKpi(data, buildGriCard(gri, griDist))
  const alerts = data?.alerts ?? []
  const griDistRows = griDist ? buildGriDistRows(griDist) : []

  // Either CRM read failing makes the widget say so (no "Нет заявок", no 0 pending).
  const crmFailed = !crmRequestsLoad.ok || !crmClientsLoad.ok
  const crmRequests = crmRequestsLoad.ok ? crmRequestsLoad.rows : []
  const crmClients = crmClientsLoad.ok ? crmClientsLoad.rows : []

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

  // CRM activity and pending alerts only for manager/analyst/admin roles (not super_admin/owner)
  const cookieStore = await cookies()
  const staffRole = cookieStore.get('aistart360_role')?.value ?? null
  const showCrmWidgets = staffRole === 'admin' || staffRole === 'manager' || staffRole === 'analyst'

  const periodLabel = quarterLabel(new Date())

  return (
    <div className="space-y-6">
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-4">
          <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em] mb-2">
            {periodLabel} · Текущий период
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface leading-tight">
            Обзор платформы
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
            Пользователи, заявки и оценки GRI клиентов платформы
          </p>
        </div>

        {/* Goals bar */}
        <div className="mb-5">
           <GoalsBar />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
             {/* Left: the main metrics of the viewer's company (platform counters below them) */}
             <div className="xl:col-span-2">
                 <DashboardKeyMetrics platform={kpi} />
             </div>

             {/* Right: portfolio GRI from the clients' current GRI assessments */}
             <div className="xl:col-span-3">
                 <PortfolioGriPanel data={portfolioGRI} failed={!gri.ok} />
             </div>
        </div>
      </section>

      {/* ─── Main Content ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-headline text-lg font-bold text-on-surface">Критические сигналы</h2>
                  {showCrmWidgets && data && (
                    <span className="px-2 py-0.5 rounded-full bg-error/10 border border-error/20 text-[10px] font-mono text-error">
                      критических: {alerts.filter(a => a.severity === 'critical').length}
                    </span>
                  )}
                </div>
                {showCrmWidgets && alerts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {alerts.map(alert => (
                      <AlertCard key={alert.id} {...alert} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-8 text-center">
                    <span className="material-symbols-outlined text-4xl text-primary/20 mb-2">
                      {showCrmWidgets && !data ? 'error' : showCrmWidgets ? 'check_circle' : 'lock'}
                    </span>
                    <p className="text-sm text-on-surface-variant">
                      {!showCrmWidgets
                        ? 'Сигналы показываются менеджерам и аналитикам'
                        : !data
                          ? 'Сигналы не удалось загрузить'
                          : 'Сигналов нет'}
                    </p>
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
              {showCrmWidgets && crmFailed && (
                <div className="bg-surface-container-low border border-error/20 rounded-2xl p-5" role="alert">
                  <p className="text-sm font-medium text-on-surface">Активность CRM</p>
                  <p className="mt-1 text-xs text-error">Не удалось загрузить заявки и клиентов CRM — список и число ожидающих заявок неизвестны. Обновите страницу.</p>
                  <Link href="/admin-giga-panel/requests" className="mt-2 inline-block text-[11px] font-mono text-primary hover:underline">Открыть заявки</Link>
                </div>
              )}
              {showCrmWidgets && !crmFailed && (
                <CrmActivity
                  requests={crmReqMapped}
                  clients={crmClientsMapped}
                  pendingCount={crmPending}
                />
              )}

              {/* Portfolio health — gri_index bands of the current GRI assessments */}
              <div className="bg-surface-container-low border border-white/[0.04] rounded-2xl p-5">
                  <h3 className="font-bold text-on-surface mb-1 uppercase tracking-widest text-[10px]">Здоровье портфеля · GRI</h3>
                  <p className="text-[10px] text-on-surface-variant mb-4">
                    {!griDist
                      ? 'Не удалось загрузить оценки GRI'
                      : griDist.total > 0
                        ? `Индекс GRI по ${griDist.total} ${plural(griDist.total, 'актуальной оценке', 'актуальным оценкам', 'актуальным оценкам')} клиентов`
                        : 'Оценок GRI пока нет'}
                  </p>
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
