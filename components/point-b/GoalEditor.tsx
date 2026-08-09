'use client'

// ============================================================
// Goal editing for Точка Б.
//
// The goal numbers shown in the hero are read from companies.target_revenue_*
// (canonical, written by the Точка А goal widget) with the survey as fallback —
// see lib/point-b/engine.ts:calculatePointBV2. So the only honest place to edit
// them is PATCH /api/v1/companies/targets, which writes exactly those columns.
// The container owns the request; these components own the form.
//
// Both columns hold ANNUAL revenue (target_revenue_3y_kzt = выручка в 3-й год,
// не сумма за три года) — same convention as GrowthSnapshotHero and the export
// route. The «₸/мес» field is a convenience mirror: year = month × 12.
// ============================================================

import { useId, useState, type FormEvent } from 'react'
import { formatMoneyFull } from './shared'

export interface GoalPatch {
  target_revenue_12m_kzt?: number | null
  target_revenue_3y_kzt?: number | null
}

/** Parse a user-typed amount ("291 100 000", "291100000") → positive number or null. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '.').replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ─── One linked pair of inputs (₸/год ↔ ₸/мес) ───────────────────────────────

function AmountPair({
  idBase,
  legend,
  yearStr,
  monthStr,
  onYear,
  onMonth,
  invalid,
  describedBy,
}: {
  idBase: string
  legend: string
  yearStr: string
  monthStr: string
  onYear: (v: string) => void
  onMonth: (v: string) => void
  invalid: boolean
  describedBy?: string
}) {
  const parsed = parseAmount(yearStr)
  return (
    <fieldset className="min-w-0">
      <legend className="text-[10px] font-mono text-primary/80 uppercase tracking-widest mb-2">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor={`${idBase}-year`} className="block text-[11px] text-on-surface-variant mb-1">
            ₸ в год
          </label>
          <input
            id={`${idBase}-year`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={yearStr}
            onChange={(e) => onYear(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-full bg-surface-container-high border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
            placeholder="291100000"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label htmlFor={`${idBase}-month`} className="block text-[11px] text-on-surface-variant mb-1">
            ₸ в месяц
          </label>
          <input
            id={`${idBase}-month`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={monthStr}
            onChange={(e) => onMonth(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="w-full bg-surface-container-high border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
            placeholder="24258333"
          />
        </div>
      </div>
      {parsed != null && (
        <p className="text-[11px] font-mono text-on-surface-variant mt-1.5">
          {formatMoneyFull(parsed)} в год · {formatMoneyFull(Math.round(parsed / 12))} в месяц
        </p>
      )}
    </fieldset>
  )
}

function useLinkedAmount(initial: number | null) {
  const [yearStr, setYearStr] = useState(initial != null ? String(Math.round(initial)) : '')
  const [monthStr, setMonthStr] = useState(initial != null ? String(Math.round(initial / 12)) : '')

  const onYear = (v: string) => {
    setYearStr(v)
    const n = parseAmount(v)
    setMonthStr(n != null ? String(Math.round(n / 12)) : '')
  }
  const onMonth = (v: string) => {
    setMonthStr(v)
    const n = parseAmount(v)
    setYearStr(n != null ? String(Math.round(n * 12)) : '')
  }

  return { yearStr, monthStr, onYear, onMonth, value: parseAmount(yearStr) }
}

// ─── Single-horizon form (used inside a hero goal card) ──────────────────────

export function GoalForm({
  horizon,
  initialYear,
  onSave,
  onCancel,
}: {
  horizon: '12m' | '3y'
  initialYear: number | null
  /** Saves the ANNUAL target for this horizon. Rejects → error is shown inline. */
  onSave: (patch: GoalPatch) => Promise<void>
  onCancel?: () => void
}) {
  const uid = useId()
  const amount = useLinkedAmount(initialYear)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (amount.value == null) {
      setErr('Введите цель числом больше нуля — например 291100000')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      await onSave(
        horizon === '12m'
          ? { target_revenue_12m_kzt: amount.value }
          : { target_revenue_3y_kzt: amount.value },
      )
      setDone(true)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Не удалось сохранить цель')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <AmountPair
        idBase={uid}
        legend={horizon === '12m' ? 'Цель на 12 месяцев' : 'Цель на 3 года'}
        yearStr={amount.yearStr}
        monthStr={amount.monthStr}
        onYear={amount.onYear}
        onMonth={amount.onMonth}
        invalid={!!err}
        describedBy={err ? `${uid}-err` : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-sm px-4 py-2 rounded-lg transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`} aria-hidden>
            {saving ? 'progress_activity' : 'save'}
          </span>
          {saving ? 'Сохраняем…' : 'Сохранить цель'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-mono text-on-surface-variant hover:text-on-surface border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Отмена
          </button>
        )}
      </div>

      {err && (
        <p id={`${uid}-err`} role="alert" className="text-xs text-error">
          {err}
        </p>
      )}
      {done && !err && (
        <p role="status" className="text-xs text-primary">
          Цель сохранена — Точка Б пересчитана.
        </p>
      )}
    </form>
  )
}

// ─── Both horizons at once (used in the «недостаточно данных» panel) ─────────

export function GoalsQuickInput({
  initial12m,
  initial3y,
  onSave,
}: {
  initial12m: number | null
  initial3y: number | null
  onSave: (patch: GoalPatch) => Promise<void>
}) {
  const uid = useId()
  const a12 = useLinkedAmount(initial12m)
  const a3y = useLinkedAmount(initial3y)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a12.value == null && a3y.value == null) {
      setErr('Заполните хотя бы одну цель — на 12 месяцев или на 3 года')
      return
    }
    setErr(null)
    setSaving(true)
    try {
      const patch: GoalPatch = {}
      if (a12.value != null) patch.target_revenue_12m_kzt = a12.value
      if (a3y.value != null) patch.target_revenue_3y_kzt = a3y.value
      await onSave(patch)
      setDone(true)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Не удалось сохранить цели')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-surface-container/60 border border-primary/20 p-3.5 space-y-3">
      <p className="text-[10px] font-mono text-primary/80 uppercase tracking-widest">
        Указать цель по выручке сейчас
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AmountPair
          idBase={`${uid}-12m`}
          legend="Цель на 12 месяцев"
          yearStr={a12.yearStr}
          monthStr={a12.monthStr}
          onYear={a12.onYear}
          onMonth={a12.onMonth}
          invalid={!!err}
          describedBy={err ? `${uid}-err` : undefined}
        />
        <AmountPair
          idBase={`${uid}-3y`}
          legend="Цель на 3 года (выручка 3-го года)"
          yearStr={a3y.yearStr}
          monthStr={a3y.monthStr}
          onYear={a3y.onYear}
          onMonth={a3y.onMonth}
          invalid={!!err}
          describedBy={err ? `${uid}-err` : undefined}
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-sm px-4 py-2 rounded-lg transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`} aria-hidden>
          {saving ? 'progress_activity' : 'save'}
        </span>
        {saving ? 'Сохраняем…' : 'Сохранить и пересчитать'}
      </button>

      {err && (
        <p id={`${uid}-err`} role="alert" className="text-xs text-error">
          {err}
        </p>
      )}
      {done && !err && (
        <p role="status" className="text-xs text-primary">
          Цели сохранены — Точка Б пересчитана.
        </p>
      )}
    </form>
  )
}
