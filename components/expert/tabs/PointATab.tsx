'use client'

// Expert view of Point A: 5 main blocks as commentable cards.
// Reuses the same /api/expert/clients/[id]/dashboard endpoint since block
// scores live on the diagnostics row.

import { useEffect, useState } from 'react'
import { Commentable } from '@/components/expert/Commentable'

interface DiagRow {
  finance_score: number | null
  sales_score: number | null
  operations_score: number | null
  marketing_score: number | null
  strategy_score: number | null
  ai_analysis: {
    blocks?: Record<
      'finance' | 'sales' | 'operations' | 'marketing' | 'strategy',
      { score?: number; status?: string; top_issues?: string[]; recommendations?: string[] }
    >
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
  critical:   'bg-error/10 text-error border-error/20',
  weak:       'bg-error/10 text-error border-error/20',
  average:    'bg-amber-500/10 text-amber-300 border-amber-500/20',
  strong:     'bg-primary/10 text-primary border-primary/20',
  excellent:  'bg-primary/15 text-primary border-primary/30',
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-40 rounded-2xl bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-error">Не удалось загрузить Точку А: {error}</p>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {BLOCKS.map((b) => {
        const score = diag?.[b.scoreKey] as number | null | undefined
        const detail = diag?.ai_analysis?.blocks?.[b.id]
        return (
          <Commentable key={b.id} targetId={b.id}>
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary/70 text-xl">{b.icon}</span>
                  <h3 className="font-headline text-base font-bold text-on-surface">{b.label}</h3>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-mono font-bold text-on-surface leading-none">
                    {score !== null && score !== undefined ? score.toFixed(1) : '—'}
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
  )
}
