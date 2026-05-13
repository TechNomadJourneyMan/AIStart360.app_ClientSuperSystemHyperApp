'use client'

/**
 * Hero block for /dashboard — mockup-inspired layout:
 *  - 3 hero cards: Current / 12mo goal / 3yr goal with progress + gap
 *  - Goal inputs (1Y + 3Y) wired to /api/v1/user-goals (PATCH on blur)
 *  - GRI CTA block alongside
 *
 * Reads existing goals on mount; writes back via debounced POST.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface Goals {
  current_revenue_monthly_kzt: number | null
  goal_1y_monthly_kzt: number | null
  goal_3y_monthly_kzt: number | null
  updated_at: string | null
}

const EMPTY: Goals = {
  current_revenue_monthly_kzt: null,
  goal_1y_monthly_kzt: null,
  goal_3y_monthly_kzt: null,
  updated_at: null,
}

function formatKzt(value: number | null): string {
  if (value == null) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ₸`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ₸`
  return `${value.toFixed(0)} ₸`
}

function parseInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function HeroGoalsBlock({ derivedCurrent }: { derivedCurrent?: number | null }) {
  const [goals, setGoals] = useState<Goals>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inputCurrent, setInputCurrent] = useState<string>('')
  const [input1y, setInput1y] = useState<string>('')
  const [input3y, setInput3y] = useState<string>('')

  // Load existing goals
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/user-goals', { cache: 'no-store' })
        const data = await res.json() as { ok: boolean; goals?: Goals }
        if (cancelled) return
        if (data.ok && data.goals) {
          setGoals(data.goals)
          setInputCurrent(data.goals.current_revenue_monthly_kzt?.toString() ?? '')
          setInput1y(data.goals.goal_1y_monthly_kzt?.toString() ?? '')
          setInput3y(data.goals.goal_3y_monthly_kzt?.toString() ?? '')
        }
      } catch { /* keep EMPTY */ }
      finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Effective current revenue — explicit value preferred, fallback to derived (e.g. medical LTV/36)
  const effectiveCurrent = useMemo(() => {
    const v = goals.current_revenue_monthly_kzt
    if (v != null && v > 0) return v
    return derivedCurrent ?? null
  }, [goals.current_revenue_monthly_kzt, derivedCurrent])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const body = {
        current_revenue_monthly_kzt: parseInput(inputCurrent),
        goal_1y_monthly_kzt: parseInput(input1y),
        goal_3y_monthly_kzt: parseInput(input3y),
      }
      const res = await fetch('/api/v1/user-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { ok: boolean; goals?: Goals }
      if (data.ok && data.goals) setGoals(data.goals)
    } catch { /* silent */ }
    finally { setSaving(false) }
  }, [inputCurrent, input1y, input3y])

  // Derived metrics
  const gap1y = effectiveCurrent != null && goals.goal_1y_monthly_kzt != null
    ? goals.goal_1y_monthly_kzt - effectiveCurrent
    : null
  const gap3y = effectiveCurrent != null && goals.goal_3y_monthly_kzt != null
    ? goals.goal_3y_monthly_kzt - effectiveCurrent
    : null
  const pct1y = effectiveCurrent != null && goals.goal_1y_monthly_kzt && goals.goal_1y_monthly_kzt > 0
    ? Math.round((effectiveCurrent / goals.goal_1y_monthly_kzt) * 100)
    : null
  const pct3y = effectiveCurrent != null && goals.goal_3y_monthly_kzt && goals.goal_3y_monthly_kzt > 0
    ? Math.round((effectiveCurrent / goals.goal_3y_monthly_kzt) * 100)
    : null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-mono text-primary/60 uppercase tracking-[0.2em]">
          Точка А · снимок · карта роста
        </p>
        {saving && (
          <span className="text-[10px] font-mono text-primary inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
            Сохраняем…
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* LEFT: 3 hero cards stacked */}
        <div className="lg:col-span-2 space-y-2">
          <HeroCard
            tone="primary"
            label="Текущая позиция"
            value={formatKzt(effectiveCurrent)}
            subValue="выручка / мес"
            metaLeft="RUN-RATE"
            metaRight={effectiveCurrent != null ? `~${formatKzt(effectiveCurrent * 12)}/год` : '—'}
            progressLabel="Введите цель чтобы видеть прогресс"
          />
          <HeroCard
            tone="green"
            label="Цель 12 месяцев"
            value={formatKzt(goals.goal_1y_monthly_kzt)}
            subValue={goals.goal_1y_monthly_kzt ? `${formatKzt(goals.goal_1y_monthly_kzt * 12)} / год` : ''}
            metaLeft="РАЗРЫВ"
            metaRight={gap1y != null ? (gap1y > 0 ? `−${formatKzt(gap1y)}/мес` : 'Достигнуто ✓') : '—'}
            metaRightTone={gap1y != null && gap1y > 0 ? 'red' : 'green'}
            progressLabel={pct1y != null ? `Прогресс к цели 12М` : 'Укажи цель'}
            progressPct={pct1y}
            progressTone="yellow"
          />
          <HeroCard
            tone="yellow"
            label="Цель 3 года"
            value={formatKzt(goals.goal_3y_monthly_kzt)}
            subValue={goals.goal_3y_monthly_kzt ? `${formatKzt(goals.goal_3y_monthly_kzt * 12)} / год` : ''}
            metaLeft="РАЗРЫВ"
            metaRight={gap3y != null ? (gap3y > 0 ? `−${formatKzt(gap3y)}/мес` : 'Достигнуто ✓') : '—'}
            metaRightTone={gap3y != null && gap3y > 0 ? 'red' : 'green'}
            progressLabel={pct3y != null ? `Прогресс к цели 3Y` : 'Укажи цель'}
            progressPct={pct3y}
            progressTone="red"
          />
        </div>

        {/* RIGHT: Goal inputs + GRI CTA */}
        <div className="lg:col-span-3 grid grid-rows-2 gap-3">
          {/* Goals input card */}
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-primary/[0.04] to-transparent p-5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-blue-400 to-primary animate-pulse" />
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border border-primary/35 bg-primary/15 text-primary mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              AI · КАРТА РОСТА
            </span>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-on-surface mb-1.5">
              Укажите цели — получите карту роста
            </h2>
            <p className="text-xs text-on-surface-variant mb-4">
              AI рассчитает траекторию, разрыв и рычаги роста на основе ваших данных
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <GoalInput
                label="Факт / мес"
                value={inputCurrent}
                placeholder={derivedCurrent ? formatKzt(derivedCurrent).replace(' ₸', '') : '4 200 000'}
                onChange={setInputCurrent}
                onBlur={save}
                disabled={loading}
              />
              <GoalInput
                label="Цель · 1 год"
                value={input1y}
                placeholder="7 500 000"
                onChange={setInput1y}
                onBlur={save}
                disabled={loading}
              />
              <GoalInput
                label="Цель · 3 года"
                value={input3y}
                placeholder="25 000 000"
                onChange={setInput3y}
                onBlur={save}
                disabled={loading}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-on-surface-variant font-mono">
              <span>Текущая: <strong className="text-primary">{formatKzt(effectiveCurrent)}/мес</strong></span>
              {gap1y != null && (
                <>
                  <span className="opacity-30">·</span>
                  <span>Разрыв 1Y: <strong className={gap1y > 0 ? 'text-error' : 'text-primary'}>{gap1y > 0 ? `−${formatKzt(gap1y)}` : '✓'}/мес</strong></span>
                </>
              )}
            </div>
          </div>

          {/* GRI CTA card */}
          <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.10] via-blue-500/[0.06] to-transparent p-5 flex flex-col">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-400 via-blue-400 to-purple-400 animate-pulse" />
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border border-purple-500/35 bg-purple-500/15 text-purple-300 mb-3 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              СЛЕДУЮЩИЙ ШАГ · GRI-ДИАГНОСТИКА
            </span>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-on-surface mb-1.5">
              Определи готовность к росту — пройди{' '}
              <span className="bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">GRI</span>
            </h2>
            <p className="text-xs text-on-surface-variant mb-4 flex-1">
              Growth Readiness Index покажет где бизнес ломается при ускорении. 7 блоков × 62 критерия. TOP-5 ограничений с ценой недоработки. Action Plan на 90 дней.
            </p>
            <Link
              href="/gri"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-sm font-bold rounded-xl px-4 py-3 transition-all shadow-lg shadow-purple-500/30"
            >
              <span className="material-symbols-outlined text-[16px]">change_history</span>
              Пройти GRI-диагностику
            </Link>
            <p className="text-[10px] font-mono text-on-surface-variant text-center mt-2">~ 45 минут · 62 вопроса</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── sub-components ───────────────────────────────────────────────── */

function HeroCard({
  tone, label, value, subValue, metaLeft, metaRight, metaRightTone, progressLabel, progressPct, progressTone,
}: {
  tone: 'primary' | 'green' | 'yellow'
  label: string
  value: string
  subValue: string
  metaLeft: string
  metaRight: string
  metaRightTone?: 'red' | 'green'
  progressLabel: string
  progressPct?: number | null
  progressTone?: 'yellow' | 'red'
}) {
  const borderColor = tone === 'green' ? 'border-l-primary' : tone === 'yellow' ? 'border-l-amber-400' : 'border-l-blue-400'
  const valueColor = tone === 'green' ? 'text-primary' : tone === 'yellow' ? 'text-amber-300' : 'text-on-surface'
  const fillColor = progressTone === 'red' ? 'from-error to-amber-500' : 'from-amber-500 to-orange-500'

  return (
    <div className={`bg-surface-container-low border border-white/[0.06] border-l-[3px] ${borderColor} rounded-xl p-3.5`}>
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 sm:gap-4 items-center">
        <div className="min-w-[110px]">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-1">{label}</p>
          <p className={`text-xl font-bold ${valueColor} leading-tight`}>{value}</p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">{subValue}</p>
        </div>
        <div className="sm:border-l sm:border-white/[0.06] sm:pl-4 space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-on-surface-variant">{metaLeft}</span>
            <span className={metaRightTone === 'red' ? 'text-error font-semibold' : metaRightTone === 'green' ? 'text-primary font-semibold' : 'text-on-surface font-semibold'}>{metaRight}</span>
          </div>
          {progressPct != null && (
            <>
              <div className="flex justify-between text-[9px] font-mono text-on-surface-variant">
                <span>{progressLabel}</span>
                <span className={progressPct >= 70 ? 'text-primary' : progressPct >= 40 ? 'text-amber-300' : 'text-error'}>{progressPct}%</span>
              </div>
              <div className="h-1 rounded-full bg-surface-container overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${fillColor}`}
                  style={{ width: `${Math.min(100, progressPct)}%` }}
                />
              </div>
            </>
          )}
          {progressPct == null && (
            <p className="text-[9px] text-on-surface-variant/60">{progressLabel}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function GoalInput({
  label, value, placeholder, onChange, onBlur, disabled,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  onBlur: () => void
  disabled?: boolean
}) {
  return (
    <div>
      <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-wider mb-1.5">{label}</p>
      <div className="flex items-center bg-surface-container border border-white/[0.08] rounded-lg px-3 focus-within:border-primary/50">
        <span className="font-headline text-base font-bold text-on-surface-variant mr-1.5">₸</span>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="flex-1 bg-transparent border-none outline-none text-base font-bold font-headline text-on-surface py-2.5 placeholder:text-on-surface-variant/40 placeholder:font-medium disabled:opacity-50 min-w-0"
        />
        <span className="text-[10px] text-on-surface-variant ml-1.5 whitespace-nowrap">/мес</span>
      </div>
    </div>
  )
}
