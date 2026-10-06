'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase-client'
import type { Diagnostic, BlockScore, Risk, Insight, QuickWin, AIAnalysis, AIStatus } from '@/types/onboarding'
import { loadClientPointA } from '@/components/point-a/client-point-a-load'
import PointAIntelligenceSection from '@/components/point-a/PointAIntelligenceSection'
import PointADashboardSectionsBoundary from '@/components/dashboard/PointADashboardSections'
import GrowthSnapshotHero from '@/components/dashboard/GrowthSnapshotHero'
import MyDataSection from '@/components/client/MyDataSection'
import AssistantHintWidget from '@/components/assistant/AssistantHintWidget'
import { ShareButton } from '@/components/share/ShareButton'
import NextBestActionCard from '@/components/nba/NextBestActionCard'
import ExecutiveOverview from '@/components/point-a/ExecutiveOverview'
import { POINT_A_OVERVIEW_QUERY_KEY, recalcErrorMessage } from '@/hooks/usePointAOverview'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function blockLabel(status: string | undefined): { text: string; color: string } {
  const m: Record<string, { text: string; color: string }> = {
    critical:  { text: 'Критично',  color: 'text-error' },
    weak:      { text: 'Слабо',     color: 'text-orange-400' },
    average:   { text: 'Средне',    color: 'text-amber-400' },
    strong:    { text: 'Сильно',    color: 'text-primary' },
    excellent: { text: 'Отлично',   color: 'text-emerald-400' },
  }
  return m[status ?? ''] ?? { text: '—', color: 'text-on-surface-variant' }
}

function riskIcon(level: string): { icon: string; color: string; bg: string } {
  if (level === 'critical') return { icon: 'error', color: 'text-error', bg: 'bg-error/10' }
  if (level === 'important') return { icon: 'warning', color: 'text-amber-400', bg: 'bg-amber-400/10' }
  return { icon: 'info', color: 'text-on-surface-variant', bg: 'bg-surface-container' }
}

function BlockCard({ title, icon, score, aiBlock }: {
  title: string; icon: string; score: BlockScore | null
  aiBlock?: { diagnosis: string; benchmark_comparison: string; key_risk: string; top_recommendation: string }
}) {
  const [open, setOpen] = useState(false)
  const pct = score?.score ?? 0
  const lbl = blockLabel(score?.status)

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5 transition-all hover:border-primary/20">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm text-primary">{icon}</span>
          </div>
          <span className="text-sm font-medium text-on-surface">{title}</span>
        </div>
        <span className={`text-xs font-mono font-bold ${lbl.color}`}>
          {(pct / 10).toFixed(1)}/10
        </span>
      </div>

      <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${pct}%`,
            background: pct >= 70 ? 'linear-gradient(90deg, #6EFFC0, #00e29e)' : pct >= 45 ? '#FBBF24' : '#EF4444'
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs font-mono ${lbl.color}`}>{lbl.text}</span>
        {((score?.top_issues?.length ?? 0) > 0 || aiBlock) && (
          <button onClick={() => setOpen(v => !v)} className="text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
            {open ? 'Свернуть' : 'Подробнее'}
            <span className="material-symbols-outlined text-xs">{open ? 'expand_less' : 'expand_more'}</span>
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
          {/* AI analysis (if available) */}
          {aiBlock && (
            <div className="bg-violet-500/5 rounded-xl border border-violet-500/10 p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-xs text-violet-400">smart_toy</span>
                <span className="text-[10px] font-mono text-violet-400 uppercase tracking-widest">AI-анализ</span>
              </div>
              <p className="text-xs text-on-surface leading-relaxed">{aiBlock.diagnosis}</p>
              <div className="grid grid-cols-1 gap-2 mt-2">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-blue-400 mt-0.5 flex-shrink-0">bar_chart</span>
                  <p className="text-xs text-on-surface-variant"><span className="text-blue-400 font-medium">Бенчмарк:</span> {aiBlock.benchmark_comparison}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-error mt-0.5 flex-shrink-0">warning</span>
                  <p className="text-xs text-on-surface-variant"><span className="text-error font-medium">Риск:</span> {aiBlock.key_risk}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">lightbulb</span>
                  <p className="text-xs text-on-surface-variant"><span className="text-primary font-medium">Рекомендация:</span> {aiBlock.top_recommendation}</p>
                </div>
              </div>
            </div>
          )}

          {/* Rule-based issues */}
          {score && score.top_issues.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Проблемы</p>
              <ul className="space-y-1">
                {score.top_issues.map((iss, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-xs text-error mt-0.5 flex-shrink-0">close</span>
                    {iss}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score && score.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Рекомендации</p>
              <ul className="space-y-1">
                {score.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">arrow_forward</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PointAClientPage() {
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<{ name: string; industry: string | null; employee_count: number | null } | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // A failed diagnostic load is shown as such — not as "no diagnostic yet".
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [recalcError, setRecalcError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  // 'checking' until the Supabase session is read. Without a session the page
  // used to spin forever (loadData bailed out before clearing isLoading).
  const [sessionState, setSessionState] = useState<'checking' | 'signed_in' | 'signed_out'>('checking')
  const queryClient = useQueryClient()
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null)
  const [aiStatus, setAiStatus] = useState<AIStatus>('none')

  useEffect(() => {
    const sb = createClient()
    sb.auth
      .getSession()
      .then(({ data }) => {
        const u = data.session?.user
        if (u?.id) {
          setUserId(u.id)
          setSessionState('signed_in')
        } else {
          setSessionState('signed_out')
          setIsLoading(false)
        }
      })
      .catch(() => {
        setSessionState('signed_out')
        setIsLoading(false)
      })
  }, [])

  const loadData = useCallback(async () => {
    if (!userId) return
    setIsLoading(true)
    const r = await loadClientPointA(userId)
    if (r.company) {
      setCompany(r.company)
      if (r.company.id) setCompanyId(String(r.company.id))
    }
    if (r.ok) {
      setLoadError(null)
      setDiag(r.diagnostic)
      setAiStatus(r.diagnostic?.ai_status ?? 'none')
      setAiAnalysis(r.diagnostic?.ai_analysis ?? null)
      if (r.diagnostic?.company_id) setCompanyId(String(r.diagnostic.company_id))
    } else {
      setLoadError(r.error)
    }
    setIsLoading(false)
  }, [userId])

  useEffect(() => {
    if (userId) loadData()
  }, [userId, loadData])

  // Poll for AI status when processing
  useEffect(() => {
    if (aiStatus !== 'processing' || !diag?.id) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/diagnostics/ai-status?diagnostic_id=${diag.id}`)
        const data = await res.json()
        if (data.ok) {
          setAiStatus(data.data.ai_status)
          if (data.data.ai_analysis) {
            setAiAnalysis(data.data.ai_analysis)
          }
          if (data.data.ai_status === 'completed' || data.data.ai_status === 'failed') {
            clearInterval(interval)
          }
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [aiStatus, diag?.id])

  const recalculate = async () => {
    if (!userId) return
    setIsRecalculating(true)
    setRecalcError(null)
    try {
      const res = await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!res.ok) {
        // 422 «нет ответов», 429 rate limit… — keep the current analysis.
        setRecalcError(recalcErrorMessage(res.status))
      } else {
        setAiAnalysis(null)
        setAiStatus('none')
        await queryClient.invalidateQueries({ queryKey: POINT_A_OVERVIEW_QUERY_KEY })
        await loadData()
      }
    } catch {
      setRecalcError(recalcErrorMessage(0))
    }
    setIsRecalculating(false)
  }

  const retryAi = async () => {
    if (!diag?.id) return
    setAiStatus('processing')
    setAiAnalysis(null)
    try {
      await fetch('/api/v1/diagnostics/retry-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnostic_id: diag.id }),
      })
    } catch {}
  }

  // Date of the diagnostic itself — not «today» (the chip used to read as the
  // report date while showing the current day).
  const calculatedAtLabel = diag?.calculated_at
    ? new Date(diag.calculated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  const blocks = [
    { key: 'finance',    title: 'Финансы',    icon: 'payments',   data: diag?.finance_score },
    { key: 'sales',      title: 'Продажи',    icon: 'trending_up', data: diag?.sales_score },
    { key: 'operations', title: 'Операции',   icon: 'settings',   data: diag?.operations_score },
    { key: 'marketing',  title: 'Маркетинг',  icon: 'campaign',   data: diag?.marketing_score },
    { key: 'strategy',   title: 'Стратегия',  icon: 'flag',       data: diag?.strategy_score },
  ]

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          {/* UX-03: single scrollable row on mobile instead of wrapping to
              several rows; [&>*]:shrink-0 keeps every action at full size. */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full [&>*]:shrink-0">
            {companyId && <ShareButton type="point_a" companyId={companyId} />}
            <Link href="/dashboard" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] hover:border-primary/30 rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">dashboard</span>
              Кабинет
            </Link>
            <button
              onClick={recalculate}
              disabled={isRecalculating || !userId}
              className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-sm ${isRecalculating ? 'animate-spin' : ''}`}>refresh</span>
              Пересчитать
            </button>
            <Link href="/client/onboarding/documents" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">upload_file</span>
              Документы
            </Link>
            <button
              onClick={async () => {
                const sb = createClient()
                await sb.auth.signOut()
                window.location.href = '/login'
              }}
              className="flex items-center gap-1.5 text-xs font-mono text-red-400/70 hover:text-red-400 border border-red-500/10 hover:border-red-500/20 rounded-lg px-3 py-1.5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              Выход
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {sessionState === 'signed_out' ? (
          /* No Supabase session in the browser — say so instead of spinning. */
          <section
            aria-label="Требуется вход"
            className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-8 text-center max-w-xl mx-auto"
          >
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-2xl text-primary" aria-hidden="true">login</span>
            </div>
            <h1 className="font-headline text-xl font-bold text-on-surface mb-2">Войдите, чтобы увидеть Точку А</h1>
            <p className="text-sm text-on-surface-variant mb-6">
              Сессия не найдена или истекла. Отчёт по Точке А доступен только в вашем кабинете.
            </p>
            <Link
              href="/login?from=%2Fclient%2Fpoint-a"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">login</span>
              Войти
            </Link>
          </section>
        ) : (
        <>
        {/* Welcome line — the score itself lives in the overview below (shown once). */}
        <section aria-label="Компания">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Точка А · Текущее состояние</p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">
            Добро пожаловать{company?.name ? `, ${company.name}` : ''}!
          </h1>
          <p className="text-xs text-on-surface-variant max-w-2xl">
            Ваш отчёт по Точке А — главное о бизнесе, цели на 1–3 года, диагностика по 5 блокам и данные анкеты в одном месте.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {company?.industry && (
              <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-sm" aria-hidden="true">business</span>
                {company.industry}
              </span>
            )}
            {company?.employee_count && (
              <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                <span className="material-symbols-outlined text-sm" aria-hidden="true">people</span>
                {company.employee_count} сотрудников
              </span>
            )}
            {calculatedAtLabel && (
              <span
                className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant"
                title="Дата расчёта диагностики"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">calendar_today</span>
                Расчёт от {calculatedAtLabel}
              </span>
            )}
            {diag && (
              <a
                href="#my-data"
                className="flex items-center gap-1.5 text-xs bg-primary/10 hover:bg-primary/15 border border-primary/30 px-3 py-1.5 rounded-lg text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">folder_managed</span>
                Мои данные
              </a>
            )}
          </div>
          {recalcError && (
            <p className="mt-3 text-xs text-error" role="alert">{recalcError}</p>
          )}
        </section>

        {/* Level 1 — executive overview (score, maturity, status, gaps, risks…) */}
        <ExecutiveOverview userId={userId} onRecalculated={loadData} />

        {/* Next Best Action — the single most important step right now */}
        <NextBestActionCard />

        {isLoading ? (
          <div className="flex items-center justify-center py-12" role="status">
            <div className="flex flex-col items-center gap-4">
              <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" aria-hidden="true" />
              <p className="text-sm text-on-surface-variant">Загружаем диагностику...</p>
            </div>
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-error/20 bg-error/5 p-6 text-center" role="alert">
            <p className="text-sm text-on-surface">{loadError}</p>
            <p className="mt-1 text-xs text-on-surface-variant">Блоки диагностики, анализ ИИ и риски не показаны, потому что данные не загрузились.</p>
            <button
              type="button"
              onClick={() => void loadData()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
              Повторить
            </button>
          </div>
        ) : !diag ? (
          /* No diagnostic yet — the overview above explains what to do next. */
          null
        ) : (
          <>
            {/* 1b. Assistant readiness — анкета completion ring, top issues, call-expert CTA */}
            <AssistantHintWidget />

            {/* 2. Growth Snapshot Hero — Точка А snapshot + AI карта роста + GRI */}
            <GrowthSnapshotHero />

            {/* 3. New spec-driven cabinet sections (Top Sales Table,
                Retention Curve, 6 metric blocks, RFM, Loss Map) */}
            <PointADashboardSectionsBoundary />

            {/* AI Executive Summary */}
            {aiStatus === 'processing' && (
              <section className="bg-violet-500/5 rounded-2xl border border-violet-500/15 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center animate-pulse">
                    <span className="material-symbols-outlined text-sm text-violet-400">smart_toy</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-violet-300">AI анализирует ваш бизнес...</p>
                    <p className="text-xs text-on-surface-variant">Claude изучает данные и готовит персональные рекомендации</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="h-3 bg-violet-500/10 rounded-full animate-pulse" />
                  <div className="h-3 bg-violet-500/10 rounded-full animate-pulse w-3/4" />
                  <div className="h-3 bg-violet-500/10 rounded-full animate-pulse w-1/2" />
                </div>
              </section>
            )}

            {aiStatus === 'failed' && (
              <section className="bg-error/5 rounded-2xl border border-error/15 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-lg text-error">warning</span>
                  <p className="text-sm text-on-surface-variant">AI-анализ недоступен</p>
                </div>
                <button onClick={retryAi}
                  className="text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 rounded-lg px-3 py-1.5 transition-all">
                  Повторить
                </button>
              </section>
            )}

            {aiAnalysis && (
              <section className="bg-violet-500/5 rounded-2xl border border-violet-500/15 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-lg text-violet-400">smart_toy</span>
                  <h2 className="text-sm font-bold text-violet-300">AI-анализ вашего бизнеса</h2>
                  <span className="ml-auto text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                    {aiAnalysis.model_used}
                  </span>
                </div>
                <p className="text-sm text-on-surface leading-relaxed">{aiAnalysis.executive_summary}</p>
              </section>
            )}

            {/* 2. Block Scores */}
            <section data-tour="pa-blocks">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-headline text-lg font-bold text-on-surface">Блоки оценки</h2>
                <span className="text-xs text-on-surface-variant font-mono">5 направлений</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {blocks.map(b => (
                  <BlockCard
                    key={b.key}
                    title={b.title}
                    icon={b.icon}
                    score={b.data as BlockScore | null}
                    aiBlock={aiAnalysis?.blocks?.[b.key]}
                  />
                ))}
              </div>
            </section>

            {/* AI Strategic Priorities */}
            {aiAnalysis && aiAnalysis.strategic_priorities.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-lg text-violet-400">flag</span>
                  <h2 className="font-headline text-lg font-bold text-on-surface">Стратегические приоритеты</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {aiAnalysis.strategic_priorities.map((p, i) => (
                    <div key={i} className="bg-surface-container-low rounded-2xl border border-violet-500/10 p-5 relative">
                      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-violet-400">{i + 1}</span>
                      </div>
                      <h3 className="text-sm font-bold text-on-surface mb-2 pr-8">{p.title}</h3>
                      <p className="text-xs text-on-surface-variant mb-3">{p.rationale}</p>
                      <div className="flex items-start gap-1.5 pt-2 border-t border-white/[0.06]">
                        <span className="material-symbols-outlined text-xs text-primary mt-0.5">trending_up</span>
                        <p className="text-xs text-primary">{p.expected_impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 3. Risks */}
            {(diag.risks?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Риски</h2>
                <div className="space-y-2">
                  {(diag.risks as Risk[]).map((risk, i) => {
                    const ri = riskIcon(risk.level)
                    return (
                      <div key={i} className={`flex items-start gap-3 ${ri.bg} rounded-xl border border-white/[0.04] p-4`}>
                        <span className={`material-symbols-outlined text-lg flex-shrink-0 mt-0.5 ${ri.color}`}>{ri.icon}</span>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-mono uppercase ${ri.color}`}>
                              {risk.level === 'critical' ? 'КРИТИЧНО' : risk.level === 'important' ? 'ВАЖНО' : 'УМЕРЕННО'}
                            </span>
                            <span className="text-xs text-on-surface-variant">· {risk.area}</span>
                          </div>
                          <p className="text-sm text-on-surface">{risk.text}</p>
                          {risk.impact && <p className="text-xs text-on-surface-variant mt-0.5">→ {risk.impact}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* 4. Insights */}
            {(diag.insights?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Инсайты</h2>
                <div className="space-y-2">
                  {(diag.insights as Insight[]).map((ins, i) => (
                    <div key={i} className="flex items-start gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
                      <span className="material-symbols-outlined text-lg text-primary flex-shrink-0 mt-0.5">lightbulb</span>
                      <div>
                        <span className="text-xs font-mono text-on-surface-variant">{ins.area} · </span>
                        <span className="text-sm text-on-surface">{ins.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 5. Quick Wins */}
            {(diag.quick_wins?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Быстрые победы</h2>
                <div className="space-y-2">
                  {(diag.quick_wins as QuickWin[]).map((qw, i) => (
                    <div key={i} className="flex items-center gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-xs text-primary">check</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-on-surface">{qw.action}</p>
                        <p className="text-xs text-on-surface-variant">{qw.area}</p>
                      </div>
                      <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded-lg flex-shrink-0">
                        {qw.timeline}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI Growth Roadmap */}
            {aiAnalysis && aiAnalysis.growth_roadmap.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-lg text-violet-400">route</span>
                  <h2 className="font-headline text-lg font-bold text-on-surface">Дорожная карта роста</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {aiAnalysis.growth_roadmap.map((rm) => {
                    const labels: Record<string, { title: string; color: string }> = {
                      '30_days':  { title: '30 дней',  color: 'text-emerald-400' },
                      '90_days':  { title: '90 дней',  color: 'text-blue-400' },
                      '180_days': { title: '180 дней', color: 'text-violet-400' },
                    }
                    const l = labels[rm.horizon] ?? { title: rm.horizon, color: 'text-on-surface-variant' }
                    return (
                      <div key={rm.horizon} className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
                        <p className={`text-xs font-mono font-bold uppercase tracking-widest mb-3 ${l.color}`}>{l.title}</p>
                        <ul className="space-y-2">
                          {rm.actions.map((action, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                              <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">check_circle</span>
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* AI Industry Context */}
            {aiAnalysis?.industry_context && (
              <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-lg text-blue-400">public</span>
                  <h2 className="text-sm font-bold text-on-surface">Отраслевой контекст</h2>
                </div>
                <p className="text-sm text-on-surface-variant leading-relaxed">{aiAnalysis.industry_context}</p>
              </section>
            )}

            {/* 5b. Phase 6 final — Real-time Intelligence Section */}
            {userId && (
              <section>
                <PointAIntelligenceSection userId={userId} companyId={companyId} />
              </section>
            )}

            {/* 6. Upload more */}
            <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
              <h2 className="text-sm font-medium text-on-surface mb-4">Улучшить диагностику</h2>
              <div className="grid grid-cols-2 gap-3">
                <Link href="/client/onboarding/documents" className="flex items-center gap-2 bg-surface-container rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                  <span className="material-symbols-outlined text-xl text-primary">upload_file</span>
                  <div>
                    <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Загрузить отчёт</p>
                    <p className="text-[10px] text-on-surface-variant">P&L, баланс, CRM</p>
                  </div>
                </Link>
                <Link href="/client/onboarding" className="flex items-center gap-2 bg-surface-container rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                  <span className="material-symbols-outlined text-xl text-primary">edit_note</span>
                  <div>
                    <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Обновить анкету</p>
                    <p className="text-[10px] text-on-surface-variant">Изменить ответы</p>
                  </div>
                </Link>
              </div>
            </section>

            {/* My Data — merged from former /client/my-data: survey answers
                grouped by step + uploaded documents list. Anchored at #my-data. */}
            {companyId && (
              <div className="flex items-center justify-between gap-3 flex-wrap" id="my-data">
                <div>
                  <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">Анкета · Источник данных</p>
                  <h2 className="font-headline text-lg font-bold text-on-surface">Мои данные</h2>
                </div>
                <ShareButton type="survey" companyId={companyId} />
              </div>
            )}
            <MyDataSection userId={userId} />
          </>
        )}
        </>
        )}
      </main>
      {/* Assistant dock is provided once by app/client/layout.tsx — do not mount
          a second launcher here (it stacked two FABs + duplicate toasters). */}
    </div>
  )
}
