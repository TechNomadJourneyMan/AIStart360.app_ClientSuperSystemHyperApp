'use client'

/**
 * GRI Strategy Panel — Opus-powered top-5 limitations + 30/60/90 action plan.
 *
 * Mounts under the existing GRI calculator. Loads cached strategy on mount;
 * regenerates via POST when user clicks the button.
 */

import { useCallback, useEffect, useState } from 'react'

interface Limitation {
  rank: number
  title: string
  block: string
  estimated_loss_kzt_per_year: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  why: string
  unblocks: string
}

interface ActionItem {
  task: string
  owner: string
  kpi: string
}

interface Strategy {
  overview: string
  top_5_limitations: Limitation[]
  action_plan: {
    days_30: ActionItem[]
    days_60: ActionItem[]
    days_90: ActionItem[]
  }
  expected_outcome: {
    revenue_lift_kzt_monthly: number
    timeline_months: number
    risk_level: 'low' | 'medium' | 'high'
    confidence: number
  }
  generated_at?: string
  completed_tasks?: string[]
}

const SEVERITY_STYLE: Record<Limitation['severity'], { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-error/10 border-error/25',           text: 'text-error',          label: 'Критично' },
  high:     { bg: 'bg-orange-500/10 border-orange-500/25', text: 'text-orange-300',     label: 'Высокий' },
  medium:   { bg: 'bg-amber-500/10 border-amber-500/25',   text: 'text-amber-300',      label: 'Средний' },
  low:      { bg: 'bg-white/[0.04] border-white/[0.10]',   text: 'text-on-surface-variant', label: 'Низкий' },
}

const BLOCK_LABEL: Record<string, string> = {
  finance: 'Финансы', sales: 'Продажи', marketing: 'Маркетинг',
  operations: 'Операции', strategy: 'Стратегия', team: 'Команда', product: 'Продукт',
}

export function GriStrategyPanel() {
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/gri-strategy', { cache: 'no-store' })
      const data = await res.json() as { ok: boolean; strategy: Strategy | null }
      setStrategy(data.strategy ?? null)
      setCompleted(new Set(data.strategy?.completed_tasks ?? []))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleTask = useCallback(async (taskId: string) => {
    // Optimistic update
    const wasDone = completed.has(taskId)
    const nextDone = !wasDone
    setCompleted(prev => {
      const next = new Set(prev)
      if (nextDone) next.add(taskId); else next.delete(taskId)
      return next
    })
    try {
      const res = await fetch('/api/ai/gri-strategy/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, done: nextDone }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      // Rollback on failure
      setCompleted(prev => {
        const next = new Set(prev)
        if (wasDone) next.add(taskId); else next.delete(taskId)
        return next
      })
    }
  }, [completed])

  const regenerate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/gri-strategy', { method: 'POST' })
      const data = await res.json() as { ok: boolean; strategy?: Strategy; error?: string }
      if (data.ok && data.strategy) setStrategy(data.strategy)
      else setError(data.error ?? 'Не удалось сгенерировать')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка генерации')
    } finally {
      setGenerating(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading && !strategy) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
        <p className="text-sm text-on-surface-variant mt-2">Загрузка стратегии…</p>
      </div>
    )
  }

  if (!strategy) {
    return (
      <div className="rounded-2xl border border-dashed border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-blue-500/5 p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-purple-300/70 mb-3">psychology</span>
        <h3 className="text-lg font-bold text-on-surface mb-1">Стратегический план не сгенерирован</h3>
        <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-4">
          Сгенерируем через AI: топ-5 ограничений роста с ценой недоработки и план действий на 30/60/90 дней.
          Использует Opus-модель — глубокий cross-domain анализ.
        </p>
        {error && <p className="text-xs text-error mb-3">Ошибка: {error}</p>}
        <button
          onClick={() => void regenerate()}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 text-white px-6 py-3 text-sm font-bold hover:scale-[1.02] transition-all disabled:opacity-60 disabled:scale-100"
        >
          {generating ? (
            <>
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
              Генерируем (60-90 сек)…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              Сгенерировать стратегию
            </>
          )}
        </button>
        <p className="text-[10px] text-on-surface-variant/60 mt-3 font-mono">Cost: ~$0.10 · Model: Claude Opus 4.1</p>
      </div>
    )
  }

  const totalLossYear = strategy.top_5_limitations.reduce((s, l) => s + l.estimated_loss_kzt_per_year, 0)

  return (
    <div className="space-y-6">
      {/* Header + meta + regenerate */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-purple-500/20 border border-purple-500/40 text-purple-300 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse" />
              AI СТРАТЕГИЯ · OPUS 4.1
            </div>
            <h2 className="font-headline text-xl font-bold text-on-surface">Стратегический план роста</h2>
            <p className="text-sm text-on-surface-variant mt-1">{strategy.overview}</p>
          </div>
          <button
            onClick={() => void regenerate()}
            disabled={generating}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] hover:border-primary/40 text-xs text-on-surface-variant hover:text-primary transition-all disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[14px] ${generating ? 'animate-spin' : ''}`}>refresh</span>
            {generating ? 'Генерация…' : 'Пересчитать'}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Потери / год</p>
            <p className="text-lg font-mono font-bold text-error">−{(totalLossYear / 1_000_000).toFixed(1)}M ₸</p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Потенциал / мес</p>
            <p className="text-lg font-mono font-bold text-primary">+{(strategy.expected_outcome.revenue_lift_kzt_monthly / 1_000_000).toFixed(1)}M ₸</p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Горизонт</p>
            <p className="text-lg font-mono font-bold text-on-surface">{strategy.expected_outcome.timeline_months} мес</p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Уверенность</p>
            <p className="text-lg font-mono font-bold text-on-surface">{Math.round(strategy.expected_outcome.confidence * 100)}%</p>
          </div>
        </div>
        {strategy.generated_at && (
          <p className="text-[10px] text-on-surface-variant/60 font-mono mt-3">
            Сгенерировано: {new Date(strategy.generated_at).toLocaleString('ru-RU')}
          </p>
        )}
      </div>

      {/* Top-5 limitations */}
      <section>
        <h3 className="font-headline text-lg font-bold text-on-surface mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-error">crisis_alert</span>
          Топ-5 ограничений роста
        </h3>
        <div className="space-y-2">
          {strategy.top_5_limitations.map((lim) => {
            const st = SEVERITY_STYLE[lim.severity]
            return (
              <div key={lim.rank} className={`rounded-xl border p-4 ${st.bg}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg bg-current/15 ${st.text} flex items-center justify-center flex-shrink-0 font-mono font-bold text-sm`}>
                    #{lim.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <h4 className="text-sm font-bold text-on-surface">{lim.title}</h4>
                      <span className={`text-sm font-mono font-bold whitespace-nowrap ${st.text}`}>
                        −{(lim.estimated_loss_kzt_per_year / 1_000_000).toFixed(1)}M ₸/год
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${st.text} bg-current/10`}>
                        {st.label}
                      </span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/[0.04] text-on-surface-variant">
                        {BLOCK_LABEL[lim.block] ?? lim.block}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mb-2 leading-relaxed">{lim.why}</p>
                    <p className="text-[11px] text-primary/90 italic">→ {lim.unblocks}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Action Plan 30/60/90 */}
      <section>
        <h3 className="font-headline text-lg font-bold text-on-surface mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">timeline</span>
          План действий · 30/60/90 дней
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {(['days_30', 'days_60', 'days_90'] as const).map((key, idx) => {
            const items = strategy.action_plan[key]
            const days = key === 'days_30' ? 30 : key === 'days_60' ? 60 : 90
            const tone = idx === 0 ? 'border-primary/30 bg-primary/[0.04]' : idx === 1 ? 'border-amber-400/30 bg-amber-500/[0.04]' : 'border-blue-500/30 bg-blue-500/[0.04]'
            const dotTone = idx === 0 ? 'bg-primary' : idx === 1 ? 'bg-amber-400' : 'bg-blue-500'
            const fillTone = idx === 0 ? 'bg-primary' : idx === 1 ? 'bg-amber-400' : 'bg-blue-500'
            const doneCount = items.reduce((acc, _, i) => acc + (completed.has(`${key}:${i}`) ? 1 : 0), 0)
            const pct = items.length > 0 ? (doneCount / items.length) * 100 : 0
            return (
              <div key={key} className={`rounded-xl border ${tone} p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dotTone}`} />
                    <h4 className="text-sm font-bold text-on-surface">{days} дней</h4>
                  </div>
                  <span className="text-[10px] font-mono text-on-surface-variant">{doneCount}/{items.length}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1 bg-surface-container rounded-full overflow-hidden mb-3">
                  <div className={`h-full ${fillTone} transition-all duration-300`} style={{ width: `${pct}%` }} />
                </div>
                <div className="space-y-2">
                  {items.map((item, i) => {
                    const tid = `${key}:${i}`
                    const isDone = completed.has(tid)
                    return (
                      <div
                        key={i}
                        className={`rounded-lg border p-2.5 transition-all ${
                          isDone
                            ? 'bg-primary/[0.06] border-primary/15 opacity-70'
                            : 'bg-surface-container/50 border-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => void toggleTask(tid)}
                            className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border transition-all flex items-center justify-center ${
                              isDone
                                ? 'bg-primary border-primary'
                                : 'bg-transparent border-white/30 hover:border-primary/60'
                            }`}
                            title={isDone ? 'Отметить невыполненной' : 'Отметить выполненной'}
                          >
                            {isDone && <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 12 }}>check</span>}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium leading-relaxed mb-1.5 ${isDone ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                              {item.task}
                            </p>
                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                              <span className="text-on-surface-variant truncate">👤 {item.owner}</span>
                              <span className="text-primary/80 truncate">📊 {item.kpi}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <p className="text-[10px] text-on-surface-variant/60 font-mono text-center">
        Cтратегия сгенерирована Claude Opus 4.1 · cross-domain reasoning из диагностики, RFM, потерь и анкеты
      </p>
    </div>
  )
}
