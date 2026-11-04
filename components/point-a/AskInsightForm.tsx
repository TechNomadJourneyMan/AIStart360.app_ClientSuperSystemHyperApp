'use client'

/**
 * AskInsightForm — staff (expert / admin) authors a clarifying question that
 * lands in a client's Point A "Уточняющие вопросы" feed. Posts to
 * /api/v1/point-a/insights/ask; the client sees it instantly via Realtime.
 *
 * Used in the expert cabinet (PointATab) and the Giga admin panel.
 */

import { useState } from 'react'

const CATEGORIES = [
  'ВЫРУЧКА',
  'СТРАТЕГИЯ',
  'ВОРОНКА',
  'КЛИЕНТЫ',
  'ОРГСТРУКТУРА',
  'КОНКУРЕНТЫ',
  'ОПЕРАЦИИ',
  'ФИНАНСЫ',
  'МАРКЕТИНГ',
  'ПРОДУКТ',
] as const

interface Props {
  /** The client's Supabase auth user id (point_a_insights.user_id). */
  clientUserId: string
  /** Called after a question is successfully created. */
  onCreated?: () => void
  className?: string
}

export function AskInsightForm({ clientUserId, onCreated, className }: Props) {
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const canSubmit = text.trim().length >= 4 && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/v1/point-a/insights/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_user_id: clientUserId,
          category,
          question_text: text.trim(),
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        setResult({ kind: 'err', msg: json?.error ?? `Ошибка (${res.status})` })
        return
      }
      setResult({ kind: 'ok', msg: 'Вопрос отправлен клиенту' })
      setText('')
      onCreated?.()
    } catch {
      setResult({ kind: 'err', msg: 'Сеть недоступна' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-primary text-lg">contact_support</span>
        <h4 className="text-sm font-semibold text-on-surface">Задать вопрос клиенту</h4>
      </div>

      <div className="flex flex-col gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl bg-surface-container border border-white/[0.08] text-xs text-on-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Например: Планируете ли вы открывать второе направление в ближайшие 6 месяцев?"
          className="rounded-xl bg-surface-container border border-white/[0.08] text-sm text-on-surface px-3 py-2 placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
        />

        <div className="flex items-center justify-between gap-3">
          {result ? (
            <span
              className={`text-xs ${result.kind === 'ok' ? 'text-primary' : 'text-error'}`}
            >
              {result.msg}
            </span>
          ) : (
            <span className="text-[11px] text-on-surface-variant">
              Появится у клиента в ленте «Уточняющие вопросы» в реальном времени
            </span>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary/15 border border-primary/40 text-primary text-xs font-semibold px-4 py-2 hover:bg-primary/25 transition-colors disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className={`material-symbols-outlined text-[16px] ${submitting ? 'animate-spin' : ''}`}>
              {submitting ? 'progress_activity' : 'send'}
            </span>
            Отправить
          </button>
        </div>
      </div>
    </div>
  )
}

export default AskInsightForm
