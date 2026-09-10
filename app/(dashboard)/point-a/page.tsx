export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FileArea } from '@/components/point-a/FileArea'
import PointAQuickToolbar from '@/components/point-a/PointAQuickToolbar'
import { SurveyOverview } from '@/components/point-a/SurveyOverview'
import PointAIntelligenceSection from '@/components/point-a/PointAIntelligenceSection'
import PointADashboardSectionsBoundary from '@/components/dashboard/PointADashboardSections'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import GrowthSnapshotHero from '@/components/dashboard/GrowthSnapshotHero'
import KeyMetricsHero from '@/components/point-a/v2/KeyMetricsHero'
import MetricZonesGrid from '@/components/point-a/v2/MetricZonesGrid'
import CompanyDataCard from '@/components/point-a/v2/CompanyDataCard'
import MarketAnalysisCard from '@/components/point-a/v2/MarketAnalysisCard'
import InsightsFeed from '@/components/point-a/v2/InsightsFeed'
import PointAQuickPills from '@/components/point-a/v2/PointAQuickPills'
import PointAFilterSection from '@/components/point-a/v2/PointAFilterSection'
import { ShareButton } from '@/components/share/ShareButton'
import { completedStepsFromRows } from '@/lib/survey/steps'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage() {
  const session = await auth()

  // Identity comes from the Supabase session only. The old forgeable
  // `aistart360_user_id` / `aistart360_role` cookies are NOT consulted — they
  // let a signed-in user load another user's data (IDOR). Audit 2026-07-02.
  let supabaseUserId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user: sbUser } } = await supabase.auth.getUser()
    supabaseUserId = sbUser?.id ?? null
  } catch {
    // Supabase auth not available
  }

  let clientId = supabaseUserId ?? session?.user?.id ?? null

  // Fetch data from Supabase REST API (bypasses RLS)
  let docsCount = 0
  let avgScore = 0
  let domainScores: Array<{ id: string; label: string; score: number; max: number; icon: string }> = []
  let latestReports: Array<{ id: string; score: number; calculatedAt: string; clientName: string }> = []
  const surveyAnswers: Record<string, unknown> = {}
  const surveyCompletedSteps: number[] = []
  let companyId: string | null = null

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    // Count user's uploaded documents
    if (clientId) {
      const docsRes = await fetch(
        `${supabaseUrl}/rest/v1/documents?user_id=eq.${clientId}&select=id`,
        { headers, cache: 'no-store' }
      )
      if (docsRes.ok) {
        const docs = await docsRes.json()
        docsCount = Array.isArray(docs) ? docs.length : 0
      }
    }

    // Get user's latest diagnostic. Keyed by the SUPABASE user (clientId):
    // it used to require a NextAuth session, which Supabase-authenticated
    // clients never have, so «Диагностика по блокам» stayed hidden and the
    // page said «Нет данных диагностики» even after a recalculation.
    if (clientId) {
      const diagRes = await fetch(
        `${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${clientId}&order=calculated_at.desc&limit=1`,
        { headers, cache: 'no-store' }
      )
      if (diagRes.ok) {
        const diags = await diagRes.json()
        const diag = diags[0]
        if (diag) {
          avgScore = diag.overall_score ?? 0

          const blocks: Record<string, { label: string; icon: string }> = {
            finance: { label: 'Финансы', icon: 'payments' },
            sales: { label: 'Продажи', icon: 'trending_up' },
            operations: { label: 'Операции', icon: 'settings' },
            marketing: { label: 'Маркетинг', icon: 'campaign' },
            strategy: { label: 'Стратегия', icon: 'flag' },
          }

          domainScores = Object.entries(blocks).map(([key, meta]) => {
            const blockData = diag[`${key}_score`]
            const score = typeof blockData === 'object' && blockData !== null
              ? (blockData as { score?: number }).score ?? 0
              : 0
            return { id: key, label: meta.label, score, max: 100, icon: meta.icon }
          })

          latestReports = [{
            id: diag.id,
            score: diag.overall_score ?? 0,
            calculatedAt: diag.calculated_at ?? diag.created_at,
            clientName: session?.user?.email ?? 'Клиент',
          }]
        }
      }
    }
    // Fetch first company for this user (for Point A intelligence aggregator)
    if (clientId) {
      const companyRes = await fetch(
        `${supabaseUrl}/rest/v1/companies?user_id=eq.${clientId}&select=id&limit=1`,
        { headers, cache: 'no-store' }
      )
      if (companyRes.ok) {
        const companies = await companyRes.json()
        if (Array.isArray(companies) && companies[0]?.id) {
          companyId = String(companies[0].id)
        }
      }
    }
    // Fetch survey answers for this user
    if (clientId) {
      const surveyRes = await fetch(
        `${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${clientId}&order=step.asc`,
        { headers, cache: 'no-store' }
      )
      if (surveyRes.ok) {
        const rows = await surveyRes.json()
        if (Array.isArray(rows)) {
          for (const row of rows) {
            surveyAnswers[row.question_key] = row.answer?.value ?? row.answer
          }
          // Same rule as every other page: key-derived step, empty answers and
          // staff/widget rows don't count (this page used to count both).
          surveyCompletedSteps.push(...completedStepsFromRows(rows))
        }
      }
    }
  } catch (err) {
    console.error('[point-a] Data fetch error:', err)
  }

  return (
    <div className="space-y-8 relative pb-24">
      {/* Sticky quick-action toolbar — file upload, survey, documents, recalc */}
      <PointAQuickToolbar userId={clientId} />

      {/* Sticky bottom pill bar — scroll-spy across the page sections */}
      <PointAQuickPills />

      {/* Header */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
              AI Диагностика · Текущее состояние
            </p>
            <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
              Точка <span className="text-gradient">А</span>
            </h1>
            <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
              Объективная оценка текущего состояния бизнеса.
              Загрузите документы для автоматического анализа ИИ-агентом.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {companyId && <ShareButton type="point_a" companyId={companyId} />}
            <OnboardingStatusBadges />
          </div>
        </div>
      </section>

      {/* Growth Snapshot Hero — Точка А snapshot + AI carta rosta + GRI CTA */}
      <section id="growth-snapshot">
        <GrowthSnapshotHero />
      </section>

      {/* Filters — drive the KeyMetricsHero report below via URL params */}
      <PointAFilterSection />

      {/* Key metrics hero — 6 главных KPI + бейджи зон (replaces «Топ-таблица») */}
      <section id="key-metrics" aria-label="Ключевые метрики">
        <KeyMetricsHero />
      </section>

      {/* 3-column zones grid — Красная / Жёлтая / Зелёная (replaces «6 блоков») */}
      <section id="metric-zones" aria-label="Метрики по зонам">
        <MetricZonesGrid />
      </section>

      {/* Company anketa — full-width row, all 7 blocks expanded inline */}
      {clientId && (
        <section id="company-data" aria-label="Данные компании">
          <CompanyDataCard userId={clientId} />
        </section>
      )}

      {/* Market analysis — full-width row, big tiles + Гига Рынок CTA */}
      {clientId && (
        <section id="market-analysis" aria-label="Анализ рынка">
          <MarketAnalysisCard userId={clientId} />
        </section>
      )}

      {/* Spec-driven sections — keeps Filters + Retention + RFM + Loss Map.
          (Top Sales table is sr-only inside; 6-blocks list removed — both
          replaced above.) */}
      <section id="loss-map">
        <PointADashboardSectionsBoundary />
      </section>

      {/* Survey Data */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-4">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Данные анкеты</h2>
            <p className="text-xs text-on-surface-variant mt-1">Информация из бизнес-анкеты для AI-диагностики</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {companyId && Object.keys(surveyAnswers).length > 0 && (
              <ShareButton type="survey" companyId={companyId} />
            )}
            {Object.keys(surveyAnswers).length > 0 && (
              <a href="/client/onboarding" className="text-xs text-primary/70 hover:text-primary transition-colors font-mono flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">edit</span>
                Редактировать
              </a>
            )}
          </div>
        </div>
        <SurveyOverview answers={surveyAnswers} completedSteps={surveyCompletedSteps} />
      </section>

      {/* Domain Diagnostics */}
      {domainScores.length > 0 && (
        <section>
          <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
            <div>
              <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика по блокам</h2>
              <p className="text-xs text-on-surface-variant mt-1">Текущий уровень по каждому направлению</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {domainScores.map((domain) => {
              const pct = (domain.score / domain.max) * 100
              const isStrong = pct >= 70
              const isCritical = pct < 50
              return (
                <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-5 transition-all group hover:scale-[1.01]">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.04]">
                      <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${
                      isCritical ? 'text-error border-error/20 bg-error/5' :
                      isStrong ? 'text-primary border-primary/20 bg-primary/5' :
                      'text-tertiary-container border-tertiary-container/20 bg-tertiary-container/5'
                    }`}>
                      {isCritical ? 'Критично' : isStrong ? 'Сильно' : 'Средне'}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-on-surface mb-3">{domain.label}</h3>
                  <div className="flex items-end justify-between mb-2">
                    <span className="text-3xl font-mono font-bold text-on-surface">{domain.score}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-widest">/ {domain.max}</span>
                  </div>
                  <div className="h-1.5 bg-surface-container rounded-full overflow-hidden border border-white/[0.02]">
                    <div className={`h-full rounded-full transition-all duration-1000 ${
                      isCritical ? 'bg-error' : isStrong ? 'bg-primary' : 'bg-tertiary-container'
                    }`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* GRI Assessment — moved into the popup opened via «Открыть GRI» in GrowthSnapshotHero */}

      {/* Insights mega-block — AI / Эксперт / Клиент Q&A feed (replaces AIInsightsCarousel) */}
      <section id="insights" aria-label="Уточняющие вопросы">
        <InsightsFeed />
      </section>

      {/* Phase 6 final — Real-time intelligence layer (live resolver + realtime sync) */}
      {clientId && (
        <PointAIntelligenceSection userId={clientId} companyId={companyId} />
      )}

      {/* Interactive File Area */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
        <FileArea userId={clientId ?? ''} />
      </section>

      {/* Latest reports */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Последние расчёты</h2>
        <div className="grid grid-cols-1 gap-3">
          {latestReports.map((report) => (
            <div key={report.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold border ${report.score >= 50 ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-error/10 border-error/20 text-error'}`}>
                  {report.score}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface">{report.clientName}</h3>
                  <p className="text-xs text-on-surface-variant font-mono">
                    {new Date(report.calculatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {latestReports.length === 0 && (
            <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-4 block">insert_chart</span>
              <p className="text-sm text-on-surface-variant font-medium">Нет данных диагностики</p>
              <p className="text-xs text-on-surface-variant/60 mt-1">Заполните анкету для расчёта Точки А</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
