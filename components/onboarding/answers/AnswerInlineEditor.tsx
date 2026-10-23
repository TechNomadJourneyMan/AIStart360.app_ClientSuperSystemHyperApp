'use client'

import { useId, useState } from 'react'
import { QuestionInput } from '@/components/onboarding/shared/QuestionField'
import { isAnswerFilled } from '@/lib/survey/answer-filled'
import type { SurveyQuestion } from '@/lib/survey/questions'

export type SaveAnswer = (key: string, value: unknown, reason?: string) => Promise<{ ok: true } | { ok: false; error: string }>

const INPUT = 'w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-base text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20'

/**
 * In-place editor of one short answer in «Мои ответы» and the staff view
 * (spec §6.3): the field is chosen by the registry type (shared/QuestionField
 * — the same inputs as the express flow and the blocks: number / money / %
 * with «Не знаю» and «примерно», choice, chips, yes / no without a default,
 * a 1–10 scale, a line of text). Saving is explicit.
 */
export function AnswerInlineEditor({ question, value, onSave, onCancel, requireReason = false, reasonOptional = false }: {
  question: SurveyQuestion
  value: unknown
  onSave: SaveAnswer
  onCancel: () => void
  /** Staff edits: the reason goes to the audit log (expert: required). */
  requireReason?: boolean
  reasonOptional?: boolean
}) {
  const [draft, setDraft] = useState<unknown>(value)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const fieldId = `${id}-${question.key}`
  const askReason = requireReason || reasonOptional

  const save = async () => {
    if (requireReason && reason.trim().length < 3) { setError('Укажите причину изменения'); return }
    setSaving(true)
    setError(null)
    const res = await onSave(question.key, isAnswerFilled(draft) ? draft : null, askReason ? reason.trim() || undefined : undefined)
    setSaving(false)
    if (!res.ok) setError(res.error)
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-3 print:hidden" role="group" aria-label={`Изменить: ${question.label}`}>
      <QuestionInput question={question} value={draft} onChange={setDraft} fieldId={fieldId} label={question.label} />
      {askReason && (
        <div>
          <label htmlFor={`${id}-reason`} className="block text-[11px] text-on-surface-variant mb-1">
            Причина изменения{requireReason ? '' : ' (необязательно)'} — увидит клиент и журнал
          </label>
          <input id={`${id}-reason`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={INPUT} />
        </div>
      )}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving} className="min-h-[44px] px-4 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-60">
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="min-h-[44px] px-4 rounded-xl border border-white/10 text-sm text-on-surface-variant hover:text-on-surface">
          Отмена
        </button>
      </div>
    </div>
  )
}
