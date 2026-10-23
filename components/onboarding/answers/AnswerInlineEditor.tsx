'use client'

import { useId, useState } from 'react'
import { NumberField } from '@/components/onboarding/shared/NumberField'
import { isAnswerFilled } from '@/lib/survey/answer-filled'
import type { SurveyQuestion } from '@/lib/survey/questions'

export type SaveAnswer = (key: string, value: unknown, reason?: string) => Promise<{ ok: true } | { ok: false; error: string }>

const INPUT = 'w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-base text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20'
const CHIP = 'px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium border transition-colors'
const chipTone = (on: boolean) => (on ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20')

/**
 * In-place editor of one short answer in «Мои ответы» and the staff view
 * (spec §6.3): the field is chosen by the registry type (number / money / %
 * with «Не знаю» and «примерно» as in the form, choice, chips, yes / no
 * without a default, a 1–10 scale, a line of text). Saving is explicit.
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
      <Field question={question} value={draft} onChange={setDraft} fieldId={fieldId} />
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

function Field({ question: q, value, onChange, fieldId }: { question: SurveyQuestion; value: unknown; onChange: (v: unknown) => void; fieldId: string }) {
  switch (q.type) {
    case 'number':
    case 'money':
    case 'percent':
      return (
        <NumberField
          id={fieldId}
          label={q.label}
          value={value}
          onChange={onChange}
          unit={q.unit}
          integer={q.integer}
          allowNegative={q.allowNegative}
          allowUnknown={q.allowUnknown}
          allowApprox={q.allowApprox}
          max={q.type === 'percent' ? 100 : undefined}
        />
      )
    case 'select':
      return (
        <div>
          <label htmlFor={fieldId} className="sr-only">{q.label}</label>
          <select id={fieldId} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} className={INPUT}>
            <option value="">— Выберите —</option>
            {q.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div role="group" aria-label={q.label} className="flex flex-wrap gap-2">
          {q.options?.map((o) => {
            const on = selected.includes(o.value)
            return (
              <button key={o.value} type="button" aria-pressed={on} className={`${CHIP} ${chipTone(on)}`}
                onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}>
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    case 'bool':
      // Two buttons, none pressed by default: an untouched «нет» is not an answer.
      return (
        <div role="group" aria-label={q.label} className="flex gap-2">
          {([true, false] as const).map((b) => (
            <button key={String(b)} type="button" aria-pressed={value === b} className={`${CHIP} ${chipTone(value === b)} min-w-[72px]`} onClick={() => onChange(b)}>
              {b ? 'Да' : 'Нет'}
            </button>
          ))}
        </div>
      )
    case 'scale': {
      const [min, max] = q.range ?? [1, 10]
      return (
        <div role="group" aria-label={q.label} className="flex flex-wrap gap-1.5">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
            <button key={n} type="button" aria-pressed={value === n} className={`${CHIP} ${chipTone(value === n)} min-w-[44px]`} onClick={() => onChange(n)}>
              {n}
            </button>
          ))}
        </div>
      )
    }
    case 'longtext':
      return (
        <div>
          <label htmlFor={fieldId} className="sr-only">{q.label}</label>
          <textarea id={fieldId} rows={4} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={`${INPUT} resize-y`} />
        </div>
      )
    default:
      return (
        <div>
          <label htmlFor={fieldId} className="sr-only">{q.label}</label>
          <input id={fieldId} type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={INPUT} />
        </div>
      )
  }
}
