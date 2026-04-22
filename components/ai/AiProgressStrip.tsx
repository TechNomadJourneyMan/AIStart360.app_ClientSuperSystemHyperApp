'use client'

/**
 * AiProgressStrip — shows the status of an ai_runs row in real-time.
 *
 * - If runId is passed, subscribes to Supabase Realtime changes on that row.
 * - Polls once on mount to get the current state.
 * - Auto-hides after run completes (2s delay so user can see "готово").
 *
 * Usage:
 *   <AiProgressStrip runId={ai_run_id} />
 *
 * State:
 *   running  → спиннер + "AI анализирует..."
 *   completed → зелёная галочка + "готово" (исчезает 2 сек)
 *   failed   → красная иконка + error + кнопка "повторить"
 *   partial  → жёлтая иконка + "частично"
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, XCircle, AlertCircle } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type RunStatus = 'running' | 'completed' | 'failed' | 'partial'

interface AiRunRow {
  id: string
  status: RunStatus
  trigger: string
  steps: Array<{ name: string; status: string; duration_ms?: number }>
  total_cost_usd: number | null
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface AiProgressStripProps {
  runId: string
  className?: string
  /** Called on terminal state. Use to refresh dashboard data. */
  onFinished?: (row: AiRunRow) => void
}

export function AiProgressStrip({ runId, className, onFinished }: AiProgressStripProps) {
  const [row, setRow] = useState<AiRunRow | null>(null)
  const [hidden, setHidden] = useState(false)

  // Initial fetch + Realtime subscription
  useEffect(() => {
    const sb = createClient()
    let active = true

    // Initial fetch
    void (async () => {
      const res = await fetch(`/api/v1/ai-runs/${runId}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      if (!active) return
      if (json?.data) setRow(json.data as AiRunRow)
    })()

    // Realtime subscription
    const channel = sb
      .channel(`ai_runs_${runId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_runs',
          filter: `id=eq.${runId}`,
        },
        (payload) => {
          if (!active) return
          const next = payload.new as unknown as AiRunRow
          setRow(next)
          if (next.status !== 'running') onFinished?.(next)
        }
      )
      .subscribe()

    return () => {
      active = false
      void sb.removeChannel(channel)
    }
  }, [runId, onFinished])

  // Auto-hide on completion (2s grace)
  useEffect(() => {
    if (row?.status === 'completed') {
      const timer = setTimeout(() => setHidden(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [row?.status])

  if (hidden || !row) return null

  const lastStep = row.steps?.[row.steps.length - 1]
  const currentStepLabel = lastStep?.name?.replace(/-/g, ' ') ?? 'инициализация'

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2 rounded-lg border',
        'text-xs font-mono',
        row.status === 'running' && 'bg-primary/5 border-primary/20 text-primary',
        row.status === 'completed' && 'bg-primary/10 border-primary/30 text-primary',
        row.status === 'failed' && 'bg-error/10 border-error/30 text-error',
        row.status === 'partial' && 'bg-tertiary-container/10 border-tertiary-container/30 text-tertiary-container',
        className
      )}
    >
      {row.status === 'running' && (
        <>
          <Loader2 size={14} className="animate-spin shrink-0" />
          <span className="uppercase tracking-wider">AI анализирует: {currentStepLabel}</span>
          <span className="opacity-60 ml-auto">
            {row.steps?.length ?? 0} шаг{pluralRu(row.steps?.length ?? 0)}
          </span>
        </>
      )}

      {row.status === 'completed' && (
        <>
          <CheckCircle2 size={14} className="shrink-0" />
          <span className="uppercase tracking-wider">Готово</span>
          {row.total_cost_usd != null && (
            <span className="opacity-60 ml-auto">${row.total_cost_usd.toFixed(4)}</span>
          )}
        </>
      )}

      {row.status === 'failed' && (
        <>
          <XCircle size={14} className="shrink-0" />
          <span className="uppercase tracking-wider">Ошибка</span>
          {row.error && <span className="opacity-70 truncate max-w-md">{row.error}</span>}
          <button
            type="button"
            onClick={() => retryRun(row.id)}
            className="ml-auto px-2 py-0.5 rounded border border-error/30 hover:bg-error/20"
          >
            Повторить
          </button>
        </>
      )}

      {row.status === 'partial' && (
        <>
          <AlertCircle size={14} className="shrink-0" />
          <span className="uppercase tracking-wider">Частично</span>
          <span className="opacity-70 ml-auto">
            {row.steps?.filter((s) => s.status === 'completed').length}/{row.steps?.length}
          </span>
        </>
      )}
    </div>
  )
}

function pluralRu(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'ов'
  if (mod10 === 1) return ''
  if (mod10 >= 2 && mod10 <= 4) return 'а'
  return 'ов'
}

async function retryRun(runId: string): Promise<void> {
  await fetch(`/api/v1/diagnostics/retry-ai?run_id=${runId}`, { method: 'POST' })
}
