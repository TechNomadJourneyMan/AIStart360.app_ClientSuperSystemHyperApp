'use client'

import { cn } from '@/lib/utils'
import {
  PIPELINE_STEPS,
  STAGE_LABELS,
  STALE_QUEUE_MINUTES,
  pipelineStepIndex,
  type DocumentStatusView,
  type DocumentTone,
} from '@/lib/documents/status-view'

const TONE_TEXT: Record<DocumentTone, string> = {
  neutral: 'text-on-surface-variant',
  progress: 'text-primary/80',
  success: 'text-primary',
  warning: 'text-amber-300',
  error: 'text-error',
}

const TONE_CHIP: Record<DocumentTone, string> = {
  neutral: 'bg-white/[0.04] border-white/[0.08]',
  progress: 'bg-primary/[0.06] border-primary/15',
  success: 'bg-primary/10 border-primary/25',
  warning: 'bg-amber-400/10 border-amber-400/20',
  error: 'bg-error/10 border-error/25',
}

export function toneTextClass(tone: DocumentTone): string {
  return TONE_TEXT[tone]
}

/** Compact status chip: icon + short label, exactly as reported by the server. */
export function DocumentStatusChip({ view, className }: { view: DocumentStatusView; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-mono whitespace-nowrap',
        TONE_TEXT[view.tone],
        TONE_CHIP[view.tone],
        className,
      )}
      title={view.detail ? `${view.label}. ${view.detail}` : view.label}
    >
      <span className={cn('material-symbols-outlined text-[13px]', view.tone === 'progress' && 'animate-spin')} aria-hidden>
        {view.icon}
      </span>
      {view.short}
    </span>
  )
}

/** The server's pipeline stages for an in-flight document (no invented percentages). */
export function DocumentStageSteps({ view }: { view: DocumentStatusView }) {
  if (!view.inFlight) return null
  const idx = pipelineStepIndex(view)
  const running = view.tone === 'progress'
  // Queued: the reached stage is complete and nothing runs yet; processing:
  // the reached stage is the one running.
  const doneUpTo = running ? idx - 1 : idx
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Этапы обработки">
      {PIPELINE_STEPS.map((step, i) => {
        const done = i <= doneUpTo
        const current = running && i === idx
        return (
          <li key={step} className="flex items-center gap-1.5">
            {i > 0 && <span className={cn('h-px w-3', done || current ? 'bg-primary/40' : 'bg-white/[0.08]')} aria-hidden />}
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-mono',
                done ? 'text-primary/80' : current ? 'text-primary' : 'text-on-surface-variant/40',
              )}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  done ? 'bg-primary/70' : current ? 'bg-primary animate-pulse' : 'bg-white/[0.12]',
                )}
                aria-hidden
              />
              {STAGE_LABELS[step]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Full status block: label, server detail, stages (in flight) and extraction warnings. */
export function DocumentStatusDetails({
  view,
  showWarnings = true,
  className,
}: {
  view: DocumentStatusView
  showWarnings?: boolean
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className={cn('flex items-center gap-1.5 text-xs font-medium', TONE_TEXT[view.tone])}>
        <span className={cn('material-symbols-outlined text-sm', view.tone === 'progress' && 'animate-spin')} aria-hidden>
          {view.icon}
        </span>
        <span>{view.label}</span>
      </div>
      {view.detail && <p className="text-[11px] leading-relaxed text-on-surface-variant">{view.detail}</p>}
      <DocumentStageSteps view={view} />
      {view.stalled && (
        <p className="text-[11px] text-amber-300">
          Обработка не началась более {STALE_QUEUE_MINUTES} минут. Можно запустить её вручную.
        </p>
      )}
      {showWarnings && view.warnings.length > 0 && (
        <ul className="space-y-1">
          {view.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/90">
              <span className="material-symbols-outlined text-[13px] mt-px" aria-hidden>warning</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
