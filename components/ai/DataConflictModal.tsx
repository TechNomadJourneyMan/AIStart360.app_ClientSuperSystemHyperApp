'use client'

/**
 * DataConflictModal — lets the company owner resolve an ai_conflicts row
 * by picking one of the contenders as the winner.
 *
 * Takes a single conflict with its contenders array and POSTs to
 * /api/v1/ai-conflicts/:id/resolve with the chosen winnerId.
 */

import { useState } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface ConflictContender {
  extraction_id: string
  value: unknown
  confidence: number
  source_type: 'document' | 'survey' | 'calculated'
  extractor_name: string
  priority_score: number
}

export interface ConflictRow {
  id: string
  entity_type: string
  period_year: number | null
  period_quarter: string | null
  resolution: 'auto' | 'manual' | 'pending'
  contenders: ConflictContender[]
}

export interface DataConflictModalProps {
  conflict: ConflictRow
  open: boolean
  onClose: () => void
  onResolved?: (winnerId: string) => void
}

export function DataConflictModal({ conflict, open, onClose, onResolved }: DataConflictModalProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const entityLabel = humanizeEntityType(conflict.entity_type)
  const periodLabel = formatPeriod(conflict.period_year, conflict.period_quarter)

  const handleResolve = async () => {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/ai-conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId: selected }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status}: ${text.slice(0, 200)}`)
      }
      onResolved?.(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-outline-variant shadow-xl">
        <div className="flex items-start justify-between p-5 border-b border-outline-variant">
          <div>
            <h2 className="text-base font-semibold text-on-surface">Разрешить расхождение</h2>
            <p className="text-xs text-on-surface-variant mt-1 font-mono">
              {entityLabel}
              {periodLabel && <span className="ml-2 opacity-70">· {periodLabel}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-on-surface-variant">
            Несколько источников сообщают разные значения. Выберите, какое использовать.
          </p>

          {conflict.contenders.map((c) => (
            <button
              key={c.extraction_id}
              type="button"
              onClick={() => setSelected(c.extraction_id)}
              className={cn(
                'w-full text-left px-4 py-3 rounded-lg border transition-colors',
                'hover:bg-surface-container',
                selected === c.extraction_id
                  ? 'bg-primary/5 border-primary/40'
                  : 'bg-surface border-outline-variant'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-sm text-on-surface">
                  {formatValue(c.value)}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                  {c.source_type}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-on-surface-variant font-mono">
                <span>{Math.round(c.confidence * 100)}% confidence</span>
                <span className="opacity-70">·</span>
                <span>{c.extractor_name}</span>
                <span className="opacity-70">·</span>
                <span>score {c.priority_score.toFixed(2)}</span>
              </div>
            </button>
          ))}

          {error && <p className="text-xs text-error">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-outline-variant">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs uppercase tracking-wider rounded-lg text-on-surface-variant hover:bg-surface-container"
          >
            Отмена
          </button>
          <button
            onClick={handleResolve}
            disabled={!selected || loading}
            className={cn(
              'px-4 py-2 text-xs uppercase tracking-wider rounded-lg',
              'bg-primary text-on-primary',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {loading ? 'Сохранение...' : 'Выбрать'}
          </button>
        </div>
      </div>
    </div>
  )
}

function humanizeEntityType(t: string): string {
  const parts = t.split('.')
  if (parts.length === 2) {
    const [kind, key] = parts
    return `${kind === 'metric' ? 'Метрика' : 'Значение'}: ${key.replace(/_/g, ' ')}`
  }
  return t
}

function formatPeriod(year: number | null, quarter: string | null): string {
  if (!year) return ''
  if (quarter) return `${quarter} ${year}`
  return String(year)
}

function formatValue(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString('ru-RU')
  if (typeof v === 'string') return v
  if (v == null) return '—'
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
