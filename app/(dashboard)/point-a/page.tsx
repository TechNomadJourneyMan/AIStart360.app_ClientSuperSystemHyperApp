export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings/store'
import PointAV4Page from '@/components/point-a-v4/PointAV4Page'
import { FileArea } from '@/components/point-a/FileArea'
import PointAQuickToolbar from '@/components/point-a/PointAQuickToolbar'
import { SurveyOverview } from '@/components/point-a/SurveyOverview'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import GrowthSnapshotHero from '@/components/dashboard/GrowthSnapshotHero'
import KeyMetricsHero from '@/components/point-a/v2/KeyMetricsHero'
import MetricZonesGrid from '@/components/point-a/v2/MetricZonesGrid'
import CompanyDataCard from '@/components/point-a/v2/CompanyDataCard'
import InsightsFeed from '@/components/point-a/v2/InsightsFeed'
import PointAQuickPills from '@/components/point-a/v2/PointAQuickPills'
import PointAFilterSection from '@/components/point-a/v2/PointAFilterSection'
import ExecutiveOverview from '@/components/point-a/ExecutiveOverview'
import PublishedReports from '@/components/reports/PublishedReports'
import { ShareButton } from '@/components/share/ShareButton'
import { completedStepsFromRows } from '@/lib/survey/steps'
import { visibleSectionKeysFor } from '@/lib/platform/sections'
import { requireServiceRoleKey } from '@/lib/supabase-service'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default async function PointAPage() {
  // One Point A (spec 2026-10-12 §4): with point_a_v4 on (default) this is the
  // new page, inside the cabinet's own layout (staff keep their navigation).
  if (await getSetting('point_a_v4').catch(() => true)) return <PointAV4Page />
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

  const clientId = supabaseUserId

  // Fetch data from Supabase REST API (bypasses RLS). The overall score, its
  // date and the documents count live in <ExecutiveOverview/> (level 1) —
  // this page only loads what the level-2 sections below need.
  const surveyAnswers: Record<string, unknown> = {}
  const surveyCompletedSteps: number[] = []
  let companyId: string | null = null

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = requireServiceRoleKey()
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

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

  // Sections switched off in GIGA-CRM must not render their blocks here either.
  const visibleKeys = Array.from(await visibleSectionKeysFor(clientId))

  return (
    <div className="space-y-8 relative pb-24">
      {/* Sticky quick-action toolbar — file upload, survey, documents, recalc */}
      <PointAQuickToolbar userId={clientId} />

      {/* Sticky bottom pill bar — scroll-spy across the page sections */}
      <PointAQuickPills visibleSections={visibleKeys} />

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

      {/* Level 1 — Executive overview: score, maturity, status, completeness,
          problem zones, risks, gaps, strengths, freshness, sources. */}
      <ExecutiveOverview userId={clientId} />

      {/* The published report (frozen snapshot with provenance + PDF). Only
          versions a specialist published are shown. */}
      <PublishedReports />

      {/* Level 2 — details below. */}

      {/* Growth Snapshot Hero — Точка А snapshot + AI carta rosta + GRI CTA */}
      <section id="growth-snapshot">
        <GrowthSnapshotHero visibleSections={visibleKeys} />
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

      {/* GRI Assessment — moved into the popup opened via «Открыть GRI» in GrowthSnapshotHero */}

      {/* Insights mega-block — AI / Эксперт / Клиент Q&A feed (replaces AIInsightsCarousel) */}
      <section id="insights" aria-label="Уточняющие вопросы">
        <InsightsFeed />
      </section>

      {/* Interactive File Area */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
        <FileArea userId={clientId ?? ''} />
      </section>
    </div>
  )
}
