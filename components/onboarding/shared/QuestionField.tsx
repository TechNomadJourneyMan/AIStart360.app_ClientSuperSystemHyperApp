'use client'

import { useId, type ReactNode } from 'react'
import Link from 'next/link'
import { NumberField } from './NumberField'
import { TermHint } from './TermHint'
import { isUnknownAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import type { SurveyQuestion } from '@/lib/survey/questions'

/**
 * One questionnaire field rendered from the registry (lib/survey/questions.ts;
 * spec 2026-10-23 §13 `QuestionField`) — the same inputs in «Мои ответы»
 * (inline edit), the express flow and the deepening blocks:
 *   number / money / %  → NumberField (thousands, unit, «Не знаю», «примерно»);
 *   choice              → a select; multi-choice → chips (`aria-pressed`);
 *   yes / no            → two buttons, NONE pressed by default (an untouched
 *                         «нет» would read as a deliberate «нет» in Point A v4);
 *   scale               → 1…10 buttons;
 *   text / long text    → input / textarea; «Не считаем» when the question allows «не знаю»;
 *   table / file        → a link to the field in the full questionnaire.
 * The step forms of the full questionnaire keep their own JSX (spec §3).
 */

const INPUT = 'w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20'
const CHIP = 'px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium border transition-colors'
const chipTone = (on: boolean) => (on ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20')

/** Where a table / file question lives in the full questionnaire. */
export const fullFormHref = (q: Pick<SurveyQuestion, 'step' | 'key'>): string => `/client/onboarding?step=${q.step}#${q.key}`

export interface QuestionInputProps {
  question: SurveyQuestion
  value: unknown
  onChange: (value: unknown) => void
  /** id of the input (labels point at it). */
  fieldId: string
  /** The accessible name (NumberField shows it as its label). */
  label: ReactNode
  /** id of the element that names a group (multi-choice, yes/no, scale) — else `label` is used. */
  labelledBy?: string
}

/** The bare input of a question (no label line around it). */
export function QuestionInput({ question: q, value, onChange, fieldId, label, labelledBy }: QuestionInputProps) {
  const groupName = labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': typeof label === 'string' ? label : q.label }
  switch (q.type) {
    case 'number':
    case 'money':
    case 'percent':
    case 'auto':
      return (
        <NumberField
          id={fieldId}
          label={label}
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
          <label htmlFor={fieldId} className="sr-only">{label}</label>
          <select id={fieldId} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} className={INPUT}>
            <option value="">— Выберите —</option>
            {q.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div role="group" {...groupName} id={fieldId} className="flex flex-wrap gap-2">
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
      return (
        <div role="group" {...groupName} id={fieldId} className="flex gap-2">
          {([true, false] as const).map((b) => (
            <button key={String(b)} type="button" aria-pressed={value === b} className={`${CHIP} ${chipTone(value === b)} min-w-[88px]`} onClick={() => onChange(b)}>
              {b ? 'Да' : 'Нет'}
            </button>
          ))}
        </div>
      )
    case 'scale': {
      const [min, max] = q.range ?? [1, 10]
      return (
        <div role="group" {...groupName} id={fieldId} className="flex flex-wrap gap-1.5">
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
            <button key={n} type="button" aria-pressed={value === n} className={`${CHIP} ${chipTone(value === n)} min-w-[44px]`} onClick={() => onChange(n)}>
              {n}
            </button>
          ))}
        </div>
      )
    }
    case 'table':
    case 'file':
      return (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-on-surface-variant">
          {q.type === 'table' ? 'Таблицу удобнее заполнить в полной анкете (на телефоне — или загрузите выгрузку).' : 'Файл загружается в полной анкете.'}{' '}
          <Link id={fieldId} href={fullFormHref(q)} className="inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline">
            Заполнить в полной анкете →
          </Link>
        </p>
      )
    default:
      return <TextInput question={q} value={value} onChange={onChange} fieldId={fieldId} label={label} />
  }
}

function TextInput({ question: q, value, onChange, fieldId, label }: Omit<QuestionInputProps, 'labelledBy'>) {
  const unknown = isUnknownAnswer(value)
  const text = typeof value === 'string' ? value : ''
  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="sr-only">{label}</label>
      {q.type === 'longtext' ? (
        <textarea id={fieldId} rows={4} value={text} disabled={unknown} onChange={(e) => onChange(e.target.value)} className={`${INPUT} resize-y disabled:opacity-60`} />
      ) : (
        <input id={fieldId} type="text" value={text} disabled={unknown} onChange={(e) => onChange(e.target.value)} className={`${INPUT} disabled:opacity-60`} />
      )}
      {q.allowUnknown && (
        <button type="button" aria-pressed={unknown} onClick={() => onChange(unknown ? '' : unknownAnswer())}
          className={`px-2.5 py-1 min-h-[32px] rounded-lg text-[11px] font-medium border transition-colors ${unknown ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-white/[0.02] border-white/[0.08] text-on-surface-variant hover:border-white/20'}`}>
          Не знаю / не считаем
        </button>
      )}
    </div>
  )
}

export interface QuestionFieldProps {
  question: SurveyQuestion
  value: unknown
  onChange: (value: unknown) => void
  /** The label shown: the plain-words question when there is one (express, blocks). */
  plain?: boolean
  /** The label is announced but not shown (a one-question screen whose heading asks it). */
  labelledBy?: string
  /** A «зачем» line under the label (the registry `why` when absent). */
  why?: string | null
  /** Extra content under the input (a calculation, the author line). */
  children?: ReactNode
}

/** A question with its label, term hint, «зачем» and «где взять» — then the input. */
export function QuestionField({ question: q, value, onChange, plain = true, labelledBy, why, children }: QuestionFieldProps) {
  const labelId = useId()
  const text = (plain && q.plain) || q.label
  const visibleLabel = !labelledBy
  const nameId = labelledBy ?? labelId
  const whyLine = why === undefined ? q.why ?? null : why
  const numeric = q.type === 'number' || q.type === 'money' || q.type === 'percent' || q.type === 'auto'
  const labelNode = (
    <>
      {text}
      {q.term && <TermHint term={q.term} />}
    </>
  )
  return (
    <div className="space-y-2" data-question={q.key}>
      {visibleLabel && !numeric && (
        <p id={labelId} className="text-sm font-semibold text-on-surface leading-snug">{labelNode}</p>
      )}
      {whyLine && <p className="text-[11px] leading-snug text-on-surface-variant/80">{whyLine}</p>}
      <QuestionInput
        question={q}
        value={value}
        onChange={onChange}
        fieldId={q.key}
        label={!numeric ? text : visibleLabel ? labelNode : <span className="sr-only">{text}</span>}
        labelledBy={q.type === 'multiselect' || q.type === 'bool' || q.type === 'scale' ? nameId : undefined}
      />
      {q.whereToFind && (
        <details className="text-[11px] text-on-surface-variant/80">
          <summary className="inline-flex min-h-[32px] cursor-pointer select-none items-center gap-1 text-primary/80 hover:text-primary">
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">travel_explore</span>Где взять цифру?
          </summary>
          <p className="mt-1 leading-snug">{q.whereToFind}</p>
        </details>
      )}
      {children}
    </div>
  )
}
