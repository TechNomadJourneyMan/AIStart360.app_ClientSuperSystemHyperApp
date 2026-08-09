'use client'

/**
 * InsightCard — one insight that opens up into its justification and leads to
 * an action.
 *
 * Collapsed it shows who asked, about what, and where the question stands.
 * Expanded it shows the *обоснование*: the answer itself, who wrote it, which
 * model produced it, how confident that model was and when. Every one of those
 * fields comes from the row returned by /api/v1/point-a/insights — when a field
 * is absent the card says so instead of filling the gap with something
 * plausible.
 *
 * The footer is a real action, not a label: «Подтвердить»/«Отклонить» PATCH the
 * insight, the rest are links to the screen where the underlying data lives.
 *
 * Not built on `components/point-a/v2/InsightItem`: that card renders its own
 * fixed action row and its props carry no `source_meta`, so there is no seam to
 * hang a justification panel on. The data contract IS shared — see ./types.
 */

import Link from 'next/link'
import { useId, useState } from 'react'

import { useInsightLinks } from './links'
import type { InsightAuthorRole, InsightRecord, InsightStatus } from './types'

// ─── Palettes (kept in step with components/point-a/v2/InsightItem) ──────────

const ROLE: Record<
  InsightAuthorRole,
  { label: string; icon: string; text: string; bg: string; border: string }
> = {
  ai: {
    label: 'ИИ',
    icon: 'auto_awesome',
    text: 'text-purple-300',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
  },
  expert: {
    label: 'Эксперт',
    icon: 'verified',
    text: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/30',
  },
  client: {
    label: 'Клиент',
    icon: 'person',
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  admin: {
    label: 'Админ',
    icon: 'shield_person',
    text: 'text-on-surface',
    bg: 'bg-white/10',
    border: 'border-white/20',
  },
}

const STATUS: Record<InsightStatus, { label: string; tone: string; dot: string }> = {
  pending_ai: { label: 'Ждёт анализа ИИ', tone: 'text-purple-300/80', dot: 'bg-purple-400' },
  pending_confirmation: {
    label: 'Ожидает вашего подтверждения',
    tone: 'text-amber-300/90',
    dot: 'bg-amber-400',
  },
  awaiting_answer: {
    label: 'Ждёт ответа',
    tone: 'text-on-surface-variant',
    dot: 'bg-on-surface-variant/50',
  },
  confirmed: {
    label: 'Подтверждено · учтено в прогнозе',
    tone: 'text-primary/90',
    dot: 'bg-primary',
  },
  rejected: { label: 'Отклонено', tone: 'text-error/90', dot: 'bg-error' },
}

function formatDateTime(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PATCH_ERROR_TEXT: Record<string, string> = {
  unauthorized: 'Сессия истекла — войдите заново.',
  'Insight not found': 'Инсайт больше не доступен — обновите страницу.',
  forbidden_author_role: 'Недостаточно прав для этого действия.',
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  item: InsightRecord
  /** Receives the row the server returned after a status change. */
  onUpdated?: (item: InsightRecord) => void
}

export function InsightCard({ item, onUpdated }: Props) {
  const links = useInsightLinks()
  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState<'confirmed' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const role = ROLE[item.type] ?? ROLE.ai
  const status = STATUS[item.status] ?? STATUS.awaiting_answer
  const answerRole = item.answer_author_role ? ROLE[item.answer_author_role] : null
  const meta = item.source_meta ?? null
  const confidence = typeof meta?.confidence === 'number' ? meta.confidence : null

  async function decide(next: 'confirmed' | 'rejected') {
    setPending(next)
    setError(null)
    try {
      const res = await fetch(`/api/v1/point-a/insights/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: InsightRecord }
        | null
      if (!res.ok || !json?.ok || !json.data) {
        const raw = json?.error ?? `HTTP ${res.status}`
        throw new Error(PATCH_ERROR_TEXT[raw] ?? raw)
      }
      onUpdated?.({ ...item, ...json.data })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить решение')
    } finally {
      setPending(null)
    }
  }

  const createdAt = formatDateTime(item.created_at)
  const answeredAt = formatDateTime(item.answered_at)

  const btnPrimary =
    'inline-flex items-center gap-1.5 rounded-xl bg-primary/90 hover:bg-primary disabled:opacity-50 disabled:hover:bg-primary/90 text-[#04140a] text-xs font-medium px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
  const btnGhost =
    'inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] hover:border-white/20 disabled:opacity-50 bg-transparent text-on-surface-variant hover:text-on-surface text-xs font-medium px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'

  return (
    <article className="rounded-2xl border border-white/[0.04] bg-surface-container-low transition-colors hover:border-primary/20">
      {/* Header — the whole block toggles the justification panel */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`${expanded ? 'Свернуть' : 'Раскрыть'} обоснование: ${item.question_text}`}
        className="w-full rounded-2xl px-5 py-5 text-left transition-colors hover:bg-white/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium ${role.border} ${role.bg} ${role.text}`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                {role.icon}
              </span>
              {role.label}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/70">
              {item.category}
            </span>
          </div>
          {createdAt && (
            <span className="font-mono text-[10px] text-on-surface-variant/80">{createdAt}</span>
          )}
        </div>

        <p className="text-sm font-medium leading-snug text-on-surface">{item.question_text}</p>
        {item.author_name && (
          <p className="mt-1 text-[11px] text-on-surface-variant/70">— {item.author_name}</p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={`flex items-center gap-2 text-xs ${status.tone}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant">
            {expanded ? 'Свернуть' : 'Обоснование'}
            <span
              aria-hidden="true"
              className={`material-symbols-outlined text-[16px] transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              expand_more
            </span>
          </span>
        </div>
      </button>

      {/* Justification — only what the row actually carries */}
      {expanded && (
        <div id={panelId} className="border-t border-white/[0.04] px-5 py-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            Обоснование
          </p>

          {item.answer_text ? (
            <div className="border-l-2 border-white/[0.06] pl-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {answerRole && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${answerRole.bg} ${answerRole.text}`}
                  >
                    {answerRole.label}
                  </span>
                )}
                {item.answer_author_name && (
                  <span className="text-[11px] text-on-surface">{item.answer_author_name}</span>
                )}
                {answeredAt && (
                  <span className="font-mono text-[10px] text-on-surface-variant/70">
                    · {answeredAt}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-on-surface-variant">
                {item.answer_text}
              </p>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-on-surface-variant">
              Ответа ещё нет — обоснование появится, когда на вопрос ответят.
            </p>
          )}

          {/* Provenance */}
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                Модель
              </dt>
              <dd className="text-right font-mono text-[11px] text-on-surface">
                {meta?.model ?? (item.type === 'ai' ? 'не записана' : 'не применимо')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                Уверенность
              </dt>
              <dd className="text-right font-mono text-[11px] text-on-surface">
                {confidence === null ? 'не указана' : `${Math.round(confidence * 100)} %`}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                Версия промпта
              </dt>
              <dd className="text-right font-mono text-[11px] text-on-surface">
                {meta?.prompt_version ?? (item.type === 'ai' ? 'не записана' : 'не применимо')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                Задан
              </dt>
              <dd className="text-right font-mono text-[11px] text-on-surface">
                {createdAt ?? 'дата не записана'}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-on-surface-variant/80">
            {item.type === 'ai'
              ? 'Ответ — предположение модели по вашей анкете Точки А. Подтвердите его или отклоните, чтобы прогноз опирался на проверенные данные.'
              : 'Вопрос задан человеком, поэтому провенанс модели к нему не применяется.'}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.04] px-5 py-3">
        {item.status === 'pending_confirmation' && (
          <>
            <button
              type="button"
              onClick={() => decide('confirmed')}
              disabled={pending !== null}
              aria-label={`Подтвердить инсайт: ${item.question_text}`}
              className={btnPrimary}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                check
              </span>
              {pending === 'confirmed' ? 'Сохраняем…' : 'Подтвердить'}
            </button>
            <button
              type="button"
              onClick={() => decide('rejected')}
              disabled={pending !== null}
              aria-label={`Отклонить инсайт: ${item.question_text}`}
              className={btnGhost}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                close
              </span>
              {pending === 'rejected' ? 'Сохраняем…' : 'Отклонить'}
            </button>
          </>
        )}

        {links.feed && (
          <Link
            href={links.feed}
            aria-label="Открыть ленту обсуждений, чтобы ответить на вопрос"
            className={btnGhost}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
              forum
            </span>
            Ответить в ленте
          </Link>
        )}

        <Link
          href={links.pointA}
          aria-label="Открыть Точку А — данные, на которых построен вывод"
          className={btnGhost}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
            my_location
          </span>
          Проверить данные
        </Link>
      </div>

      {error && (
        <p role="alert" className="px-5 pb-4 text-xs text-error">
          {error}
        </p>
      )}
    </article>
  )
}

export default InsightCard
