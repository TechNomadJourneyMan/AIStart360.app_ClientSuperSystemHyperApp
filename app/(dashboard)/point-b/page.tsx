export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase-server'
import { calculatePointB } from '@/lib/point-b-engine'
import type { PointA, BlockScore, DiagnosticStage } from '@/types/onboarding'

export const metadata: Metadata = { title: 'Точка Б — Целевое состояние' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
}

const PRIORITY_STYLE: Record<string, { label: string; cls: string }> = {
  critical: { label: 'Критично',  cls: 'text-error border-error/40 bg-error/[0.06]' },
  high:     { label: 'Высокий',   cls: 'text-amber-400 border-amber-400/40 bg-amber-400/[0.06]' },
  medium:   { label: 'Средний',   cls: 'text-blue-300 border-blue-300/30 bg-blue-300/[0.06]' },
  low:      { label: 'Низкий',    cls: 'text-primary border-primary/30 bg-primary/[0.06]' },
}

const QUARTER_ICONS: Record<string, string> = {
  Q1: 'tune', Q2: 'group_add', Q3: 'auto_graph', Q4: 'flight_takeoff',
}

function gapColor(gap: number): string {
  if (gap >= 25) return 'from-error to-amber-400'
  if (gap >= 12) return 'from-amber-400 to-primary'
  return 'from-primary to-primary'
}

function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    if (v && typeof v === 'object') return v
    return { score: 0, status: 'critical', top_issues: [], recommendations: [] }
  }
  return {
    overall_score: Number(diag.overall_score ?? 0),
    health_index: Number(diag.health_index ?? 0),
    stage: (diag.stage as DiagnosticStage) ?? 'seed',
    blocks: {
      finance:    block('finance_score'),
      sales:      block('sales_score'),
      operations: block('operations_score'),
      marketing:  block('marketing_score'),
      strategy:   block('strategy_score'),
    },
    risks: (diag.risks as PointA['risks']) ?? [],
    insights: (diag.insights as PointA['insights']) ?? [],
    quick_wins: (diag.quick_wins as PointA['quick_wins']) ?? [],
    data_gaps: (diag.data_gaps as PointA['data_gaps']) ?? [],
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function PointBPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch survey + diagnostic via REST (RLS bypass)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  const answers: Record<string, unknown> = {}
  let diag: Record<string, unknown> | null = null

  if (user?.id) {
    try {
      const [diagRes, surveyRes] = await Promise.all([
        fetch(
          `${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${user.id}&order=calculated_at.desc&limit=1`,
          { headers, cache: 'no-store' },
        ),
        fetch(
          `${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${user.id}&select=question_key,answer`,
          { headers, cache: 'no-store' },
        ),
      ])
      if (diagRes.ok) {
        const rows = (await diagRes.json()) as Record<string, unknown>[]
        diag = rows?.[0] ?? null
      }
      if (surveyRes.ok) {
        const rows = (await surveyRes.json()) as Array<{ question_key: string; answer: { value?: unknown } | null }>
        for (const row of rows ?? []) {
          answers[row.question_key] = row.answer?.value ?? row.answer
        }
      }
    } catch {
      // missing data — handled below
    }
  }

  // If no data → empty state
  if (!diag || Object.keys(answers).length === 0) {
    return (
      <div className="space-y-8">
        <section>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Стратегия роста · Горизонт 12 месяцев
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
            Точка <span className="text-gradient">Б</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
            Целевое состояние бизнеса — куда мы движемся и каким путём.
          </p>
        </section>

        <section className="bg-surface-container-low border border-dashed border-white/[0.06] rounded-2xl p-12 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-3 block">
            flag
          </span>
          <p className="text-sm text-on-surface-variant mb-4">
            Точка Б рассчитывается из ваших ответов в анкете и Точки А.
          </p>
          <Link
            href="/client/onboarding"
            className="inline-flex items-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-sm px-5 py-2.5 rounded-xl transition-all"
          >
            <span className="material-symbols-outlined text-base">edit_note</span>
            Заполнить анкету
          </Link>
        </section>
      </div>
    )
  }

  const pointA = diagToPointA(diag)
  const pointB = calculatePointB(pointA, answers)

  const horizon = `${pointB.horizon_months} месяцев`

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Стратегия роста · Горизонт {horizon}
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Точка <span className="text-gradient">Б</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
          Целевое состояние через {horizon}. Рассчитано из текущей Точки А и ваших ответов в анкете.
        </p>
        {pointB.user_goals.goal_12months && (
          <p className="text-sm text-on-surface mt-3 max-w-2xl italic">
            «{pointB.user_goals.goal_12months}»
          </p>
        )}
      </section>

      {/* Target KPIs — computed from engine */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Целевые показатели</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {pointB.target_kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 group hover:border-primary/20 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                  {kpi.label}
                </p>
                <span className="text-[10px] font-mono text-primary/70">{kpi.unit}</span>
              </div>
              <div className="flex items-end gap-3 mb-1">
                <span className="text-2xl font-mono font-bold text-primary">{kpi.target}</span>
                <span className="text-xs text-on-surface-variant font-mono pb-0.5">цель</span>
              </div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-on-surface-variant font-mono">{kpi.current} сейчас</span>
                <span className="font-mono text-primary">{Math.max(0, Math.min(100, kpi.progress))}%</span>
              </div>
              <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary-fixed-dim rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(0, Math.min(100, kpi.progress))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Overall scores transformation */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Общий балл',  cur: pointA.overall_score,   tgt: pointB.target_overall_score },
          { label: 'Health Index', cur: pointA.health_index,    tgt: pointB.target_health_index },
          { label: 'Стадия',       cur: pointA.stage,           tgt: pointB.target_stage, isText: true },
        ].map((row) => (
          <div key={row.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">
              {row.label}
            </p>
            <div className="flex items-baseline gap-3">
              <span className="text-on-surface-variant line-through text-base font-mono">
                {row.isText ? String(row.cur).charAt(0).toUpperCase() + String(row.cur).slice(1) : row.cur}
              </span>
              <span className="material-symbols-outlined text-primary/60 text-base">arrow_forward</span>
              <span className="text-2xl font-mono font-bold text-primary">
                {row.isText ? String(row.tgt).charAt(0).toUpperCase() + String(row.tgt).slice(1) : row.tgt}
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* GAP analysis */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">GAP-анализ</h2>
        <div className="space-y-3">
          {pointB.gap_analysis.map((g) => {
            const style = PRIORITY_STYLE[g.priority] ?? PRIORITY_STYLE.low
            const pct = Math.round((g.current / Math.max(g.target, 1)) * 100)
            return (
              <div key={g.block} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-on-surface">{BLOCK_LABELS[g.block] ?? g.label}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase tracking-widest border rounded-md px-2 py-0.5 ${style.cls}`}>
                      {style.label}
                    </span>
                    <span className="text-[10px] font-mono text-on-surface-variant">{g.effort}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-on-surface-variant w-10 text-right">{g.current}</span>
                  <div className="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${gapColor(g.gap)} transition-all duration-700`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-primary w-10">{g.target}</span>
                  <span className="text-xs font-mono text-primary/80 w-10 text-right">+{g.gap}</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Quarterly Roadmap — computed */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Дорожная карта</h2>
        <p className="text-xs text-on-surface-variant mb-4 font-mono">
          Ключевые вехи на пути к Точке Б · ожидаемый прирост {Math.max(0, pointB.target_overall_score - pointA.overall_score)} баллов
        </p>
        <div className="relative pl-6">
          <div className="absolute left-2 top-1.5 bottom-1.5 w-px bg-gradient-to-b from-primary via-primary/40 to-transparent" />
          <div className="space-y-3">
            {pointB.roadmap.map((rm, idx) => (
              <div key={rm.quarter} className="relative">
                <div className={`absolute -left-[22px] top-3 w-3 h-3 rounded-full border-2 ${
                  idx === 0 ? 'border-primary bg-primary/30 animate-pulse' : 'border-primary/40 bg-surface-container'
                }`} />
                <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-1">
                        {rm.quarter} {idx === 0 ? '· Текущий' : ''}
                      </p>
                      <p className="text-sm font-bold text-on-surface">{rm.title}</p>
                    </div>
                    <span className="material-symbols-outlined text-base text-primary/60">
                      {QUARTER_ICONS[rm.quarter] ?? 'flag'}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant mb-3 font-mono">
                    Фокус: {rm.focus_blocks.map((b) => BLOCK_LABELS[b] ?? b).join(', ')} · цель {rm.target_overall} баллов
                  </p>
                  {rm.milestones.length > 0 && (
                    <ul className="space-y-1.5">
                      {rm.milestones.map((m, i) => (
                        <li key={i} className="text-xs text-on-surface flex items-start gap-2">
                          <span className="material-symbols-outlined text-primary/40 text-sm mt-0.5">check_circle</span>
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* User goals + pains from survey */}
      {(pointB.user_goals.goal_3years || pointB.user_goals.main_pain || pointB.user_goals.growth_blockers.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {pointB.user_goals.goal_3years && (
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-2">Цель на 3 года</p>
              <p className="text-sm text-on-surface">{pointB.user_goals.goal_3years}</p>
            </div>
          )}
          {pointB.user_goals.main_pain && (
            <div className="bg-error/[0.04] rounded-2xl border border-error/20 p-4">
              <p className="text-[10px] font-mono text-error/80 uppercase tracking-widest mb-2">Главная боль</p>
              <p className="text-sm text-on-surface">{pointB.user_goals.main_pain}</p>
            </div>
          )}
          {pointB.user_goals.growth_blockers.length > 0 && (
            <div className="bg-amber-400/[0.04] rounded-2xl border border-amber-400/20 p-4">
              <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-widest mb-2">Барьеры роста</p>
              <ul className="space-y-1">
                {pointB.user_goals.growth_blockers.map((b, i) => (
                  <li key={i} className="text-xs text-on-surface font-mono">• {b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
