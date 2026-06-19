'use client'

/**
 * components/assistant/InlineValidationHints.tsx
 *
 * Non-blocking inline validation for a single анкета step. Intended to mount
 * under the {StepForm} block in app/client/onboarding/page.tsx (new file only —
 * not wired in by this change).
 *
 * Behaviour:
 *   • Given { section, draftAnswers } it debounces a POST to
 *     /api/v1/assistant/validate { section, draftAnswers } → { issues }.
 *   • Renders per-field error/warning/info chips (keyed by ValidationIssue.field)
 *     plus a section-level banner. Warns but never blocks navigation — matching
 *     the wizard's all-tabs-clickable UX.
 *
 * Anti-hallucination: it only renders message_ru/hint_ru returned by the route;
 * it never derives or fabricates its own validation verdicts. Russian copy,
 * premium dark tokens (mirrors components/onboarding/shared/FieldError.tsx).
 *
 * Optional render-prop API: pass `children` to receive the field→issues map so a
 * step form can slot a hint next to a specific input (the FieldError slot
 * pattern). When omitted, the component renders its own banner + field list.
 */

import { useEffect, useRef, useState } from 'react'
import type { ValidationIssue } from '@/lib/assistant/types'

interface InlineValidationHintsProps {
  /** Section id matching ValidationIssue.section / SECTION_FIELD_MAP key. */
  section: string
  /** In-flight (unsaved) answers for the current step. */
  draftAnswers: Record<string, unknown>
  /** Debounce window in ms before hitting /validate. Default 600. */
  debounceMs?: number
  /**
   * Optional render-prop: receives issues grouped by field so a step form can
   * place a hint next to a specific input. When provided, the default banner +
   * field list are NOT rendered (the caller owns layout).
   */
  children?: (api: {
    issuesByField: Record<string, ValidationIssue[]>
    sectionIssues: ValidationIssue[]
    loading: boolean
  }) => React.ReactNode
}

const SEVERITY_STYLE: Record<
  ValidationIssue['severity'],
  { color: string; chipBg: string; chipBorder: string; icon: string }
> = {
  error: { color: 'text-error', chipBg: 'bg-error/10', chipBorder: 'border-error/20', icon: 'error' },
  warning: {
    color: 'text-amber-400',
    chipBg: 'bg-amber-400/10',
    chipBorder: 'border-amber-400/20',
    icon: 'warning',
  },
  info: { color: 'text-blue-400', chipBg: 'bg-blue-400/10', chipBorder: 'border-blue-400/20', icon: 'info' },
}

/** Field-scoped issues (one ValidationIssue.field). Use in a FieldError slot. */
export function FieldHints({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null
  return (
    <div className="mt-1.5 space-y-1">
      {issues.map((iss) => {
        const sv = SEVERITY_STYLE[iss.severity]
        return (
          <p key={iss.id} className={`flex items-start gap-1.5 text-xs ${sv.color}`}>
            <span className="material-symbols-outlined text-xs mt-0.5 flex-shrink-0">{sv.icon}</span>
            <span>
              {iss.message_ru}
              {iss.hint_ru && <span className="text-on-surface-variant"> — {iss.hint_ru}</span>}
            </span>
          </p>
        )
      })}
    </div>
  )
}

export default function InlineValidationHints({
  section,
  draftAnswers,
  debounceMs = 600,
  children,
}: InlineValidationHintsProps) {
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Stable serialization so the effect only refires on actual answer changes.
  const draftKey = JSON.stringify(draftAnswers ?? {})

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const res = await fetch('/api/v1/assistant/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: ctrl.signal,
          body: JSON.stringify({ section, draftAnswers }),
        })
        const json = (await res.json()) as { ok: boolean; issues?: ValidationIssue[] }
        if (res.ok && json.ok) setIssues(json.issues ?? [])
        else setIssues([])
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setIssues([])
      } finally {
        setLoading(false)
      }
    }, debounceMs)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // draftKey captures draftAnswers content; section/debounceMs are scalars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, draftKey, debounceMs])

  // Group by field for the render-prop and the default field list.
  const issuesByField: Record<string, ValidationIssue[]> = {}
  const sectionIssues: ValidationIssue[] = []
  for (const iss of issues) {
    if (iss.field) {
      ;(issuesByField[iss.field] ??= []).push(iss)
    } else {
      sectionIssues.push(iss)
    }
  }

  // Render-prop mode — caller owns layout.
  if (children) return <>{children({ issuesByField, sectionIssues, loading })}</>

  if (!issues.length) return null

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const bannerTone =
    errorCount > 0
      ? { color: 'text-error', bg: 'bg-error/[0.06]', border: 'border-error/15', icon: 'error' }
      : warningCount > 0
        ? { color: 'text-amber-400', bg: 'bg-amber-400/[0.06]', border: 'border-amber-400/15', icon: 'warning' }
        : { color: 'text-blue-400', bg: 'bg-blue-400/[0.06]', border: 'border-blue-400/15', icon: 'info' }

  const bannerText =
    errorCount > 0
      ? 'Заполните обязательные поля — это не блокирует переход, но повышает точность диагностики.'
      : warningCount > 0
        ? 'Похоже на противоречие в ответах — проверьте отмеченные поля.'
        : 'Есть рекомендации по заполнению.'

  return (
    <div className={`rounded-xl border ${bannerTone.border} ${bannerTone.bg} p-4 space-y-3`}>
      {/* Section banner */}
      <div className={`flex items-start gap-2 ${bannerTone.color}`}>
        <span className="material-symbols-outlined text-base mt-0.5 flex-shrink-0">{bannerTone.icon}</span>
        <p className="text-xs leading-snug">{bannerText}</p>
      </div>

      {/* Field chips */}
      <div className="space-y-1.5">
        {issues.map((iss) => {
          const sv = SEVERITY_STYLE[iss.severity]
          return (
            <div
              key={iss.id}
              className={`flex items-start gap-2 rounded-lg border ${sv.chipBorder} ${sv.chipBg} px-3 py-2`}
            >
              <span className={`material-symbols-outlined text-sm mt-0.5 flex-shrink-0 ${sv.color}`}>
                {sv.icon}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-on-surface leading-snug">{iss.message_ru}</p>
                {iss.hint_ru && <p className="text-[11px] text-on-surface-variant mt-0.5">{iss.hint_ru}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
