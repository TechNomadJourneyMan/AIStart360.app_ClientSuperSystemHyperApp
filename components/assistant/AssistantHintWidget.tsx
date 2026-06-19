'use client'

/**
 * components/assistant/AssistantHintWidget.tsx
 *
 * Dashboard readiness widget for the client landing page (mounted near
 * GrowthSnapshotHero/MyDataSection in app/client/point-a/page.tsx — NOT wired in
 * by this change; new file only).
 *
 * Behaviour:
 *   • GET /api/v1/assistant/status on mount → { completion, status, top_issues, readiness }.
 *   • Renders an overall completion ring (% + per-section bars), a readiness chip
 *     mapped from AssistantStatus, and the top 3 issues (ValidationIssue.message_ru).
 *   • Primary "Позвать эксперта" → POST /api/v1/assistant/escalate
 *     { trigger_type: 'user_requested_help' }.
 *
 * Anti-hallucination: the widget only renders snapshot-derived values returned by
 * the route. It never invents numbers; missing data simply shows an empty/0 state.
 * All copy is Russian; theme tokens match the existing premium dark surface.
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  AssistantStatus,
  CompletionReport,
  SectionCompletion,
  ValidationIssue,
} from '@/lib/assistant/types'

interface StatusResponse {
  ok: boolean
  completion?: CompletionReport
  status?: AssistantStatus
  top_issues?: ValidationIssue[]
  readiness?: {
    status: AssistantStatus
    overall_pct: number
    can_run_analysis: boolean
    error_count: number
    warning_count: number
  }
  error?: string
}

// ─── Status → chip presentation ─────────────────────────────────────────────
const STATUS_CHIP: Record<
  AssistantStatus,
  { label: string; color: string; bg: string; border: string; icon: string }
> = {
  not_started: {
    label: 'Не начато',
    color: 'text-on-surface-variant',
    bg: 'bg-surface-container',
    border: 'border-white/[0.08]',
    icon: 'radio_button_unchecked',
  },
  in_progress: {
    label: 'В процессе',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/20',
    icon: 'hourglass_top',
  },
  needs_attention: {
    label: 'Требует внимания',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/20',
    icon: 'warning',
  },
  ready_for_analysis: {
    label: 'Готово к анализу',
    color: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/25',
    icon: 'task_alt',
  },
  ready_for_expert_review: {
    label: 'Готово к проверке экспертом',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    icon: 'verified',
  },
  completed: {
    label: 'Завершено',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/20',
    icon: 'check_circle',
  },
}

// ─── Severity → inline issue chip presentation ──────────────────────────────
const SEVERITY_STYLE: Record<ValidationIssue['severity'], { color: string; icon: string }> = {
  error: { color: 'text-error', icon: 'error' },
  warning: { color: 'text-amber-400', icon: 'warning' },
  info: { color: 'text-blue-400', icon: 'info' },
}

function CompletionRing({ pct, size = 96 }: { pct: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  const r = size / 2 - 8
  const circ = 2 * Math.PI * r
  const dash = (clamped / 100) * circ
  const color = clamped >= 80 ? '#6EFFC0' : clamped >= 40 ? '#FBBF24' : '#EF4444'
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={7}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-xl font-extrabold text-on-surface">{clamped}%</span>
        <span className="text-[9px] text-on-surface-variant uppercase tracking-widest">готово</span>
      </div>
    </div>
  )
}

function SectionBar({ s }: { s: SectionCompletion }) {
  const pct = Math.max(0, Math.min(100, Math.round(s.pct)))
  const color =
    pct >= 80 ? 'bg-primary' : pct >= 40 ? 'bg-amber-400' : pct > 0 ? 'bg-error' : 'bg-white/10'
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-on-surface-variant w-28 truncate flex-shrink-0" title={s.label}>
        {s.label}
      </span>
      <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-on-surface-variant w-9 text-right flex-shrink-0">{pct}%</span>
    </div>
  )
}

export default function AssistantHintWidget() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [escalating, setEscalating] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [escalateError, setEscalateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/assistant/status', { cache: 'no-store', credentials: 'include' })
      const json = (await res.json()) as StatusResponse
      setData(json.ok ? json : null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const callExpert = async () => {
    setEscalating(true)
    setEscalateError(null)
    try {
      const res = await fetch('/api/v1/assistant/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ trigger_type: 'user_requested_help' }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (res.ok && json.ok) setEscalated(true)
      else setEscalateError(json.error || 'Не удалось отправить запрос')
    } catch {
      setEscalateError('Ошибка сети')
    } finally {
      setEscalating(false)
    }
  }

  if (loading) {
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-full border-2 border-primary/20 border-t-primary animate-spin flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-white/[0.05] rounded-full animate-pulse w-1/3" />
            <div className="h-2.5 bg-white/[0.04] rounded-full animate-pulse" />
            <div className="h-2.5 bg-white/[0.04] rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      </section>
    )
  }

  if (!data || !data.completion) {
    return (
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-lg text-on-surface-variant">assistant</span>
          <p className="text-sm text-on-surface-variant">Готовность анкеты пока недоступна.</p>
        </div>
        <button
          onClick={load}
          className="text-xs font-mono text-primary hover:text-primary/80 border border-primary/20 rounded-lg px-3 py-1.5 transition-all"
        >
          Обновить
        </button>
      </section>
    )
  }

  const completion = data.completion
  const status = (data.status ?? completion.status) as AssistantStatus
  const chip = STATUS_CHIP[status] ?? STATUS_CHIP.in_progress
  const topIssues = (data.top_issues ?? []).slice(0, 3)
  const sections = completion.sections ?? []

  return (
    <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
      <div className="flex flex-col md:flex-row md:items-start gap-6">
        {/* Ring + readiness chip */}
        <div className="flex flex-col items-center gap-3 flex-shrink-0">
          <CompletionRing pct={completion.overall_pct} />
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-lg border ${chip.bg} ${chip.color} ${chip.border}`}
          >
            <span className="material-symbols-outlined text-xs">{chip.icon}</span>
            {chip.label}
          </span>
        </div>

        {/* Sections + issues */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-primary">assistant</span>
              <h2 className="text-sm font-bold text-on-surface">Готовность к анализу</h2>
            </div>
            {data.readiness && (
              <span className="text-[10px] font-mono text-on-surface-variant">
                {data.readiness.error_count > 0 && (
                  <span className="text-error">{data.readiness.error_count} ошибок</span>
                )}
                {data.readiness.error_count > 0 && data.readiness.warning_count > 0 && ' · '}
                {data.readiness.warning_count > 0 && (
                  <span className="text-amber-400">{data.readiness.warning_count} предупр.</span>
                )}
              </span>
            )}
          </div>

          {/* Per-section bars */}
          {sections.length > 0 && (
            <div className="space-y-1.5 mb-4">
              {sections.map((s) => (
                <SectionBar key={s.section} s={s} />
              ))}
            </div>
          )}

          {/* Top 3 issues */}
          {topIssues.length > 0 ? (
            <div className="space-y-1.5 mb-4">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                На что обратить внимание
              </p>
              {topIssues.map((iss) => {
                const sv = SEVERITY_STYLE[iss.severity]
                return (
                  <div key={iss.id} className="flex items-start gap-2">
                    <span className={`material-symbols-outlined text-sm mt-0.5 flex-shrink-0 ${sv.color}`}>
                      {sv.icon}
                    </span>
                    <p className="text-xs text-on-surface-variant leading-snug">{iss.message_ru}</p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-4 text-xs text-emerald-400">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Критичных замечаний нет.
            </div>
          )}

          {/* Primary CTA — call an expert */}
          <div className="flex flex-wrap items-center gap-3">
            {escalated ? (
              <span className="inline-flex items-center gap-2 text-sm text-primary bg-primary/10 border border-primary/25 rounded-xl px-4 py-2.5">
                <span className="material-symbols-outlined text-base">mark_email_read</span>
                Запрос отправлен — эксперт скоро свяжется
              </span>
            ) : (
              <button
                onClick={callExpert}
                disabled={escalating}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm hover:scale-[0.99] transition-all disabled:opacity-60"
              >
                <span className={`material-symbols-outlined text-base ${escalating ? 'animate-spin' : ''}`}>
                  {escalating ? 'progress_activity' : 'support_agent'}
                </span>
                {escalating ? 'Отправляем…' : 'Позвать эксперта'}
              </button>
            )}
            {escalateError && <span className="text-xs text-error">{escalateError}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
