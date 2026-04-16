'use client'

// Expert view of GRI: 7 categories with expandable sub-factors. Each category
// and each sub-factor gets its own <Commentable> wrapper (42 targets total).

import { useEffect, useState } from 'react'
import { Commentable } from '@/components/expert/Commentable'
import { CATEGORIES, SUB_FACTORS } from '@/lib/gri-calculator/gri-data'

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
}
function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface GRIData {
  reportId: string | null
  overall: number
  categoryScores: Record<string, number>
  lastCalculatedAt: string | null
}

interface Props {
  clientId: string
}

// Mirror of slugifyCategory from lib/comment-targets.ts
function slugifyCategory(cat: string): string {
  return cat
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function categoryTargetId(cat: string): string {
  return `gri:category:${slugifyCategory(cat)}`
}

function subFactorTargetId(subId: string): string {
  return `gri:sub:${subId}`
}

function scoreColor(score: number): string {
  if (score >= 7) return 'text-primary'
  if (score >= 4) return 'text-amber-300'
  return 'text-error'
}

export function GRITab({ clientId }: Props) {
  const [data, setData] = useState<GRIData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/expert/clients/${clientId}/gri`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: GRIData }
        if (!cancelled) setData(json.data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  const toggleExpand = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-surface-container animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-error">Не удалось загрузить GRI: {error}</p>
  }

  return (
    <div className="space-y-6">
      {/* Overall score header */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            GRI общий балл
          </p>
          <p className="text-4xl font-mono font-bold text-primary mt-1">
            {fmt(data?.overall)}
          </p>
          {data?.lastCalculatedAt && (
            <p className="text-[10px] text-on-surface-variant mt-1">
              Обновлён {new Date(data.lastCalculatedAt).toLocaleDateString('ru-RU')}
            </p>
          )}
        </div>
        <span className="material-symbols-outlined text-5xl text-primary/40">target</span>
      </div>

      {/* Categories */}
      <div className="space-y-3">
        {CATEGORIES.map((cat) => {
          const score = toNum(data?.categoryScores[cat])
          const isExpanded = expanded.has(cat)
          const subs = SUB_FACTORS[cat] ?? []

          return (
            <div key={cat} className="rounded-2xl border border-white/[0.06] bg-surface-container-low overflow-hidden">
              <Commentable targetId={categoryTargetId(cat)}>
                <button
                  onClick={() => toggleExpand(cat)}
                  className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="material-symbols-outlined text-on-surface-variant/70">
                      {isExpanded ? 'expand_less' : 'expand_more'}
                    </span>
                    <h3 className="font-headline text-base font-bold text-on-surface truncate">
                      {cat}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xl font-mono font-bold ${scoreColor(score)}`}>
                      {score.toFixed(1)}
                    </span>
                    <span className="text-[10px] font-mono text-on-surface-variant">
                      / 10
                    </span>
                  </div>
                </button>
              </Commentable>

              {isExpanded && subs.length > 0 && (
                <div className="border-t border-white/[0.04] px-5 py-3 space-y-2 bg-surface-container/50">
                  {subs.map((sf) => (
                    <Commentable key={sf.id} targetId={subFactorTargetId(sf.id)}>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-container-low border border-white/[0.04]">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant/60">
                          subdirectory_arrow_right
                        </span>
                        <p className="text-sm text-on-surface flex-1 min-w-0">{sf.ru}</p>
                        <span className="text-[10px] font-mono text-on-surface-variant/60 flex-shrink-0">
                          {sf.id}
                        </span>
                      </div>
                    </Commentable>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
