'use client'

// Mirrors the real /client/point-a page so the expert sees the same sections
// as the client (hero gauge, AI summary, 5 blocks, priorities, risks, insights,
// quick wins, 30/90/180 roadmap, industry context) with every section wrapped
// in <Commentable>.

import { useEffect, useState } from 'react'
import { Commentable } from '@/components/expert/Commentable'

// Coerce any DB-returned value (number | string | null) to a safe display string
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
}
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface BlockDetail {
  score?: number
  status?: 'critical' | 'weak' | 'average' | 'strong' | 'excellent'
  top_issues?: string[]
  recommendations?: string[]
}

interface DiagRow {
  finance_score: number | null
  sales_score: number | null
  operations_score: number | null
  marketing_score: number | null
  strategy_score: number | null
  overall_score: number | null
  ai_analysis: {
    executive_summary?: string
    strategic_priorities?: Array<{ title: string; description?: string; impact?: string }>
    risks?: Array<{ level?: string; area?: string; title: string; description?: string }>
    insights?: Array<{ area?: string; title: string; description?: string }>
    quick_wins?: Array<{ action?: string; title: string; area?: string; timeline?: string }>
    growth_roadmap?: {
      '30_days'?: { goals?: string[]; actions?: string[] }
      '90_days'?: { goals?: string[]; actions?: string[] }
      '180_days'?: { goals?: string[]; actions?: string[] }
    }
    industry_context?: { description?: string }
    blocks?: Record<string, BlockDetail>
  } | null
}

interface Props {
  clientId: string
}

const BLOCKS: Array<{ id: 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy'; label: string; icon: string; scoreKey: keyof DiagRow }> = [
  { id: 'finance',    label: 'Финансы',   icon: 'payments',      scoreKey: 'finance_score' },
  { id: 'sales',      label: 'Продажи',   icon: 'trending_up',   scoreKey: 'sales_score' },
  { id: 'operations', label: 'Операции',  icon: 'settings',      scoreKey: 'operations_score' },
  { id: 'marketing',  label: 'Маркетинг', icon: 'campaign',      scoreKey: 'marketing_score' },
  { id: 'strategy',   label: 'Стратегия', icon: 'flag',          scoreKey: 'strategy_score' },
]

const STATUS_STYLE: Record<string, string> = {
  critical:  'bg-error/10 text-error border-error/20',
  weak:      'bg-error/10 text-error border-error/20',
  average:   'bg-amber-500/10 text-amber-300 border-amber-500/20',
  strong:    'bg-primary/10 text-primary border-primary/20',
  excellent: 'bg-primary/15 text-primary border-primary/30',
}

export function PointATab({ clientId }: Props) {
  const [diag, setDiag] = useState<DiagRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/expert/clients/${clientId}/dashboard`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: { diagnostic: DiagRow | null } }
        if (!cancelled) setDiag(json.data.diagnostic)
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
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }
  if (error) {
    return <p className="text-sm text-error">Не удалось загрузить Точку А: {error}</p>
  }

  const ai = diag?.ai_analysis ?? null

  return (
    <div className="space-y-6">
      {/* Hero — overall score gauge + title */}
      <Commentable targetId="pointa:hero:gauge">
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 flex items-center gap-6">
          <div className="relative w-28 h-28 flex-shrink-0">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              <circle
                cx="80" cy="80" r="64" fill="none" stroke="#6effc0" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 64 * (toNumber(diag?.overall_score) / 10)} ${2 * Math.PI * 64}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-mono font-bold text-primary">
                {fmt(diag?.overall_score)}
              </span>
              <span className="text-[9px] font-mono text-on-surface-variant">/ 10</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-primary/70 mb-1">
              Индекс готовности к росту
            </p>
            <h2 className="font-headline text-2xl font-extrabold text-on-surface">
              Точка А
            </h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Стартовая оценка по 5 направлениям
            </p>
          </div>
        </section>
      </Commentable>

      {/* AI Executive Summary */}
      <Commentable targetId="pointa:ai:executiveSummary">
        <Card title="AI-анализ вашего бизнеса" icon="psychology">
          {ai?.executive_summary ? (
            <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">
              {ai.executive_summary}
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant italic">Анализ ещё не сгенерирован</p>
          )}
        </Card>
      </Commentable>

      {/* 5 Blocks */}
      <section>
        <h3 className="font-headline text-base font-bold text-on-surface mb-3">
          Блоки оценки · 5 направлений
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {BLOCKS.map((b) => {
            const score = diag?.[b.scoreKey] as number | null | undefined
            const detail = ai?.blocks?.[b.id]
            return (
              <Commentable key={b.id} targetId={b.id}>
                <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary/70 text-xl">{b.icon}</span>
                      <h4 className="font-headline text-base font-bold text-on-surface">{b.label}</h4>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-mono font-bold text-on-surface leading-none">
                        {fmt(score)}
                      </p>
                      {detail?.status && (
                        <span className={`inline-block mt-1 text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLE[detail.status] ?? ''}`}>
                          {detail.status}
                        </span>
                      )}
                    </div>
                  </div>
                  {detail?.top_issues && detail.top_issues.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] font-mono uppercase text-error/80 mb-1">Проблемы</p>
                      <ul className="space-y-0.5">
                        {detail.top_issues.slice(0, 3).map((issue, i) => (
                          <li key={i} className="text-xs text-on-surface">• {issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {detail?.recommendations && detail.recommendations.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] font-mono uppercase text-primary/80 mb-1">Рекомендации</p>
                      <ul className="space-y-0.5">
                        {detail.recommendations.slice(0, 3).map((rec, i) => (
                          <li key={i} className="text-xs text-on-surface">• {rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Commentable>
            )
          })}
        </div>
      </section>

      {/* Priorities */}
      <Commentable targetId="pointa:priorities:section">
        <Card title="Стратегические приоритеты" icon="flag">
          <ListOrEmpty items={ai?.strategic_priorities} />
        </Card>
      </Commentable>

      {/* Risks / Insights / Quick Wins */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Commentable targetId="pointa:risks:section">
          <Card title="Риски" icon="warning" tone="error">
            <ListOrEmpty items={ai?.risks} />
          </Card>
        </Commentable>
        <Commentable targetId="pointa:insights:section">
          <Card title="Инсайты" icon="lightbulb">
            <ListOrEmpty items={ai?.insights} />
          </Card>
        </Commentable>
        <Commentable targetId="pointa:quickWins:section">
          <Card title="Быстрые победы" icon="bolt">
            <ListOrEmpty items={ai?.quick_wins} />
          </Card>
        </Commentable>
      </div>

      {/* Growth Roadmap */}
      <section>
        <h3 className="font-headline text-base font-bold text-on-surface mb-3">
          Дорожная карта роста
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Commentable targetId="pointa:roadmap:30d">
            <Card title="30 дней" icon="event">
              <RoadmapBlock data={ai?.growth_roadmap?.['30_days']} />
            </Card>
          </Commentable>
          <Commentable targetId="pointa:roadmap:90d">
            <Card title="90 дней" icon="event">
              <RoadmapBlock data={ai?.growth_roadmap?.['90_days']} />
            </Card>
          </Commentable>
          <Commentable targetId="pointa:roadmap:180d">
            <Card title="180 дней" icon="event">
              <RoadmapBlock data={ai?.growth_roadmap?.['180_days']} />
            </Card>
          </Commentable>
        </div>
      </section>

      {/* Industry Context */}
      <Commentable targetId="pointa:industryContext">
        <Card title="Отраслевой контекст" icon="business">
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
    <div className={`rounded-2xl border ${toneCls} p-5 h-full`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-primary/70 text-lg">{icon}</span>
        <h3 className="font-headline text-sm font-bold text-on-surface">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function ListOrEmpty({ items }: { items?: Array<{ title: string; description?: string }> | null }) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-on-surface-variant italic">Нет данных</p>
  }
  return (
    <ul className="space-y-2">
      {items.slice(0, 5).map((item, i) => (
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
            {data.goals.slice(0, 3).map((g, i) => <li key={i} className="text-xs">• {g}</li>)}
          </ul>
        </div>
      )}
      {data.actions && data.actions.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase text-primary/70 mb-1">Действия</p>
          <ul className="space-y-0.5 text-on-surface">
            {data.actions.slice(0, 3).map((a, i) => <li key={i} className="text-xs">• {a}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
