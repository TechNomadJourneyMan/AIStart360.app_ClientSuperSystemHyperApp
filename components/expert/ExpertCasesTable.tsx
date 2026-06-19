'use client'

/**
 * components/expert/ExpertCasesTable.tsx
 *
 * Expert-side list of a client's escalation cases. Intended to mount inside the
 * expert client-detail view (sibling to the existing Dashboard/Point-B tabs under
 * app/(expert)/expert/*) — new file only, not wired into a page by this change.
 *
 * Behaviour:
 *   • GET /api/expert/clients/[id]/expert-cases → rows ordered created_at.desc.
 *   • Lists each case by priority + status with its detected_issues
 *     (ValidationIssue.message_ru) and assistant_recommendation.
 *   • Inline status + priority <select> controls PATCH the case
 *     ({ caseId, status } / { caseId, priority }) and optimistically refresh.
 *
 * The route returns SNAKE_CASE columns (detected_issues, assistant_recommendation,
 * trigger_type, user_message, expert_action_recommended, created_at) — this row
 * type mirrors the DB columns rather than the camelCase ExpertCase type. The
 * status/priority unions are reused verbatim from the pinned ExpertCase type.
 *
 * Russian copy, premium dark tokens (mirrors components/expert/tabs/PointBTab.tsx).
 */

import { useCallback, useEffect, useState } from 'react'
import type { ExpertCase, ValidationIssue, EscalationTrigger } from '@/lib/assistant/types'

/** Row shape as returned by GET (snake_case DB columns). */
interface ExpertCaseRow {
  id: string
  user_id: string
  company_id: string | null
  diagnostic_id: string | null
  status: ExpertCase['status']
  priority: ExpertCase['priority']
  trigger_type: EscalationTrigger
  title: string
  summary: string
  detected_issues: ValidationIssue[] | null
  user_message: string | null
  assistant_recommendation: string | null
  expert_action_recommended: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}

const STATUS_OPTIONS: ExpertCase['status'][] = ['new', 'in_progress', 'resolved', 'closed']
const PRIORITY_OPTIONS: ExpertCase['priority'][] = ['low', 'medium', 'high', 'critical']

const STATUS_LABEL: Record<ExpertCase['status'], string> = {
  new: 'Новая',
  in_progress: 'В работе',
  resolved: 'Решена',
  closed: 'Закрыта',
}
const PRIORITY_LABEL: Record<ExpertCase['priority'], string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}
const TRIGGER_LABEL: Record<EscalationTrigger, string> = {
  user_requested_help: 'Запрос клиента',
  validation_issue: 'Ошибка валидации',
  llm_recommendation: 'Рекомендация ИИ',
  critical_risk: 'Критический риск',
  incomplete_data: 'Неполные данные',
  manual: 'Вручную',
}

const PRIORITY_STYLE: Record<ExpertCase['priority'], { dot: string; text: string; ring: string }> = {
  low: { dot: 'bg-on-surface-variant', text: 'text-on-surface-variant', ring: 'border-white/[0.08]' },
  medium: { dot: 'bg-blue-400', text: 'text-blue-400', ring: 'border-blue-400/25' },
  high: { dot: 'bg-amber-400', text: 'text-amber-400', ring: 'border-amber-400/25' },
  critical: { dot: 'bg-error', text: 'text-error', ring: 'border-error/30' },
}
const STATUS_STYLE: Record<ExpertCase['status'], string> = {
  new: 'text-primary',
  in_progress: 'text-blue-400',
  resolved: 'text-emerald-400',
  closed: 'text-on-surface-variant',
}
const SEVERITY_STYLE: Record<ValidationIssue['severity'], { color: string; icon: string }> = {
  error: { color: 'text-error', icon: 'error' },
  warning: { color: 'text-amber-400', icon: 'warning' },
  info: { color: 'text-blue-400', icon: 'info' },
}

// Sort: critical→low priority, then newest first.
const PRIORITY_RANK: Record<ExpertCase['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 }

export function ExpertCasesTable({ clientId }: { clientId: string }) {
  const [cases, setCases] = useState<ExpertCaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/expert-cases`, { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; data?: ExpertCaseRow[]; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error || `Ошибка ${res.status}`)
        setCases([])
      } else {
        const rows = (json.data ?? []).slice().sort((a, b) => {
          const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
          if (pr !== 0) return pr
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
        setCases(rows)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети')
      setCases([])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  const patchCase = async (
    caseId: string,
    patch: { status?: ExpertCase['status']; priority?: ExpertCase['priority'] },
  ) => {
    setSavingId(caseId)
    // Optimistic update.
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, ...patch } : c)))
    try {
      const res = await fetch(`/api/expert/clients/${clientId}/expert-cases`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, ...patch }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !json.ok) {
        // Revert on failure.
        await load()
        setError(json.error || 'Не удалось обновить кейс')
      }
    } catch {
      await load()
      setError('Ошибка сети при обновлении')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
        ))}
      </div>
    )
  }

  if (error && cases.length === 0) {
    return (
      <div className="rounded-2xl border border-error/15 bg-error/[0.05] p-5 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm text-error">
          <span className="material-symbols-outlined text-lg">error</span>
          {error}
        </p>
        <button
          onClick={load}
          className="text-xs font-mono text-on-surface-variant hover:text-on-surface border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all"
        >
          Повторить
        </button>
      </div>
    )
  }

  if (cases.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <span className="material-symbols-outlined text-2xl text-primary">support_agent</span>
        </div>
        <p className="text-sm text-on-surface mb-1">Обращений к эксперту нет</p>
        <p className="text-xs text-on-surface-variant">Здесь появятся эскалации по этому клиенту.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-primary">support_agent</span>
          Кейсы эксперта
          <span className="text-xs font-mono text-on-surface-variant">({cases.length})</span>
        </h3>
        <button
          onClick={load}
          className="text-xs font-mono text-on-surface-variant hover:text-primary border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">refresh</span>
          Обновить
        </button>
      </div>

      {error && cases.length > 0 && <p className="text-xs text-error">{error}</p>}

      {cases.map((c) => {
        const pr = PRIORITY_STYLE[c.priority]
        const issues = c.detected_issues ?? []
        const isOpen = expanded[c.id] ?? false
        return (
          <div key={c.id} className={`rounded-2xl border ${pr.ring} bg-surface-container-low p-5`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono ${pr.text}`}>
                    <span className={`w-2 h-2 rounded-full ${pr.dot}`} />
                    {PRIORITY_LABEL[c.priority]}
                  </span>
                  <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                    {TRIGGER_LABEL[c.trigger_type] ?? c.trigger_type}
                  </span>
                  <span className={`text-[11px] font-mono ${STATUS_STYLE[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </div>
                <p className="text-sm font-semibold text-on-surface truncate">{c.title}</p>
                <p className="text-[10px] font-mono text-on-surface-variant mt-0.5">
                  {new Date(c.created_at).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>

              {/* Inline controls */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={c.priority}
                  disabled={savingId === c.id}
                  onChange={(e) => patchCase(c.id, { priority: e.target.value as ExpertCase['priority'] })}
                  className="bg-surface-container border border-white/[0.08] rounded-lg text-[11px] text-on-surface px-2 py-1.5 focus:outline-none focus:border-primary/40 disabled:opacity-50"
                  aria-label="Приоритет"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p} className="bg-[#0c0e14]">
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
                <select
                  value={c.status}
                  disabled={savingId === c.id}
                  onChange={(e) => patchCase(c.id, { status: e.target.value as ExpertCase['status'] })}
                  className="bg-surface-container border border-white/[0.08] rounded-lg text-[11px] text-on-surface px-2 py-1.5 focus:outline-none focus:border-primary/40 disabled:opacity-50"
                  aria-label="Статус"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s} className="bg-[#0c0e14]">
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Summary */}
            {c.summary && <p className="text-xs text-on-surface-variant leading-relaxed mb-3">{c.summary}</p>}

            {/* User message */}
            {c.user_message && (
              <div className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-surface-container px-3 py-2 mb-3">
                <span className="material-symbols-outlined text-sm text-on-surface-variant mt-0.5 flex-shrink-0">
                  chat
                </span>
                <p className="text-xs text-on-surface">{c.user_message}</p>
              </div>
            )}

            {/* Assistant recommendation */}
            {c.assistant_recommendation && (
              <div className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2 mb-3">
                <span className="material-symbols-outlined text-sm text-primary mt-0.5 flex-shrink-0">
                  lightbulb
                </span>
                <div>
                  <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-0.5">
                    Рекомендация ассистента
                  </p>
                  <p className="text-xs text-on-surface leading-relaxed">{c.assistant_recommendation}</p>
                </div>
              </div>
            )}

            {/* Detected issues (collapsible) */}
            {issues.length > 0 && (
              <div>
                <button
                  onClick={() => setExpanded((p) => ({ ...p, [c.id]: !isOpen }))}
                  className="flex items-center gap-1.5 text-[11px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">{isOpen ? 'expand_less' : 'expand_more'}</span>
                  Замечания ассистента ({issues.length})
                </button>
                {isOpen && (
                  <ul className="mt-2 space-y-1.5">
                    {issues.map((iss) => {
                      const sv = SEVERITY_STYLE[iss.severity]
                      return (
                        <li key={iss.id} className="flex items-start gap-2">
                          <span className={`material-symbols-outlined text-sm mt-0.5 flex-shrink-0 ${sv.color}`}>
                            {sv.icon}
                          </span>
                          <span className="text-xs text-on-surface-variant leading-snug">
                            {iss.message_ru}
                            {iss.section && (
                              <span className="text-on-surface-variant/50"> · {iss.section}</span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Expert action recommended (read-only echo if present) */}
            {c.expert_action_recommended && (
              <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-start gap-2">
                <span className="material-symbols-outlined text-sm text-violet-400 mt-0.5 flex-shrink-0">
                  rate_review
                </span>
                <p className="text-xs text-on-surface-variant leading-relaxed">{c.expert_action_recommended}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ExpertCasesTable
