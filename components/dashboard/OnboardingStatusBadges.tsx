'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Status {
  survey: {
    completed_steps: number
    total_steps: number
    percent: number
    is_complete: boolean
    current_goal_12m: string | null
    current_goal_3y: string | null
  }
  documents: {
    count: number
    has_files: boolean
  }
}

interface Props {
  variant?: 'inline' | 'stack'
  // When true, hide the badges entirely if both sources are complete.
  hideWhenComplete?: boolean
}

/**
 * OnboardingStatusBadges — twin indicator buttons that pulse when the
 * underlying source is incomplete. Used across Dashboard / GRI / Point A /
 * Metrics so the user always has a clear next action.
 *
 *  • Survey complete    → quiet primary badge "Анкета · 100%"
 *  • Survey incomplete  → pulsing amber badge "Заполнить анкету · N%"
 *  • Documents present  → quiet primary badge "Документы · N"
 *  • Documents missing  → pulsing amber badge "Прикрепить файлы"
 */
export function OnboardingStatusBadges({ variant = 'inline', hideWhenComplete = false }: Props) {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/onboarding/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j.ok) setStatus(j.data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className={`${variant === 'stack' ? 'flex flex-col' : 'flex'} gap-1.5`}>
        <span className="h-7 w-32 rounded-lg bg-surface-container animate-pulse" />
        <span className="h-7 w-32 rounded-lg bg-surface-container animate-pulse" />
      </div>
    )
  }

  if (!status) return null

  const surveyDone = status.survey.is_complete
  const docsDone = status.documents.has_files

  if (hideWhenComplete && surveyDone && docsDone) return null

  const containerClass = variant === 'stack' ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-center gap-1.5'

  return (
    <div className={containerClass}>
      <Link
        href="/client/onboarding"
        className={`relative inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1.5 rounded-lg border transition-all ${
          surveyDone
            ? 'bg-primary/[0.06] text-primary/80 border-primary/20 hover:bg-primary/10'
            : 'bg-amber-400/10 text-amber-400 border-amber-400/40 hover:bg-amber-400/15'
        }`}
        title={surveyDone ? 'Анкета заполнена полностью' : `Заполните анкету — ${status.survey.percent}% готово`}
      >
        {!surveyDone && (
          <span className="absolute -top-1 -right-1 flex w-2.5 h-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
          </span>
        )}
        <span className="material-symbols-outlined text-[14px]">
          {surveyDone ? 'task_alt' : 'edit_note'}
        </span>
        <span className="whitespace-nowrap">
          {surveyDone ? 'Анкета · 100%' : `Заполнить · ${status.survey.percent}%`}
        </span>
        {!surveyDone && (
          <span className="w-12 h-1 bg-amber-400/20 rounded-full overflow-hidden">
            <span
              className="block h-full bg-amber-400"
              style={{ width: `${status.survey.percent}%` }}
            />
          </span>
        )}
      </Link>

      <Link
        href="/client/onboarding/documents"
        className={`relative inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1.5 rounded-lg border transition-all ${
          docsDone
            ? 'bg-primary/[0.06] text-primary/80 border-primary/20 hover:bg-primary/10'
            : 'bg-amber-400/10 text-amber-400 border-amber-400/40 hover:bg-amber-400/15'
        }`}
        title={docsDone ? `Загружено документов: ${status.documents.count}` : 'Прикрепите финансовые документы'}
      >
        {!docsDone && (
          <span className="absolute -top-1 -right-1 flex w-2.5 h-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
          </span>
        )}
        <span className="material-symbols-outlined text-[14px]">
          {docsDone ? 'folder_open' : 'upload_file'}
        </span>
        <span className="whitespace-nowrap">
          {docsDone ? `Документы · ${status.documents.count}` : 'Прикрепить файлы'}
        </span>
      </Link>
    </div>
  )
}
