'use client'

/**
 * ExpertReviewQueue — report versions waiting for the expert (status
 * 'in_review', migration 103) in the Expert Portal (/expert/reports).
 *
 * Each card: client, «Версия N · дата», content counts, the PDF of exactly
 * this version (GET /api/expert/reports/:id/pdf, watermark «На проверке
 * эксперта») and the two decisions (POST /api/expert/reports/:id/review):
 *   «Подтвердить и опубликовать» — the client sees the report at once;
 *   «Нужны правки» — a comment (≥ 3 characters), the report agent rebuilds.
 * The server re-checks role, approval, 2FA and status; a decision a colleague
 * already took comes back as 409 and the card says so.
 */
import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface ExpertReviewItem {
  id: string
  company_name: string | null
  company_id: string
  title: string
  stamp: string
  findings: number
  recommendations: number
}

type CardState =
  | { kind: 'idle' }
  | { kind: 'comment'; text: string }
  | { kind: 'busy' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string }

const BTN_PRIMARY = 'inline-flex items-center gap-1.5 rounded-xl bg-primary text-on-primary text-xs font-semibold px-3.5 py-2 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50'
const BTN_GHOST = 'inline-flex items-center gap-1.5 rounded-xl border border-white/10 text-on-surface-variant text-xs font-medium px-3.5 py-2 hover:text-on-surface hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50'

function Icon({ name }: { name: string }) {
  return <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{name}</span>
}

function ReviewCard({ item, focused }: { item: ExpertReviewItem; focused: boolean }) {
  const [state, setState] = useState<CardState>({ kind: 'idle' })

  const send = async (decision: 'approve' | 'changes_requested', comment?: string) => {
    setState({ kind: 'busy' })
    try {
      const res = await fetch(`/api/expert/reports/${item.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decision === 'approve' ? { decision } : { decision, comment }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.ok) {
        const rerun = body.rerun as { state: string; attempt: number; max: number } | null
        return setState({
          kind: 'done',
          text: decision === 'approve'
            ? (body.already ? 'Уже опубликовано ранее.' : 'Опубликовано: клиент видит отчёт и получил уведомление.')
            : rerun?.state === 'queued'
              ? `Правки отправлены. Агент пересоберёт отчёт (попытка ${rerun.attempt} из ${rerun.max}) — новая версия появится здесь.`
              : rerun?.state === 'cap_reached'
                ? `Правки сохранены. Лимит пересборок (${rerun.max}) исчерпан — команда получила уведомление.`
                : 'Правки сохранены; команда получила уведомление.',
        })
      }
      if (res.status === 409) {
        return setState({ kind: 'done', text: body?.decided === 'approve' ? 'Коллега уже подтвердил эту версию — она опубликована.' : 'Версия больше не ждёт проверки.' })
      }
      setState({ kind: 'error', text: body?.error ?? `Ошибка сервера (${res.status})` })
    } catch {
      setState({ kind: 'error', text: 'Нет связи с сервером' })
    }
  }

  const busy = state.kind === 'busy'
  return (
    <li
      id={`review-${item.id}`}
      className={cn('rounded-2xl border bg-surface-container-low p-4 sm:p-5', focused ? 'border-primary/40' : 'border-white/[0.04]')}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-on-surface">{item.company_name ?? item.company_id}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">{item.title}</p>
          <p className="text-[11px] font-mono text-on-surface-variant mt-1">
            {item.stamp} · выводов {item.findings} · рекомендаций {item.recommendations}
          </p>
        </div>
        <a href={`/api/expert/reports/${item.id}/pdf`} target="_blank" rel="noreferrer" className={BTN_GHOST} aria-label={`Открыть PDF: ${item.company_name ?? ''}, ${item.stamp}`}>
          <Icon name="picture_as_pdf" /> PDF
        </a>
      </div>

      {state.kind === 'done' ? (
        <p role="status" className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-on-surface">{state.text}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {state.kind === 'comment' && (
            <label className="block">
              <span className="text-[11px] text-on-surface-variant">Что поправить (от 3 символов)</span>
              <textarea
                value={state.text}
                maxLength={2000}
                rows={3}
                onChange={(e) => setState({ kind: 'comment', text: e.target.value })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Например: выручка в выводе по финансам не совпадает с P&L"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {state.kind === 'comment' ? (
              <>
                <button type="button" className={BTN_PRIMARY} disabled={state.text.trim().length < 3} onClick={() => void send('changes_requested', state.text.trim())}>
                  <Icon name="send" /> Отправить правки
                </button>
                <button type="button" className={BTN_GHOST} onClick={() => setState({ kind: 'idle' })}>Отмена</button>
              </>
            ) : (
              <>
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void send('approve')}>
                  <Icon name="check" /> Подтвердить и опубликовать
                </button>
                <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setState({ kind: 'comment', text: '' })}>
                  <Icon name="edit" /> Нужны правки
                </button>
              </>
            )}
          </div>
          {state.kind === 'error' && <p role="alert" className="text-xs text-error">{state.text}</p>}
        </div>
      )}
    </li>
  )
}

export function ExpertReviewQueue({ items, focusId }: { items: ExpertReviewItem[]; focusId: string | null }) {
  return (
    <ul className="space-y-3" aria-label="Отчёты на проверке">
      {items.map((i) => <ReviewCard key={i.id} item={i} focused={i.id === focusId} />)}
    </ul>
  )
}
