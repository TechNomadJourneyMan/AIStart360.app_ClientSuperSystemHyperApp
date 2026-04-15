export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { PointARadarWidget } from '@/components/dashboard/PointARadarWidget'
import type { PointA, BlockScore } from '@/types/onboarding'

export const metadata: Metadata = { title: 'Дэшборд' }

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
  // /dashboard ALWAYS shows the personal Point A view for the logged-in user.
  // Admin/portfolio aggregates live in the Giga Panel (/admin-giga-panel) only.
  if (user) {
    {
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

  // Unauthenticated fallback (middleware should redirect, but just in case)
  redirect('/login')
}
