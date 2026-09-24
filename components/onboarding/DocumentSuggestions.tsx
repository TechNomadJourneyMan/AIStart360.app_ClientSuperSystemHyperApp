'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Chips «Из документа: 12 500 000 ₸ · Принять» for the current wizard step
 * (F-076). Values come from the user's parsed documents
 * (GET /api/v1/onboarding/suggestions). Accepting hands the value to the
 * wizard's own `onApply` (= the normal field change → autosave path), so a
 * suggestion is saved exactly like a typed answer. A field that already has a
 * value never shows a chip, and the server refuses to accept over an answer.
 */

interface Suggestion {
  id: string
  question_key: string
  value: unknown
  label: string | null
  document_name: string | null
  step: number | null
}

function isEmptyAnswer(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (typeof v === 'number') return !Number.isFinite(v) || v === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

export function formatSuggestionValue(value: unknown, label: string | null): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  const l = (label ?? '').toLowerCase()
  const num = n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  if (l.includes('%')) return `${num} %`
  if (l.includes('дней')) return `${num} дн.`
  if (l.includes('сотрудник') || l.includes('лидов')) return num
  return `${num} ₸`
}

export default function DocumentSuggestions({ step, answers, onApply }: {
  step: number
  answers: Record<string, unknown>
  onApply: (key: string, value: unknown) => void
}) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/onboarding/suggestions', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.ok && Array.isArray(j.data)) setItems(j.data as Suggestion[]) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const decide = useCallback(async (s: Suggestion, action: 'accept' | 'reject') => {
    setBusy(s.id)
    setNote(null)
    try {
      // Never overwrite: the local form may already hold a typed (unsaved) value.
      if (action === 'accept' && !isEmptyAnswer(answers[s.question_key])) {
        await fetch(`/api/v1/onboarding/suggestions/${s.id}/reject`, { method: 'POST', credentials: 'include' }).catch(() => {})
        setNote('В этом поле уже есть ваш ответ — оставили его.')
        return
      }
      const res = await fetch(`/api/v1/onboarding/suggestions/${s.id}/${action}`, { method: 'POST', credentials: 'include' })
      const j = await res.json().catch(() => null)
      if (action === 'accept') {
        if (res.ok && j?.ok) onApply(s.question_key, j.data?.value ?? s.value)
        else setNote(j?.error ?? 'Не удалось принять подсказку')
      }
      if (res.ok || res.status === 409 || res.status === 404) {
        setItems((prev) => prev.filter((x) => x.id !== s.id))
      }
    } finally {
      setBusy(null)
    }
  }, [answers, onApply])

  const visible = items.filter((s) => s.step === step && isEmptyAnswer(answers[s.question_key]))
  if (visible.length === 0 && !note) return null

  return (
    <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4" aria-live="polite">
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-on-surface">
        <span className="material-symbols-outlined text-base text-primary">description</span>
        Нашли в ваших документах — проверьте и примите
      </p>
      <ul className="flex flex-col gap-2">
        {visible.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => document.getElementById(s.question_key)?.focus()}
              className="text-on-surface-variant hover:text-on-surface hover:underline"
              title={s.document_name ? `Источник: ${s.document_name}` : undefined}
            >
              {s.label ?? s.question_key}
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-on-surface">
              <span>Из документа: <b className="font-semibold">{formatSuggestionValue(s.value, s.label)}</b></span>
              <span aria-hidden="true" className="text-on-surface-variant">·</span>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={() => void decide(s, 'accept')}
                className="font-semibold text-primary hover:underline disabled:opacity-50"
              >
                Принять
              </button>
            </span>
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => void decide(s, 'reject')}
              aria-label={`Скрыть подсказку «${s.label ?? s.question_key}»`}
              className="rounded-full p-1 text-on-surface-variant hover:text-on-surface disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-[11px] text-on-surface-variant">{note}</p>}
    </div>
  )
}
