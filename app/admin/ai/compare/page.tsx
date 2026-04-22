'use client'

/**
 * /admin/ai/compare — side-by-side metrics for inngest vs n8n backbones.
 *
 * Loads last 7 days by default. Admin-only (gated by the compare endpoint).
 *
 * Shows:
 *   - Winner banner (or "tie" / "not enough data")
 *   - Per-backbone cards: runs, status split, failure rate, latency,
 *     cost, trigger breakdown, step success rate heatmap
 */

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

type Backbone = 'inngest' | 'n8n' | 'inline'
type Status = 'running' | 'completed' | 'failed' | 'partial'

interface BackboneMetrics {
  backbone: Backbone
  total: number
  status: Record<Status, number>
  failureRate: number
  triggers: Record<string, number>
  latency: {
    avgMs: number | null
    p50Ms: number | null
    p95Ms: number | null
  }
  cost: {
    totalUsd: number
    avgUsd: number | null
  }
  steps: Record<string, { completed: number; failed: number; skipped: number }>
}

interface CompareData {
  since: string
  until: string
  backbones: BackboneMetrics[]
  summary: {
    totalRuns: number
    winnerBackbone: Backbone | null
    winnerReason: string
  }
}

const BACKBONE_COLOR: Record<Backbone, string> = {
  inngest: 'border-primary/30 bg-primary/5',
  n8n:     'border-secondary/30 bg-secondary/5',
  inline:  'border-outline-variant bg-surface-container',
}

export default function BackboneComparePage() {
  const [data, setData] = useState<CompareData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const res = await fetch('/api/v1/admin/ai/compare', { cache: 'no-store' })
        const json = await res.json()
        if (!active) return
        if (!json?.ok) {
          setError(json?.error ?? 'unknown error')
        } else {
          setData(json.data as CompareData)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <div className="p-6 font-mono text-sm text-on-surface-variant">Загрузка метрик...</div>
  }
  if (error || !data) {
    return <div className="p-6 font-mono text-sm text-error">Ошибка: {error ?? 'нет данных'}</div>
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">Сравнение async-backbones</h1>
        <p className="text-sm text-on-surface-variant mt-1 font-mono">
          {formatDateRange(data.since, data.until)} · {data.summary.totalRuns.toLocaleString('ru-RU')} runs всего
        </p>
      </div>

      <WinnerBanner summary={data.summary} />

      {data.backbones.length === 0 ? (
        <div className="rounded-xl border border-outline-variant p-8 text-center">
          <p className="text-sm text-on-surface-variant">
            Нет runs за период. Загрузите тестовые файлы на оба preview.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.backbones
            .filter((b) => b.backbone !== 'inline')
            .map((b) => (
              <BackboneCard key={b.backbone} m={b} isWinner={b.backbone === data.summary.winnerBackbone} />
            ))}
        </div>
      )}

      {data.backbones.some((b) => b.backbone === 'inline') && (
        <div className="rounded-xl border border-outline-variant p-4">
          <p className="text-xs text-on-surface-variant font-mono mb-2">
            Inline (dev / foundation branch) — справочно, не участвует в сравнении
          </p>
          {data.backbones
            .filter((b) => b.backbone === 'inline')
            .map((b) => (
              <InlineSummary key="inline" m={b} />
            ))}
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------

function WinnerBanner({ summary }: { summary: CompareData['summary'] }) {
  if (summary.winnerBackbone) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary/10 p-5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-primary mb-1">
          Winner
        </p>
        <p className="text-2xl font-semibold text-primary">{summary.winnerBackbone}</p>
        <p className="text-xs text-primary/80 mt-1 font-mono">{summary.winnerReason}</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container p-5">
      <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-1">
        Результат
      </p>
      <p className="text-sm text-on-surface">{summary.winnerReason}</p>
    </div>
  )
}

function BackboneCard({ m, isWinner }: { m: BackboneMetrics; isWinner: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-5 space-y-4',
        BACKBONE_COLOR[m.backbone],
        isWinner && 'ring-2 ring-primary/40'
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold uppercase tracking-wider">{m.backbone}</h2>
        {isWinner && (
          <span className="px-2 py-0.5 rounded-full bg-primary text-on-primary text-[10px] font-mono uppercase tracking-wider">
            winner
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Всего runs" value={m.total.toLocaleString('ru-RU')} />
        <Stat
          label="Failure rate"
          value={`${(m.failureRate * 100).toFixed(1)}%`}
          warn={m.failureRate > 0.1}
          err={m.failureRate > 0.25}
        />
        <Stat label="p50 latency" value={formatMs(m.latency.p50Ms)} />
        <Stat label="p95 latency" value={formatMs(m.latency.p95Ms)} />
        <Stat label="avg cost" value={m.cost.avgUsd != null ? `$${m.cost.avgUsd.toFixed(4)}` : '—'} />
        <Stat label="total cost" value={`$${m.cost.totalUsd.toFixed(2)}`} />
      </div>

      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider text-current/70 mb-2">Статус</p>
        <div className="flex items-center gap-2 text-xs font-mono">
          <StatusChip label="completed" count={m.status.completed} color="bg-primary/20 text-primary" />
          <StatusChip label="failed" count={m.status.failed} color="bg-error/20 text-error" />
          <StatusChip label="partial" count={m.status.partial} color="bg-tertiary-container/20 text-tertiary-container" />
          <StatusChip label="running" count={m.status.running} color="bg-secondary/20 text-secondary" />
        </div>
      </div>

      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider text-current/70 mb-2">
          Триггеры
        </p>
        <div className="space-y-1">
          {Object.entries(m.triggers).map(([trigger, count]) => (
            <div key={trigger} className="flex items-center justify-between text-xs font-mono">
              <span className="text-current/80">{trigger}</span>
              <span className="tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider text-current/70 mb-2">
          Шаги (success / failed)
        </p>
        <div className="space-y-1">
          {Object.entries(m.steps)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([step, counts]) => {
              const total = counts.completed + counts.failed + counts.skipped
              const ok = total > 0 ? counts.completed / total : 0
              return (
                <div key={step} className="text-xs font-mono">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-current/80">{step}</span>
                    <span className="tabular-nums">
                      {counts.completed} / {counts.failed}
                      {counts.skipped > 0 && ` · skip ${counts.skipped}`}
                    </span>
                  </div>
                  <div className="h-1 rounded bg-current/10 overflow-hidden">
                    <div
                      className={cn(
                        'h-full',
                        ok >= 0.95 ? 'bg-primary' : ok >= 0.8 ? 'bg-tertiary-container' : 'bg-error'
                      )}
                      style={{ width: `${Math.round(ok * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

function InlineSummary({ m }: { m: BackboneMetrics }) {
  return (
    <div className="flex items-center gap-4 text-xs font-mono text-on-surface-variant">
      <span>{m.total} runs</span>
      <span>failure {(m.failureRate * 100).toFixed(1)}%</span>
      <span>p50 {formatMs(m.latency.p50Ms)}</span>
      <span>p95 {formatMs(m.latency.p95Ms)}</span>
      <span>avg ${m.cost.avgUsd?.toFixed(4) ?? '—'}</span>
    </div>
  )
}

function Stat({
  label,
  value,
  warn,
  err,
}: {
  label: string
  value: string
  warn?: boolean
  err?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-current/70">{label}</p>
      <p
        className={cn(
          'text-lg font-mono font-semibold tabular-nums',
          err ? 'text-error' : warn ? 'text-tertiary-container' : 'text-current'
        )}
      >
        {value}
      </p>
    </div>
  )
}

function StatusChip({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null
  return (
    <span className={cn('px-2 py-0.5 rounded-full font-mono text-[10px] uppercase tracking-wider', color)}>
      {label} {count}
    </span>
  )
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatDateRange(sinceIso: string, untilIso: string): string {
  const s = new Date(sinceIso)
  const u = new Date(untilIso)
  return `${s.toLocaleDateString('ru-RU')} — ${u.toLocaleDateString('ru-RU')}`
}
