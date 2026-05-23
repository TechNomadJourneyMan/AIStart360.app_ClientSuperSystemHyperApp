'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface AIInsight {
  area: string
  text: string
  severity?: 'positive' | 'neutral' | 'warning' | 'critical'
}

interface Props {
  insights: AIInsight[]
  intervalMs?: number
}

const SEVERITY_COLOR: Record<NonNullable<AIInsight['severity']>, string> = {
  positive: '#6effc0',
  neutral:  '#9bb0c5',
  warning:  '#ffbd60',
  critical: '#ff6b6b',
}

function severityIcon(s: AIInsight['severity']) {
  switch (s) {
    case 'critical': return 'error'
    case 'warning':  return 'warning'
    case 'positive': return 'trending_up'
    default:         return 'lightbulb'
  }
}

export function AIInsightsCarousel({ insights, intervalMs = 6000 }: Props) {
  const total = insights.length
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [tick, setTick] = useState(0)
  const startRef = useRef<number>(Date.now())

  useEffect(() => {
    if (total <= 1 || paused) return
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % total)
      startRef.current = Date.now()
    }, intervalMs)
    return () => clearInterval(id)
  }, [total, paused, intervalMs])

  useEffect(() => {
    if (total <= 1 || paused) return
    startRef.current = Date.now()
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [idx, paused, total])

  const progress = useMemo(() => {
    if (total <= 1 || paused) return 0
    const elapsed = Date.now() - startRef.current
    return Math.min(100, (elapsed / intervalMs) * 100)
  // tick is needed to re-evaluate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, idx, paused, total, intervalMs])

  if (total === 0) {
    return (
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary/80 text-base">auto_awesome</span>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.18em]">AI · Инсайты</p>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Инсайты появятся после обработки данных анкеты и документов.
        </p>
      </div>
    )
  }

  const current = insights[idx]
  const color = SEVERITY_COLOR[current.severity ?? 'neutral']
  const icon = severityIcon(current.severity)

  const go = (next: number) => {
    setIdx(((next % total) + total) % total)
    startRef.current = Date.now()
  }

  return (
    <div
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 relative overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary/80 text-base">auto_awesome</span>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.18em]">AI · Инсайты</p>
          <span className="flex items-center gap-1 ml-1">
            <span className="relative flex w-1.5 h-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            <span className="text-[9px] font-mono text-primary/60 uppercase">live</span>
          </span>
        </div>
        <span className="text-[10px] font-mono text-on-surface-variant tabular-nums">
          {String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>

      <div className="relative min-h-[88px]">
        <div key={idx} className="animate-[fadeIn_0.4s_ease-out] flex items-start gap-2.5">
          <span
            className="material-symbols-outlined text-base flex-shrink-0 mt-0.5"
            style={{ color }}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="text-[9px] font-mono uppercase tracking-widest mb-1"
              style={{ color: color + 'b3' }}
            >
              {current.area}
            </p>
            <p className="text-sm text-on-surface leading-snug">{current.text}</p>
          </div>
        </div>
      </div>

      {total > 1 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.04]">
          <div className="flex items-center gap-1">
            {insights.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                aria-label={`Инсайт ${i + 1}`}
                className="group relative h-1 rounded-full overflow-hidden transition-all"
                style={{ width: i === idx ? 24 : 8, background: 'rgba(255,255,255,0.08)' }}
              >
                {i === idx && (
                  <span
                    className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-100 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                )}
                {i !== idx && (
                  <span className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => go(idx - 1)}
              aria-label="Предыдущий инсайт"
              className="w-6 h-6 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">chevron_left</span>
            </button>
            <button
              onClick={() => go(idx + 1)}
              aria-label="Следующий инсайт"
              className="w-6 h-6 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
