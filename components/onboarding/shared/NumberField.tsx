'use client'

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { FieldLabel } from './FieldLabel'
import { approxAnswer, formatMarkedAnswer, isApproxAnswer, isUnknownAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import {
  approxDraftFromValue, commitApproxDraft, formatNumberDraft, numberDraftFromValue, parseNumberDraft, type NumberDraftOptions,
} from '@/lib/survey/number-input'

/**
 * One number field for the whole questionnaire (survey audit 2026-10-22, MVP
 * items 3 and 4):
 *  • `inputMode="decimal"` (`numeric` for whole numbers) — the phone shows digits;
 *  • «1 500 000» while typing, the unit on the right (₸, ₸/мес, %, чел.), 16 px;
 *  • a cleared field is null, never 0;
 *  • «Не знаю / не считаем» → `{ value: null, unknown: true }` (counts as answered);
 *  • «Примерно» (money) → «5–6 млн» → `{ value: 5 500 000, approx: true, range }`.
 * A legacy text answer («около 60 %») is shown as typed until edited.
 */
export interface NumberFieldProps {
  /** The question key: the input id (labels, attribution line, answer editor). */
  id: string
  label: React.ReactNode
  value: unknown
  onChange: (value: unknown) => void
  unit?: string
  integer?: boolean
  allowNegative?: boolean
  /** «Не знаю / не считаем» chip (default on). */
  allowUnknown?: boolean
  /** «Примерно» chip — a range for money questions. */
  allowApprox?: boolean
  placeholder?: string
  /** Soft upper bound (e.g. 100 for %): a hint, the value is kept. */
  max?: number
  /** A line under the label: why we ask / «можно пропустить». */
  note?: React.ReactNode
  className?: string
}

// No layout effect during server rendering (it only restores the caret).
const useCaretEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const INPUT_CLASS =
  'w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed'
const CHIP_CLASS = 'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors'
const chipTone = (on: boolean) =>
  on ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-white/[0.02] border-white/[0.08] text-on-surface-variant hover:border-white/20'

export function NumberField({
  id, label, value, onChange, unit, integer, allowNegative, allowUnknown = true, allowApprox = false,
  placeholder, max, note, className,
}: NumberFieldProps) {
  const hintId = useId()
  const opts: NumberDraftOptions = { integer, allowNegative }
  const unknown = isUnknownAnswer(value)
  const [approxMode, setApproxMode] = useState(() => allowApprox && isApproxAnswer(value))
  const canonical = approxMode ? approxDraftFromValue(value) : numberDraftFromValue(value)
  const [text, setText] = useState(canonical)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const caretRef = useRef<number | null>(null)

  // While the field is not being edited it shows the stored value.
  useEffect(() => {
    if (!focused) setText(canonical)
  }, [canonical, focused])

  // Keep the caret after the same digit once separators were inserted.
  useCaretEffect(() => {
    const c = caretRef.current
    if (c === null || !inputRef.current || document.activeElement !== inputRef.current) return
    inputRef.current.setSelectionRange(c, c)
    caretRef.current = null
  })

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (approxMode) {
      setText(raw)
      const a = commitApproxDraft(raw)
      if (a) onChange(a)
      else if (!raw.trim()) onChange(null)
      return
    }
    const { text: next, caret } = formatNumberDraft(raw, e.target.selectionStart ?? raw.length, opts)
    caretRef.current = caret
    setText(next)
    onChange(parseNumberDraft(next))
  }

  const toggleUnknown = () => {
    if (unknown) {
      onChange(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setApproxMode(false)
      onChange(unknownAnswer())
    }
  }

  const toggleApprox = () => {
    if (approxMode) {
      setApproxMode(false)
      // Leaving «примерно»: the midpoint stays as a plain number.
      if (isApproxAnswer(value)) onChange(value.value)
    } else {
      setApproxMode(true)
      if (unknown) onChange(null)
      else if (typeof value === 'number' && Number.isFinite(value)) onChange(approxAnswer(value, value))
    }
  }

  const numeric = typeof value === 'number' ? value : isApproxAnswer(value) ? value.value : null
  const overMax = max !== undefined && numeric !== null && numeric > max
  const approxLine = approxMode && isApproxAnswer(value) ? formatMarkedAnswer(value, unit) : null
  const describedBy = [note ? `${hintId}-note` : null, approxLine || overMax ? `${hintId}-hint` : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {note && <p id={`${hintId}-note`} className="-mt-1 mb-2 text-[11px] leading-snug text-on-surface-variant/70">{note}</p>}
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode={approxMode ? 'text' : integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={unknown ? '' : text}
          disabled={unknown}
          placeholder={unknown ? 'Не знаю' : approxMode ? 'Например: 5–6 млн' : placeholder}
          aria-describedby={describedBy}
          aria-invalid={overMax || undefined}
          onChange={onInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={`${INPUT_CLASS} ${unit ? 'pr-16' : ''}`}
        />
        {unit && (
          <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">
            {unit}
          </span>
        )}
      </div>
      {(allowUnknown || allowApprox) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {allowUnknown && (
            <button type="button" aria-pressed={unknown} onClick={toggleUnknown} className={`${CHIP_CLASS} ${chipTone(unknown)}`}>
              Не знаю / не считаем
            </button>
          )}
          {allowApprox && (
            <button type="button" aria-pressed={approxMode} onClick={toggleApprox} className={`${CHIP_CLASS} ${chipTone(approxMode)}`}>
              Примерно (диапазон)
            </button>
          )}
        </div>
      )}
      {(approxLine || overMax) && (
        <p id={`${hintId}-hint`} className={`mt-1 text-[11px] ${overMax ? 'text-amber-300/90' : 'text-on-surface-variant/70'}`}>
          {overMax ? `Проверьте: больше ${max}${unit ? ` ${unit}` : ''}` : `${approxLine} — середина диапазона пойдёт в расчёты`}
        </p>
      )}
    </div>
  )
}

/** Phone: `type="tel"` (digit keyboard, autofill), 16 px. */
export function PhoneField({ id, label, value, onChange, placeholder }: {
  id: string; label: React.ReactNode; value: unknown; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </div>
  )
}
