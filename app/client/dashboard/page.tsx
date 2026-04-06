'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { PointARadarWidget } from '@/components/dashboard/PointARadarWidget'
import type { Diagnostic, BlockScore, Risk, Insight, QuickWin, DiagnosticStage, AIAnalysis, AIStatus } from '@/types/onboarding'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function stageLabel(s: DiagnosticStage | null): string {
  const map: Record<DiagnosticStage, string> = {
    seed: 'Seed', early: 'Early', growth: 'Growth', scale: 'Scale', mature: 'Mature'
  }
  return s ? map[s] : '—'
}

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
        <div className="h-full rounded-full transition-all duration-1000" style={{
          width: `${pct}%`,
          background: pct >= 70 ? 'linear-gradient(90deg, #6EFFC0, #00e29e)' : pct >= 45 ? '#FBBF24' : '#EF4444'
        }} />
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
          {score && score.top_issues.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Проблемы</p>
              <ul className="space-y-1">
                {score.top_issues.map((iss, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-xs text-error mt-0.5 flex-shrink-0">close</span>{iss}
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
                    <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">arrow_forward</span>{rec}
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ClientDashboardPage() {
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<{ name: string; industry: string | null; employee_count: number | null } | null>(null)
  const [docs, setDocs] = useState<Array<{ id: string; file_name: string; doc_type: string; parse_status: string }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null)
  const [aiStatus, setAiStatus] = useState<AIStatus>('none')

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.id) setUserId(data.session.user.id)
    })
  }, [])

  const loadData = useCallback(async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const [diagRes, compRes, docsRes] = await Promise.all([
        fetch(`/api/v1/diagnostics/current?user_id=${userId}`),
        fetch(`/api/v1/onboarding/company?user_id=${userId}`),
        fetch(`/api/v1/onboarding/documents?user_id=${userId}`),
      ])
      const [diagData, compData, docsData] = await Promise.all([diagRes.json(), compRes.json(), docsRes.json()])
      if (diagData.ok) {
        setDiag(diagData.data)
        setAiStatus(diagData.data?.ai_status ?? 'none')
        setAiAnalysis(diagData.data?.ai_analysis ?? null)
      }
      if (compData.ok) setCompany(compData.data)
      if (docsData.ok) setDocs(docsData.data ?? [])
    } catch {}
    setIsLoading(false)
  }, [userId])

  useEffect(() => { if (userId) loadData() }, [userId, loadData])

  // Poll AI status
  useEffect(() => {
    if (aiStatus !== 'processing' || !diag?.id) return
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/diagnostics/ai-status?diagnostic_id=${diag.id}`)
        const d = await res.json()
        if (d.ok) {
          setAiStatus(d.data.ai_status)
          if (d.data.ai_analysis) setAiAnalysis(d.data.ai_analysis)
          if (d.data.ai_status === 'completed' || d.data.ai_status === 'failed') clearInterval(iv)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(iv)
  }, [aiStatus, diag?.id])

  const recalculate = async () => {
    if (!userId) return
    setIsRecalculating(true); setAiAnalysis(null); setAiStatus('none')
    try {
      await fetch('/api/v1/diagnostics/recalculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) })
      await loadData()
    } catch {}
    setIsRecalculating(false)
  }

  const retryAi = async () => {
    if (!diag?.id) return
    setAiStatus('processing'); setAiAnalysis(null)
    try { await fetch('/api/v1/diagnostics/retry-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diagnostic_id: diag.id }) }) } catch {}
  }

  const score = diag?.overall_score ?? 0
  const blocks = [
    { key: 'finance',    title: 'Финансы',   icon: 'payments',    data: diag?.finance_score },
    { key: 'sales',      title: 'Продажи',   icon: 'trending_up', data: diag?.sales_score },
    { key: 'operations', title: 'Операции',  icon: 'settings',    data: diag?.operations_score },
    { key: 'marketing',  title: 'Маркетинг', icon: 'campaign',    data: diag?.marketing_score },
    { key: 'strategy',   title: 'Стратегия', icon: 'flag',        data: diag?.strategy_score },
  ]
  const radarDomains = blocks.map(b => ({ label: b.title, score: (b.data as BlockScore | null)?.score ?? 0 }))

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      <header className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Image src="/logo.svg" alt="AIStart360" width={120} height={22} />
          <div className="flex items-center gap-3">
            <button onClick={recalculate} disabled={isRecalculating}
              className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all disabled:opacity-60">
              <span className={`material-symbols-outlined text-sm ${isRecalculating ? 'animate-spin' : ''}`}>refresh</span>Пересчитать
            </button>
            <Link href="/client/onboarding/documents" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">upload_file</span>Документы
            </Link>
            <Link href="/client/point-a" className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">assessment</span>Point A
            </Link>
            <button onClick={async () => { const sb = createClient(); await sb.auth.signOut(); window.location.href = '/login' }}
              className="flex items-center gap-1.5 text-xs font-mono text-red-400/70 hover:text-red-400 border border-red-500/10 hover:border-red-500/20 rounded-lg px-3 py-1.5 transition-all">
              <span className="material-symbols-outlined text-sm">logout</span>Выход
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <span className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : !diag ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl text-primary">analytics</span>
            </div>
            <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Диагностика не рассчитана</h2>
            <p className="text-sm text-on-surface-variant mb-6">Заполните анкету и нажмите «Пересчитать»</p>
            <Link href="/client/onboarding" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm">
              Заполнить анкету
            </Link>
          </div>
        ) : (
          <>
            {/* Hero: Radar + KPIs */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PointARadarWidget domains={radarDomains} overallScore={score} companyName={company?.name} />
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Общий балл</p>
                  <h3 className="text-3xl font-mono font-bold text-on-surface">{(score / 10).toFixed(1)}</h3>
                  <span className="text-xs text-on-surface-variant">из 10</span>
                </div>
                <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Health Index</p>
                  <h3 className="text-3xl font-mono font-bold" style={{ color: (diag.health_index ?? 0) >= 60 ? '#6EFFC0' : (diag.health_index ?? 0) >= 40 ? '#FBBF24' : '#EF4444' }}>
                    {diag.health_index ?? 0}
                  </h3>
                  <span className="text-xs text-on-surface-variant">из 100</span>
                </div>
                <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Стадия</p>
                  <h3 className="text-2xl font-mono font-bold text-primary">{stageLabel(diag.stage)}</h3>
                  {company?.industry && <span className="text-xs text-on-surface-variant">{company.industry}</span>}
                </div>
                <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Документы</p>
                  <h3 className="text-3xl font-mono font-bold text-on-surface">{docs.length}</h3>
                  <span className="text-xs text-on-surface-variant">загружено</span>
                </div>
              </div>
            </section>

            {/* AI Summary */}
            {aiStatus === 'processing' && (
              <section className="bg-violet-500/5 rounded-2xl border border-violet-500/15 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center animate-pulse">
                    <span className="material-symbols-outlined text-sm text-violet-400">smart_toy</span>
                  </div>
                  <div><p className="text-sm font-medium text-violet-300">AI анализирует ваш бизнес...</p><p className="text-xs text-on-surface-variant">Claude готовит рекомендации</p></div>
                </div>
                <div className="mt-4 space-y-2"><div className="h-3 bg-violet-500/10 rounded-full animate-pulse" /><div className="h-3 bg-violet-500/10 rounded-full animate-pulse w-3/4" /></div>
              </section>
            )}
            {aiStatus === 'failed' && (
              <section className="bg-error/5 rounded-2xl border border-error/15 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3"><span className="material-symbols-outlined text-lg text-error">warning</span><p className="text-sm text-on-surface-variant">AI-анализ недоступен</p></div>
                <button onClick={retryAi} className="text-xs font-mono text-primary border border-primary/20 rounded-lg px-3 py-1.5">Повторить</button>
              </section>
            )}
            {aiAnalysis && (
              <section className="bg-violet-500/5 rounded-2xl border border-violet-500/15 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-lg text-violet-400">smart_toy</span>
                  <h2 className="text-sm font-bold text-violet-300">AI-анализ вашего бизнеса</h2>
                  <span className="ml-auto text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">{aiAnalysis.model_used}</span>
                </div>
                <p className="text-sm text-on-surface leading-relaxed">{aiAnalysis.executive_summary}</p>
              </section>
            )}

            {/* Blocks */}
            <section>
              <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Блоки оценки</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {blocks.map(b => <BlockCard key={b.key} title={b.title} icon={b.icon} score={b.data as BlockScore | null} aiBlock={aiAnalysis?.blocks?.[b.key]} />)}
              </div>
            </section>

            {/* Strategic Priorities */}
            {aiAnalysis && aiAnalysis.strategic_priorities.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4"><span className="material-symbols-outlined text-lg text-violet-400">flag</span><h2 className="font-headline text-lg font-bold text-on-surface">Стратегические приоритеты</h2></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {aiAnalysis.strategic_priorities.map((p, i) => (
                    <div key={i} className="bg-surface-container-low rounded-2xl border border-violet-500/10 p-5 relative">
                      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center"><span className="text-xs font-bold text-violet-400">{i + 1}</span></div>
                      <h3 className="text-sm font-bold text-on-surface mb-2 pr-8">{p.title}</h3>
                      <p className="text-xs text-on-surface-variant mb-3">{p.rationale}</p>
                      <div className="flex items-start gap-1.5 pt-2 border-t border-white/[0.06]"><span className="material-symbols-outlined text-xs text-primary mt-0.5">trending_up</span><p className="text-xs text-primary">{p.expected_impact}</p></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Growth Roadmap */}
            {aiAnalysis && aiAnalysis.growth_roadmap.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4"><span className="material-symbols-outlined text-lg text-violet-400">route</span><h2 className="font-headline text-lg font-bold text-on-surface">Дорожная карта роста</h2></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {aiAnalysis.growth_roadmap.map(rm => {
                    const l = { '30_days': { t: '30 дней', c: 'text-emerald-400' }, '90_days': { t: '90 дней', c: 'text-blue-400' }, '180_days': { t: '180 дней', c: 'text-violet-400' } }[rm.horizon] ?? { t: rm.horizon, c: '' }
                    return (
                      <div key={rm.horizon} className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
                        <p className={`text-xs font-mono font-bold uppercase tracking-widest mb-3 ${l.c}`}>{l.t}</p>
                        <ul className="space-y-2">{rm.actions.map((a, i) => <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant"><span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">check_circle</span>{a}</li>)}</ul>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Risks */}
            {(diag.risks?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Риски</h2>
                <div className="space-y-2">
                  {(diag.risks as Risk[]).map((risk, i) => { const ri = riskIcon(risk.level); return (
                    <div key={i} className={`flex items-start gap-3 ${ri.bg} rounded-xl border border-white/[0.04] p-4`}>
                      <span className={`material-symbols-outlined text-lg flex-shrink-0 mt-0.5 ${ri.color}`}>{ri.icon}</span>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5"><span className={`text-xs font-mono uppercase ${ri.color}`}>{risk.level === 'critical' ? 'КРИТИЧНО' : risk.level === 'important' ? 'ВАЖНО' : 'УМЕРЕННО'}</span><span className="text-xs text-on-surface-variant">· {risk.area}</span></div>
                        <p className="text-sm text-on-surface">{risk.text}</p>
                        {risk.impact && <p className="text-xs text-on-surface-variant mt-0.5">→ {risk.impact}</p>}
                      </div>
                    </div>
                  )})}
                </div>
              </section>
            )}

            {/* Quick Wins */}
            {(diag.quick_wins?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Быстрые победы</h2>
                <div className="space-y-2">
                  {(diag.quick_wins as QuickWin[]).map((qw, i) => (
                    <div key={i} className="flex items-center gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="material-symbols-outlined text-xs text-primary">check</span></div>
                      <div className="flex-1"><p className="text-sm text-on-surface">{qw.action}</p><p className="text-xs text-on-surface-variant">{qw.area}</p></div>
                      <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded-lg flex-shrink-0">{qw.timeline}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Industry Context */}
            {aiAnalysis?.industry_context && (
              <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
                <div className="flex items-center gap-2 mb-3"><span className="material-symbols-outlined text-lg text-blue-400">public</span><h2 className="text-sm font-bold text-on-surface">Отраслевой контекст</h2></div>
                <p className="text-sm text-on-surface-variant leading-relaxed">{aiAnalysis.industry_context}</p>
              </section>
            )}

            {/* Documents */}
            {docs.length > 0 && (
              <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-medium text-on-surface">Загруженные документы</h2><Link href="/client/onboarding/documents" className="text-xs text-primary">+ Загрузить</Link></div>
                <div className="space-y-2">
                  {docs.map(d => (
                    <div key={d.id} className="flex items-center gap-3 bg-surface-container rounded-xl p-3">
                      <span className="material-symbols-outlined text-sm text-primary">description</span>
                      <span className="text-xs text-on-surface flex-1 truncate">{d.file_name}</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${d.parse_status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : d.parse_status === 'processing' ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-500/15 text-slate-400'}`}>{d.parse_status}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Nav Links */}
            <section className="grid grid-cols-3 gap-3">
              <Link href="/client/onboarding/documents" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">upload_file</span>
                <div><p className="text-xs font-medium text-on-surface group-hover:text-primary">Загрузить отчёт</p><p className="text-[10px] text-on-surface-variant">P&L, баланс</p></div>
              </Link>
              <Link href="/client/onboarding" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">edit_note</span>
                <div><p className="text-xs font-medium text-on-surface group-hover:text-primary">Обновить анкету</p><p className="text-[10px] text-on-surface-variant">Изменить ответы</p></div>
              </Link>
              <Link href="/client/my-data" className="flex items-center gap-2 bg-surface-container-low rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                <span className="material-symbols-outlined text-xl text-primary">person</span>
                <div><p className="text-xs font-medium text-on-surface group-hover:text-primary">Мои данные</p><p className="text-[10px] text-on-surface-variant">Профиль</p></div>
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
