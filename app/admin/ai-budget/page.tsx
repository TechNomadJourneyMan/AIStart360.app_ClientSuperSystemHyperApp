'use client'

/**
 * /admin/ai-budget — admin-only AI spend dashboard.
 *
 * Shows:
 *   - Today's spend (USD) vs. daily limit
 *   - Utilization bar
 *   - Warning banner when >= 90%
 *   - Blocked state when >= 100%
 */

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

interface BudgetState {
  since: string
  spent_usd: number
  limit_usd: number
  blocked: boolean
  utilization: number
}

export default function AiBudgetPage() {
  const [state, setState] = useState<BudgetState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const tick = async () => {
      const res = await fetch('/api/v1/admin/ai/budget', { cache: 'no-store' })
      if (!active) return
      const json = await res.json()
      if (json?.ok) setState(json.data)
      else setError(json?.error ?? 'unknown error')
      setLoading(false)
    }
    void tick()
    // Refresh every 60s
    const interval = setInterval(tick, 60_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (loading) {
    return <div className="p-6 font-mono text-sm text-on-surface-variant">Загрузка...</div>
  }
  if (error || !state) {
    return <div className="p-6 font-mono text-sm text-error">Ошибка: {error ?? 'нет данных'}</div>
  }

  const pct = Math.round(state.utilization * 100)
  const warn = pct >= 90
  const blocked = state.blocked

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">AI бюджет</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Сегодняшний расход на Claude + OpenAI (UTC-календарный день).
        </p>
      </div>

      {blocked && (
        <div className="rounded-xl border border-error/40 bg-error/10 p-4">
          <p className="text-sm font-semibold text-error">Бюджет исчерпан</p>
          <p className="text-xs text-error/80 mt-1 font-mono">
            Новые orchestrate() вызовы блокируются до UTC 00:00.
          </p>
        </div>
      )}
      {warn && !blocked && (
        <div className="rounded-xl border border-tertiary-container/40 bg-tertiary-container/10 p-4">
          <p className="text-sm font-semibold text-tertiary-container">Предупреждение</p>
          <p className="text-xs text-tertiary-container/80 mt-1 font-mono">
            Использовано {pct}% дневного лимита.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-outline-variant p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
              Потрачено сегодня
            </p>
            <p className="text-3xl font-mono font-bold text-on-surface tabular-nums">
              ${state.spent_usd.toFixed(4)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
              Лимит
            </p>
            <p className="text-xl font-mono text-on-surface-variant tabular-nums">
              ${state.limit_usd.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="h-2 rounded-full bg-surface-container overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                blocked
                  ? 'bg-error'
                  : warn
                    ? 'bg-tertiary-container'
                    : 'bg-primary'
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="text-[11px] font-mono text-on-surface-variant">
            {pct}% использовано · обновляется каждые 60 сек
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant p-4 text-xs font-mono text-on-surface-variant">
        <p className="mb-2 text-[10px] uppercase tracking-wider opacity-70">Настройка</p>
        <p>
          Лимит задаётся через <code className="bg-surface-container px-1 rounded">AI_DAILY_BUDGET_USD</code>{' '}
          env var (по умолчанию $50). При превышении{' '}
          <code className="bg-surface-container px-1 rounded">orchestrate()</code> выбрасывает{' '}
          <code className="bg-surface-container px-1 rounded">BudgetExceededError</code> до любого
          LLM вызова.
        </p>
      </div>
    </div>
  )
}
