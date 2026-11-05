'use client'

/**
 * The editor window of the Point A page (PO 2026-11-02): the questions behind
 * a finding or a «что добавить» item, answered in place instead of going back
 * to the wizard. Same fields as «Мои ответы» (shared/QuestionField: number /
 * money / % with «Не знаю» and «примерно», choices, yes / no, text); saved
 * through the wizard's own route (validation, profanity filter, author, path
 * «full», autosave: false → SURVEY_ANSWER_CHANGED → the recalculation queue),
 * then the page refreshes and polls while Point A recalculates.
 *
 * Only for the owner of the company: the route saves the session user's own
 * questionnaire (staff edit a client's answers in GIGA / the expert cabinet).
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { QuestionField } from '@/components/onboarding/shared/QuestionField'
import { questionsForChecks } from '@/lib/point-a/v4/check-questions'
import type { BlockKey } from '@/lib/point-a/v4/config'
import { toAnswerEnvelope } from '@/lib/survey/answer-value'
import { isAnswerFilled } from '@/lib/survey/answer-filled'
import { formatAttribution, type AnswerAttribution } from '@/lib/survey/attribution-label'
import { BTN_GHOST, BTN_PRIMARY, Icon } from './ui'
import { cn } from '@/lib/utils'

export interface AnswerEditRequest {
  block: BlockKey
  /** Checks whose questions are asked, in this order. */
  checks: readonly string[]
  title: string
}

/** «Заполнить: X» of the checklist reads as a title without the verb. */
export function editorTitle(blockTitle: string, what: string): string {
  return `${blockTitle}: ${what.replace(/^(Заполнить|Не заполнено):\s*/i, '')}`
}

const OpenEditor = createContext<((r: AnswerEditRequest) => void) | null>(null)

/** Opens the editor window; null when answers cannot be edited here (staff, preview). */
export function useAnswerEditor(): ((r: AnswerEditRequest) => void) | null {
  return useContext(OpenEditor)
}

/** `previewAnswers` (dev-only /dev/point-a-preview): no requests, nothing is saved. */
export function AnswerEditorProvider({ enabled, onSaved, previewAnswers, attribution = {}, children }: { enabled: boolean; onSaved: () => void; previewAnswers?: Record<string, unknown>; attribution?: Record<string, AnswerAttribution>; children: ReactNode }) {
  const [request, setRequest] = useState<AnswerEditRequest | null>(null)
  const open = useCallback((r: AnswerEditRequest) => setRequest(r), [])
  return (
    <OpenEditor.Provider value={enabled ? open : null}>
      {children}
      {request && <AnswerEditDialog key={`${request.block}:${request.checks.join(',')}`} request={request} onClose={() => setRequest(null)} onSaved={onSaved} previewAnswers={previewAnswers} attribution={attribution} />}
    </OpenEditor.Provider>
  )
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function AnswerEditDialog({ request, onClose, onSaved, previewAnswers, attribution }: { request: AnswerEditRequest; onClose: () => void; onSaved: () => void; previewAnswers?: Record<string, unknown>; attribution: Record<string, AnswerAttribution> }) {
  const questions = useMemo(() => questionsForChecks(request.block, request.checks), [request])
  const [answers, setAnswers] = useState<Record<string, unknown> | null>(previewAnswers ?? null)
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const id = useId()

  useEffect(() => {
    if (previewAnswers) return
    let alive = true
    fetch('/api/v1/onboarding/survey', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        if (!j?.ok) throw new Error()
        setAnswers((j.data?.answers ?? {}) as Record<string, unknown>)
      })
      .catch(() => { if (alive) setError('Не удалось загрузить ответы. Закройте окно и попробуйте ещё раз.') })
    return () => { alive = false }
  }, [previewAnswers])

  const changed = answers ? Object.keys(drafts).filter((k) => !same(drafts[k], answers[k])) : []
  // Tables and files are filled in the full questionnaire (the field links there).
  const editable = questions.some((q) => q.type !== 'table' && q.type !== 'file')

  const save = async () => {
    if (!changed.length || saving) return
    if (previewAnswers) {
      toast.info('Предпросмотр: ответы не сохраняются')
      return onClose()
    }
    setSaving(true)
    setError(null)
    const payload: Record<string, unknown> = {}
    for (const k of changed) payload[k] = toAnswerEnvelope(isAnswerFilled(drafts[k]) ? drafts[k] : null)
    const steps = questions.filter((q) => changed.includes(q.key)).map((q) => q.step)
    try {
      const res = await fetch('/api/v1/onboarding/survey', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: Math.min(...steps), answers: payload, via: 'full', autosave: false }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setError(json?.error || 'Не удалось сохранить. Попробуйте ещё раз.')
        return
      }
      toast.success('Ответы сохранены — Точка А пересчитается в течение минуты')
      onSaved()
      onClose()
    } catch {
      setError('Нет связи с сервером. Попробуйте ещё раз.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={`${id}-hint`}
          className="fixed inset-0 z-[201] flex flex-col bg-surface-container-lowest outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(640px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:border-white/[0.08]"
        >
          <div className="flex items-start gap-3 border-b border-white/[0.06] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-5 sm:pt-5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary/70">Ответы анкеты</p>
              <Dialog.Title className="mt-0.5 text-base font-semibold leading-snug text-on-surface sm:text-lg">{request.title}</Dialog.Title>
              <Dialog.Description id={`${id}-hint`} className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                Ответьте здесь — анкета обновится, а Точка А пересчитается сама. Точной цифры нет — отметьте «Не знаю» или «примерно».
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Закрыть" disabled={saving} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-on-surface-variant hover:bg-white/5 hover:text-on-surface">
                <Icon name="close" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
            {!answers && !error && (
              <p className="flex items-center gap-2 text-sm text-on-surface-variant" aria-live="polite">
                <Icon name="progress_activity" className="animate-spin text-[16px] text-primary" />Загружаем ваши ответы…
              </p>
            )}
            {answers && !questions.length && <p className="text-sm text-on-surface-variant">Здесь нечего заполнить — откройте полную анкету.</p>}
            {answers && questions.map((q) => (
              <QuestionField key={q.key} question={q} value={q.key in drafts ? drafts[q.key] : answers[q.key]} onChange={(v) => setDrafts((d) => ({ ...d, [q.key]: v }))}>
                {/* Who answered and when — the owner reads «вы» (the window is only theirs). */}
                {formatAttribution(attribution[q.key], { viewerIsOwner: true }) && (
                  <p className="text-[11px] text-on-surface-variant">{formatAttribution(attribution[q.key], { viewerIsOwner: true })}</p>
                )}
              </QuestionField>
            ))}
            {error && <p role="alert" className="text-sm text-error">{error}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {editable && (
              <button type="button" className={cn(BTN_PRIMARY, 'disabled:opacity-50')} onClick={() => void save()} disabled={!changed.length || saving} aria-busy={saving}>
                <Icon name={saving ? 'progress_activity' : 'check'} className={saving ? 'animate-spin text-[16px]' : 'text-[16px]'} />
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            )}
            <Dialog.Close asChild>
              <button type="button" className={BTN_GHOST} disabled={saving}>{editable ? 'Отмена' : 'Закрыть'}</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
