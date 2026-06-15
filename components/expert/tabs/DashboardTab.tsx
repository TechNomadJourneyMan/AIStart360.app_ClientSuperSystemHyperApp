'use client'

// Expert view of the client's dashboard. Mirrors app/client/dashboard/page.tsx
// in structure (radar+KPIs, AI summary, block scores, priorities, risks,
// insights, quick wins, roadmap, industry) but in compact form, with every
// section wrapped in <Commentable> so the expert can leave targeted advice.

import { useEffect, useState } from 'react'
import { Commentable } from '@/components/expert/Commentable'

interface DashboardData {
  diagnostic: {
    overall_score: number | null
    finance_score: number | null
    sales_score: number | null
    operations_score: number | null
    marketing_score: number | null
    strategy_score: number | null
    ai_analysis: {
      executive_summary?: string
      strategic_priorities?: Array<{ title: string; description?: string; impact?: string }>
      risks?: Array<{ title: string; description?: string; severity?: string }>
      insights?: Array<{ title: string; description?: string }>
      quick_wins?: Array<{ title: string; description?: string }>
      growth_roadmap?: {
        '30_days'?: { goals?: string[]; actions?: string[] }
        '90_days'?: { goals?: string[]; actions?: string[] }
        '180_days'?: { goals?: string[]; actions?: string[] }
      }
      industry_context?: { description?: string; benchmarks?: unknown }
    } | null
  } | null
  company: {
    name: string | null
    industry: string | null
    stage: string | null
  } | null
  profile: {
    full_name: string | null
    email: string | null
  } | null
}

interface Props {
  clientId: string
}

export function DashboardTab({ clientId }: Props) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/expert/clients/${clientId}/dashboard`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: DashboardData }
        if (!cancelled) setData(json.data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-error">Не удалось загрузить дэшборд: {error}</p>
  }

  const diag = data?.diagnostic ?? null
  const ai = diag?.ai_analysis ?? null

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Commentable targetId="dashboard:kpi:overallScore">
          <KpiCard label="Overall Score" value={formatScore(diag?.overall_score)} icon="trending_up" />
        </Commentable>
        <Commentable targetId="dashboard:kpi:healthIndex">
          <KpiCard label="Health Index" value={formatScore(diag?.overall_score)} icon="favorite" />
        </Commentable>
        <Commentable targetId="dashboard:kpi:documents">
          <KpiCard label="Документы" value={data?.company?.industry ?? '—'} icon="description" />
        </Commentable>
      </section>

      {/* AI Executive Summary */}
      <Commentable targetId="dashboard:ai:executiveSummary">
        <Card title="AI Executive Summary" icon="psychology">
          {ai?.executive_summary ? (
            <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
              {ai.executive_summary}
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant italic">Анализ ещё не сгенерирован</p>
          )}
        </Card>
      </Commentable>

      {/* 5 Point A blocks */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <BlockScoreCard targetId="finance"    label="Финансы"   score={diag?.finance_score} />
        <BlockScoreCard targetId="sales"      label="Продажи"   score={diag?.sales_score} />
        <BlockScoreCard targetId="operations" label="Операции"  score={diag?.operations_score} />
        <BlockScoreCard targetId="marketing"  label="Маркетинг" score={diag?.marketing_score} />
        <BlockScoreCard targetId="strategy"   label="Стратегия" score={diag?.strategy_score} />
      </section>

      {/* Strategic Priorities */}
      <Commentable targetId="dashboard:priorities:section">
        <Card title="Стратегические приоритеты" icon="flag">
          <ListOrEmpty items={ai?.strategic_priorities} />
        </Card>
      </Commentable>

      {/* Risks / Insights / Quick Wins */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Commentable targetId="dashboard:risks:section">
          <Card title="Риски" icon="warning" tone="error">
            <ListOrEmpty items={ai?.risks} />
          </Card>
        </Commentable>
        <Commentable targetId="dashboard:insights:section">
          <Card title="Insights" icon="lightbulb">
            <ListOrEmpty items={ai?.insights} />
          </Card>
        </Commentable>
        <Commentable targetId="dashboard:quickWins:section">
          <Card title="Quick Wins" icon="bolt">
            <ListOrEmpty items={ai?.quick_wins} />
          </Card>
        </Commentable>
      </div>

      {/* Growth Roadmap */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Commentable targetId="dashboard:roadmap:30d">
          <Card title="Roadmap: 30 дней" icon="event">
            <RoadmapBlock data={ai?.growth_roadmap?.['30_days']} />
          </Card>
        </Commentable>
        <Commentable targetId="dashboard:roadmap:90d">
          <Card title="Roadmap: 90 дней" icon="event">
            <RoadmapBlock data={ai?.growth_roadmap?.['90_days']} />
          </Card>
        </Commentable>
        <Commentable targetId="dashboard:roadmap:180d">
          <Card title="Roadmap: 180 дней" icon="event">
            <RoadmapBlock data={ai?.growth_roadmap?.['180_days']} />
          </Card>
        </Commentable>
      </div>

      {/* Industry Context */}
      <Commentable targetId="dashboard:industryContext">
        <Card title="Industry Context" icon="business">
          {ai?.industry_context?.description ? (
            <p className="text-sm text-on-surface leading-relaxed">
              {ai.industry_context.description}
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant italic">Нет данных</p>
          )}
        </Card>
      </Commentable>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatScore(s: unknown): string {
  if (s === null || s === undefined || s === '') return '—'
  const n = typeof s === 'number' ? s : Number(s)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
}

function KpiCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">{label}</span>
        <span className="material-symbols-outlined text-base text-primary/60">{icon}</span>
      </div>
      <p className="text-2xl font-mono font-bold text-on-surface">{value}</p>
    </div>
  )
}

function Card({
  title,
  icon,
  tone = 'default',
  children,
}: {
  title: string
  icon: string
  tone?: 'default' | 'error'
  children: React.ReactNode
}) {
  const toneCls = tone === 'error' ? 'border-error/20 bg-error/5' : 'border-white/[0.06] bg-surface-container-low'
  return (
    <div className={`rounded-2xl border ${toneCls} p-5`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-primary/70 text-lg">{icon}</span>
        <h3 className="font-headline text-sm font-bold text-on-surface">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function BlockScoreCard({
  targetId,
  label,
  score,
}: {
  targetId: string
  label: string
  score: number | null | undefined
}) {
  return (
    <Commentable targetId={targetId}>
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-2">
          {label}
        </p>
        <p className="text-2xl font-mono font-bold text-on-surface">{formatScore(score)}</p>
      </div>
    </Commentable>
  )
}

function ListOrEmpty({ items }: { items?: Array<{ title: string; description?: string }> | null }) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-on-surface-variant italic">Нет данных</p>
  }
  return (
    <ul className="space-y-2">
      {items.slice(0, 4).map((item, i) => (
        <li key={i} className="text-sm text-on-surface">
          <span className="font-medium">{item.title}</span>
          {item.description && (
            <p className="text-xs text-on-surface-variant mt-0.5">{item.description}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

function RoadmapBlock({ data }: { data?: { goals?: string[]; actions?: string[] } }) {
  if (!data || (!data.goals?.length && !data.actions?.length)) {
    return <p className="text-xs text-on-surface-variant italic">Нет плана</p>
  }
  return (
    <div className="space-y-2 text-sm">
      {data.goals && data.goals.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase text-primary/70 mb-1">Цели</p>
          <ul className="space-y-0.5 text-on-surface">
            {data.goals.slice(0, 3).map((g, i) => (
              <li key={i} className="text-xs">• {g}</li>
            ))}
          </ul>
        </div>
      )}
      {data.actions && data.actions.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase text-primary/70 mb-1">Действия</p>
          <ul className="space-y-0.5 text-on-surface">
            {data.actions.slice(0, 3).map((a, i) => (
              <li key={i} className="text-xs">• {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
