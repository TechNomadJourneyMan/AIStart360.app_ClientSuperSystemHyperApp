'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { PointARadarWidget } from '@/components/dashboard/PointARadarWidget'
import { ExpertCommentsSection } from '@/components/client/ExpertCommentsSection'
import type {
  Diagnostic, BlockScore, Risk, Insight, QuickWin,
  DiagnosticStage, AIAnalysis, AIStatus, PointA,
} from '@/types/onboarding'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stageLabel(s: DiagnosticStage | null): string {
  const map: Record<DiagnosticStage, string> = {
    seed: 'Seed', early: 'Early', growth: 'Growth', scale: 'Scale', mature: 'Mature'
  }
  return s ? map[s] : '—'
}

function blockLabel(status: string | undefined): { text: string; color: string } {
  const m: Record<string, { text: string; color: string }> = {
    critical:  { text: 'Critical',   color: 'text-error' },
    weak:      { text: 'Weak',      color: 'text-orange-400' },
    average:   { text: 'Average',   color: 'text-amber-400' },
    strong:    { text: 'Strong',    color: 'text-primary' },
    excellent: { text: 'Excellent', color: 'text-emerald-400' },
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
            {open ? 'Collapse' : 'Details'}
            <span className="material-symbols-outlined text-xs">{open ? 'expand_less' : 'expand_more'}</span>
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
          {aiBlock && (
            <div className="bg-violet-500/5 rounded-xl border border-violet-500/10 p-3 space-y-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-xs text-violet-400">smart_toy</span>
                <span className="text-[10px] font-mono text-violet-400 uppercase tracking-widest">AI Analysis</span>
              </div>
              <p className="text-xs text-on-surface leading-relaxed">{aiBlock.diagnosis}</p>
              <div className="grid grid-cols-1 gap-2 mt-2">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-blue-400 mt-0.5 flex-shrink-0">bar_chart</span>
                  <p className="text-xs text-on-surface-variant"><span className="text-blue-400 font-medium">Benchmark:</span> {aiBlock.benchmark_comparison}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-error mt-0.5 flex-shrink-0">warning</span>
                  <p className="text-xs text-on-surface-variant"><span className="text-error font-medium">Risk:</span> {aiBlock.key_risk}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">lightbulb</span>
                  <p className="text-xs text-on-surface-variant"><span className="text-primary font-medium">Recommendation:</span> {aiBlock.top_recommendation}</p>
                </div>
              </div>
            </div>
          )}
          {score && score.top_issues.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Issues</p>
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
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Recommendations</p>
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

// ─── KPI stat card (inline — no Link) ────────────────────────────────────────

function StatCard({ label, value, sublabel, icon, color }: {
  label: string; value: string; sublabel: string; icon: string; color: string
}) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{label}</p>
        <span className={`material-symbols-outlined text-base opacity-40 ${color}`}>{icon}</span>
      </div>
      <h3 className="text-3xl font-mono font-bold leading-none mb-2 text-on-surface">{value}</h3>
      <p className="text-[10px] text-on-surface-variant">{sublabel}</p>
    </div>
  )
}

// ─── Documents list ──────────────────────────────────────────────────────────

type DocumentRow = {
  id: string; file_name: string; doc_type: string; file_size: number | null
  parse_status: string; uploaded_at: string; file_url: string | null
}

const PARSE_LABELS: Record<string, { label: string; color: string }> = {
  queued:     { label: 'Queued',      color: 'text-on-surface-variant' },
  processing: { label: 'Processing', color: 'text-blue-400' },
  done:       { label: 'Done',       color: 'text-primary' },
  error:      { label: 'Error',      color: 'text-error' },
}

const DOC_LABELS: Record<string, string> = {
  pl: 'P&L', balance_sheet: 'Balance Sheet', cashflow: 'Cash Flow',
  crm_export: 'CRM', tax_report: 'Tax Report', other: 'Other',
}

function formatBytes(b: number | null) {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ClientDashboard() {
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<{ name: string; industry: string | null; employee_count: number | null } | null>(null)
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null)
  const [aiStatus, setAiStatus] = useState<AIStatus>('none')
  const [surveyData, setSurveyData] = useState<{ answers: Record<string, unknown>; completed_steps: number[] } | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      if (u?.id) setUserId(u.id)
    })
  }, [])

  const loadData = useCallback(async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const [diagRes, compRes, docsRes, surveyRes] = await Promise.all([
        fetch(`/api/v1/diagnostics/current?user_id=${userId}`),
        fetch(`/api/v1/onboarding/company?user_id=${userId}`),
        fetch(`/api/v1/onboarding/documents?user_id=${userId}`),
        fetch(`/api/v1/onboarding/survey?user_id=${userId}`),
      ])
      const diagData = await diagRes.json()
      const compData = await compRes.json()
      const docsData = await docsRes.json()
      const surveyJson = await surveyRes.json()
      if (diagData.ok) {
        setDiag(diagData.data)
        setAiStatus(diagData.data?.ai_status ?? 'none')
        setAiAnalysis(diagData.data?.ai_analysis ?? null)
      }
      if (compData.ok) setCompany(compData.data)
      if (docsData.ok) setDocuments(docsData.data ?? [])
      if (surveyJson.ok) setSurveyData(surveyJson.data)
    } catch {}
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
          if (data.data.ai_analysis) setAiAnalysis(data.data.ai_analysis)
          if (data.data.ai_status === 'completed' || data.data.ai_status === 'failed') {
            clearInterval(interval)
          }
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [aiStatus, diag?.id])

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

  // Build PointA object from Diagnostic for radar
  const pointA: PointA | null = diag ? {
    overall_score: diag.overall_score ?? 0,
    health_index: diag.health_index ?? 0,
    stage: diag.stage ?? 'seed',
    blocks: {
      finance:    diag.finance_score    ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
      sales:      diag.sales_score      ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
      operations: diag.operations_score ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
      marketing:  diag.marketing_score  ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
      strategy:   diag.strategy_score   ?? { score: 0, status: 'critical', top_issues: [], recommendations: [] },
    },
    risks:      (diag.risks       as Risk[]      | null) ?? [],
    insights:   (diag.insights    as Insight[]   | null) ?? [],
    quick_wins: (diag.quick_wins  as QuickWin[]  | null) ?? [],
    data_gaps:  (diag.data_gaps   as { field: string; step: number; impact: string }[] | null) ?? [],
  } : null

  const overallScore = diag?.overall_score ?? 0
  const healthIndex  = diag?.health_index  ?? 0

  const blocks = [
    { key: 'finance',    title: 'Finance',    icon: 'payments',    data: diag?.finance_score },
    { key: 'sales',      title: 'Sales',      icon: 'trending_up', data: diag?.sales_score },
    { key: 'operations', title: 'Operations', icon: 'settings',    data: diag?.operations_score },
    { key: 'marketing',  title: 'Marketing',  icon: 'campaign',    data: diag?.marketing_score },
    { key: 'strategy',   title: 'Strategy',   icon: 'flag',        data: diag?.strategy_score },
  ]

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
            {company?.name && (
              <span className="text-xs font-mono text-on-surface-variant/50 border-l border-white/[0.08] pl-3">
                {company.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/client/point-a" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">analytics</span>
              Point A
            </Link>
            <Link href="/client/my-data" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">description</span>
              My Data
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
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <span className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-on-surface-variant">Loading dashboard...</p>
            </div>
          </div>
        ) : !diag ? (
          <div className="space-y-6">
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl text-primary">analytics</span>
              </div>
              <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Diagnostics Not Calculated</h2>
              <p className="text-sm text-on-surface-variant mb-6">Fill out the survey to see your Point A</p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link href="/client/onboarding" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm">
                  Fill Out Survey
                </Link>
                <Link href="/client/point-a" className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm font-medium hover:bg-white/[0.04] transition-colors">
                  <span className="material-symbols-outlined text-base">analytics</span>
                  View Point A
                </Link>
              </div>
            </div>

            {/* Survey data summary when survey is partially/fully completed but diagnostics not yet run */}
            {surveyData && surveyData.completed_steps.length > 0 && (
              <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-lg text-primary">fact_check</span>
                  <h3 className="text-sm font-bold text-on-surface">Survey Progress</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-surface-container rounded-xl p-3 text-center">
                    <p className="text-2xl font-mono font-bold text-primary">{surveyData.completed_steps.length}</p>
                    <p className="text-[10px] text-on-surface-variant mt-1">Steps Completed</p>
                  </div>
                  <div className="bg-surface-container rounded-xl p-3 text-center">
                    <p className="text-2xl font-mono font-bold text-on-surface">{Object.keys(surveyData.answers).length}</p>
                    <p className="text-[10px] text-on-surface-variant mt-1">Questions Answered</p>
                  </div>
                  <div className="bg-surface-container rounded-xl p-3 text-center">
                    <p className="text-2xl font-mono font-bold text-on-surface">{documents.length}</p>
                    <p className="text-[10px] text-on-surface-variant mt-1">Documents Uploaded</p>
                  </div>
                  <div className="bg-surface-container rounded-xl p-3 text-center">
                    <p className="text-2xl font-mono font-bold text-amber-400">Pending</p>
                    <p className="text-[10px] text-on-surface-variant mt-1">Diagnostic Status</p>
                  </div>
                </div>
                {company?.name && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                      <span className="material-symbols-outlined text-sm">business</span>
                      {company.name}
                    </span>
                    {company.industry && (
                      <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">category</span>
                        {company.industry}
                      </span>
                    )}
                    {company.employee_count && (
                      <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">people</span>
                        {company.employee_count} employees
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 1. Hero: Radar + KPIs */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="font-headline text-2xl font-extrabold text-on-surface">
                    My Dashboard
                  </h1>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {company?.name && <span>{company.name} · </span>}
                    Stage: <strong className="text-on-surface">{stageLabel(diag.stage)}</strong>
                    {company?.industry && <span> · {company.industry}</span>}
                    <span className="text-primary/60"> · Point A Diagnostics</span>
                  </p>
                </div>
                <Link href="/client/onboarding" className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all">
                  <span className="material-symbols-outlined text-sm">edit_note</span>
                  Update Survey
                </Link>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Radar widget */}
                {pointA && (
                  <PointARadarWidget
                    pointA={pointA}
                    orgName={company?.name}
                  />
                )}

                {/* KPI cards */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="Overall Score"
                    value={(overallScore / 10).toFixed(1)}
                    sublabel="out of 10"
                    icon="analytics"
                    color={overallScore >= 70 ? 'text-primary' : overallScore >= 45 ? 'text-amber-400' : 'text-error'}
                  />
                  <StatCard
                    label="Health Index"
                    value={(healthIndex / 10).toFixed(1)}
                    sublabel="health index"
                    icon="favorite"
                    color={healthIndex >= 70 ? 'text-primary' : healthIndex >= 45 ? 'text-amber-400' : 'text-error'}
                  />
                  <StatCard
                    label="Documents"
                    value={String(documents.length)}
                    sublabel="files uploaded"
                    icon="description"
                    color="text-primary"
                  />
                  <StatCard
                    label="Stage"
                    value={stageLabel(diag.stage)}
                    sublabel="development stage"
                    icon="radar"
                    color="text-primary"
                  />
                </div>
              </div>
            </section>

            {/* 2. AI Status / Executive Summary */}
            {aiStatus === 'processing' && (
              <section className="bg-violet-500/5 rounded-2xl border border-violet-500/15 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center animate-pulse">
                    <span className="material-symbols-outlined text-sm text-violet-400">smart_toy</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-violet-300">AI is analyzing your business...</p>
                    <p className="text-xs text-on-surface-variant">Claude is studying data and preparing personalized recommendations</p>
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
                  <p className="text-sm text-on-surface-variant">AI analysis unavailable</p>
                </div>
                <button onClick={retryAi}
                  className="text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 rounded-lg px-3 py-1.5 transition-all">
                  Retry
                </button>
              </section>
            )}

            {aiAnalysis && (
              <section className="bg-violet-500/5 rounded-2xl border border-violet-500/15 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-lg text-violet-400">smart_toy</span>
                  <h2 className="text-sm font-bold text-violet-300">AI Analysis of Your Business</h2>
                  <span className="ml-auto text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                    {aiAnalysis.model_used}
                  </span>
                </div>
                <p className="text-sm text-on-surface leading-relaxed">{aiAnalysis.executive_summary}</p>
              </section>
            )}

            {/* 3. Block Scores */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-headline text-lg font-bold text-on-surface">Assessment Blocks</h2>
                <span className="text-xs text-on-surface-variant font-mono">5 areas</span>
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

            {/* Point A CTA Banner */}
            <section>
              <Link
                href="/client/point-a"
                className="group flex items-center justify-between bg-gradient-to-r from-primary/10 to-emerald-500/5 rounded-2xl border border-primary/20 hover:border-primary/40 p-5 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-xl text-primary">analytics</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
                      View Full Point A Analysis
                    </h3>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      Detailed scores, risks, insights, and personalized recommendations
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-xl text-primary/60 group-hover:text-primary group-hover:translate-x-1 transition-all">
                  arrow_forward
                </span>
              </Link>
            </section>

            {/* 4. AI Strategic Priorities */}
            {aiAnalysis && aiAnalysis.strategic_priorities.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-lg text-violet-400">flag</span>
                  <h2 className="font-headline text-lg font-bold text-on-surface">Strategic Priorities</h2>
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

            {/* 5. Risks */}
            {(diag.risks?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Risks</h2>
                <div className="space-y-2">
                  {(diag.risks as Risk[]).map((risk, i) => {
                    const ri = riskIcon(risk.level)
                    return (
                      <div key={i} className={`flex items-start gap-3 ${ri.bg} rounded-xl border border-white/[0.04] p-4`}>
                        <span className={`material-symbols-outlined text-lg flex-shrink-0 mt-0.5 ${ri.color}`}>{ri.icon}</span>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-mono uppercase ${ri.color}`}>
                              {risk.level === 'critical' ? 'CRITICAL' : risk.level === 'important' ? 'IMPORTANT' : 'MODERATE'}
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

            {/* 6. Insights */}
            {(diag.insights?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Insights</h2>
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

            {/* 7. Quick Wins */}
            {(diag.quick_wins?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Quick Wins</h2>
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

            {/* 8. AI Growth Roadmap */}
            {aiAnalysis && aiAnalysis.growth_roadmap.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-lg text-violet-400">route</span>
                  <h2 className="font-headline text-lg font-bold text-on-surface">Growth Roadmap</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {aiAnalysis.growth_roadmap.map((rm) => {
                    const labels: Record<string, { title: string; color: string }> = {
                      '30_days':  { title: '30 days',  color: 'text-emerald-400' },
                      '90_days':  { title: '90 days',  color: 'text-blue-400' },
                      '180_days': { title: '180 days', color: 'text-violet-400' },
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

            {/* 9. AI Industry Context */}
            {aiAnalysis?.industry_context && (
              <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-lg text-blue-400">public</span>
                  <h2 className="text-sm font-bold text-on-surface">Industry Context</h2>
                </div>
                <p className="text-sm text-on-surface-variant leading-relaxed">{aiAnalysis.industry_context}</p>
              </section>
            )}

            {/* 10. Documents */}
            <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-primary">folder_open</span>
                  <h2 className="text-sm font-bold text-on-surface">My Documents</h2>
                </div>
                <Link href="/client/onboarding/documents"
                  className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">upload_file</span>
                  Upload
                </Link>
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-6">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 block mb-2">folder_open</span>
                  <p className="text-sm text-on-surface-variant">No documents uploaded yet</p>
                  <p className="text-xs text-on-surface-variant/60 mt-1">Upload P&L, balance sheet, or CRM export for in-depth analysis</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => {
                    const status = PARSE_LABELS[doc.parse_status] ?? PARSE_LABELS['queued']
                    const typeLabel = DOC_LABELS[doc.doc_type] ?? doc.doc_type
                    const uploadedAt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(doc.uploaded_at))
                    return (
                      <div key={doc.id} className="flex items-center gap-3 bg-surface-container rounded-xl border border-white/[0.06] p-3">
                        <span className="material-symbols-outlined text-xl text-primary/60">description</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-on-surface truncate">{doc.file_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-on-surface-variant">{typeLabel}</span>
                            <span className="text-[10px] text-on-surface-variant/40">·</span>
                            <span className="text-[10px] text-on-surface-variant">{formatBytes(doc.file_size)}</span>
                            <span className="text-[10px] text-on-surface-variant/40">·</span>
                            <span className="text-[10px] text-on-surface-variant">{uploadedAt}</span>
                          </div>
                        </div>
                        <span className={`text-[10px] font-mono ${status.color}`}>{status.label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* 11. Footer links */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Link href="/client/onboarding" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">edit_note</span>
                <div>
                  <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Update Survey</p>
                  <p className="text-[10px] text-on-surface-variant">Change data</p>
                </div>
              </Link>
              <Link href="/client/my-data" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">description</span>
                <div>
                  <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">My Data</p>
                  <p className="text-[10px] text-on-surface-variant">View survey</p>
                </div>
              </Link>
              <Link href="/client/onboarding/documents" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">upload_file</span>
                <div>
                  <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Documents</p>
                  <p className="text-[10px] text-on-surface-variant">P&L, Balance Sheet, CRM</p>
                </div>
              </Link>
              <Link href="/client/point-a" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">analytics</span>
                <div>
                  <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Point A</p>
                  <p className="text-[10px] text-on-surface-variant">Full analysis</p>
                </div>
              </Link>
            </section>

            {/* 10. Expert comments */}
            <ExpertCommentsSection />
          </>
        )}
      </main>
    </div>
  )
}
