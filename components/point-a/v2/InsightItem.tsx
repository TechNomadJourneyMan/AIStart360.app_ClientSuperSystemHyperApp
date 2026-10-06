'use client'

/**
 * InsightItem — single Q&A card used by InsightsFeed (compact list)
 * and by the full /point-a/insights timeline page.
 *
 * Self-contained: no external imports from data-agent's files.
 */

import { useMemo, useState } from 'react'

export type InsightAuthorRole = 'ai' | 'expert' | 'client' | 'admin'

export type InsightStatus =
  | 'pending_ai'
  | 'pending_confirmation'
  | 'awaiting_answer'
  | 'confirmed'
  | 'rejected'

export interface InsightFeedItem {
  id: string
  type: InsightAuthorRole
  category: string
  question_text: string
  author_name?: string
  answer_text?: string
  answer_author_name?: string
  answer_author_role?: InsightAuthorRole
  answered_at?: string
  status: InsightStatus
  created_at: string
}

interface Props {
  item: InsightFeedItem
  /**
   * Optional callbacks — feed parent decides what each action does. A button
   * whose callback is not provided is NOT rendered (no dead buttons).
   */
  onConfirm?: (id: string) => void
  onEdit?: (id: string) => void
  onRefine?: (id: string) => void
  onAnswer?: (id: string) => void
  onAnswerViaSurvey?: (id: string) => void
  onRunAI?: (id: string) => void
  /** Save an inline answer (enables «Ответить» + the answer field). */
  onSubmitAnswer?: (id: string, text: string) => Promise<unknown> | void
  /** true while an action for this item is being saved. */
  busy?: boolean
  /** Optional viewer role to pick action set. Defaults to 'client'. */
  viewerRole?: InsightAuthorRole
  /** Render comments thread (used on the full page). */
  comments?: InsightComment[]
  showCommentInput?: boolean
}

export interface InsightComment {
  id: string
  author_role: InsightAuthorRole
  author_name: string
  text: string
  created_at: string
}

// ─── Role palette ────────────────────────────────────────────────────────────

const ROLE_STYLE: Record<InsightAuthorRole, { text: string; bg: string; border: string; label: string; icon: string }> = {
  ai: {
    text: 'text-purple-300',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    label: 'ИИ',
    icon: 'auto_awesome',
  },
  expert: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/30',
    label: 'Эксперт',
    icon: 'verified',
  },
  client: {
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    label: 'Клиент',
    icon: 'person',
  },
  admin: {
    text: 'text-on-surface',
    bg: 'bg-white/10',
    border: 'border-white/20',
    label: 'Админ',
    icon: 'shield_person',
  },
}

const STATUS_STYLE: Record<InsightStatus, { label: string; tone: string; dot: string }> = {
  pending_ai: {
    label: '• Ждёт анализа ИИ и эксперта',
    tone: 'text-purple-300/80',
    dot: 'bg-purple-400',
  },
  pending_confirmation: {
    label: '• Ожидает подтверждения',
    tone: 'text-amber-300/90',
    dot: 'bg-amber-400',
  },
  awaiting_answer: {
    label: '• Ждёт ответа клиента или эксперта',
    tone: 'text-on-surface-variant',
    dot: 'bg-on-surface-variant/50',
  },
  confirmed: {
    label: '• Подтверждено клиентом · учтено в прогнозе',
    tone: 'text-primary/90',
    dot: 'bg-primary',
  },
  rejected: {
    label: '• Отклонено',
    tone: 'text-error/90',
    dot: 'bg-error',
  },
}

function formatTimeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return ''
    const diffMs = Date.now() - then
    const min = Math.round(diffMs / 60000)
    if (min < 1) return 'только что'
    if (min < 60) return `${min} мин назад`
    const hr = Math.round(min / 60)
    if (hr < 24) return `${hr} ч назад`
    const day = Math.round(hr / 24)
    if (day < 7) return `${day} дн назад`
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InsightItem({
  item,
  onConfirm,
  onEdit,
  onRefine,
  onAnswer,
  onAnswerViaSurvey,
  onRunAI,
  onSubmitAnswer,
  busy = false,
  comments,
  showCommentInput,
}: Props) {
  const role = ROLE_STYLE[item.type] ?? ROLE_STYLE.ai
  const status = STATUS_STYLE[item.status] ?? STATUS_STYLE.awaiting_answer
  const answerRole = item.answer_author_role ? ROLE_STYLE[item.answer_author_role] : null
  const [answerOpen, setAnswerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const canAnswerInline = Boolean(onSubmitAnswer) && !item.answer_text && item.status === 'awaiting_answer'
  const showAnswerField = canAnswerInline && (answerOpen || Boolean(showCommentInput))

  const submitAnswer = async () => {
    const text = draft.trim()
    if (!onSubmitAnswer || text.length < 4) return
    await onSubmitAnswer(item.id, text)
    setDraft('')
    setAnswerOpen(false)
  }

  const actionButtons = useMemo(() => {
    const btnPrimary =
      'inline-flex items-center gap-1.5 rounded-xl bg-primary/90 hover:bg-primary text-[#04140a] text-xs font-medium px-3 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40'
    const btnGhost =
      'inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] hover:border-white/20 bg-transparent text-on-surface-variant hover:text-on-surface text-xs font-medium px-3 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30'

    const nodes: JSX.Element[] = []
    switch (item.status) {
      case 'pending_confirmation':
        if (onConfirm)
          nodes.push(
            <button key="confirm" type="button" disabled={busy} className={btnPrimary} onClick={() => onConfirm(item.id)}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
              Подтвердить
            </button>,
          )
        if (onEdit)
          nodes.push(
            <button key="edit" type="button" className={btnGhost} onClick={() => onEdit(item.id)}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span>
              Редактировать
            </button>,
          )
        break
      case 'confirmed':
        if (onRefine)
          nodes.push(
            <button key="refine" type="button" className={btnGhost} onClick={() => onRefine(item.id)}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">tune</span>
              Уточнить
            </button>,
          )
        break
      case 'awaiting_answer':
        if (canAnswerInline && !showCommentInput)
          nodes.push(
            <button
              key="answer"
              type="button"
              className={btnPrimary}
              aria-expanded={answerOpen}
              onClick={() => setAnswerOpen((v) => !v)}
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">reply</span>
              Ответить
            </button>,
          )
        else if (onAnswer)
          nodes.push(
            <button key="answer" type="button" className={btnPrimary} onClick={() => onAnswer(item.id)}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">reply</span>
              Ответить
            </button>,
          )
        if (onAnswerViaSurvey)
          nodes.push(
            <button key="survey" type="button" className={btnGhost} onClick={() => onAnswerViaSurvey(item.id)}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">assignment</span>
              Через анкету
            </button>,
          )
        break
      case 'pending_ai':
        if (onRunAI)
          nodes.push(
            <button key="ai" type="button" disabled={busy} className={btnPrimary} onClick={() => onRunAI(item.id)}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">auto_awesome</span>
              Запустить анализ ИИ
            </button>,
          )
        break
      default:
        break
    }
    return nodes.length ? <>{nodes}</> : null
  }, [item.status, item.id, onConfirm, onEdit, onRefine, onAnswer, onAnswerViaSurvey, onRunAI, busy, canAnswerInline, showCommentInput, answerOpen])

  return (
    <article
      className="group rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 mb-3 transition-colors hover:border-primary/20"
    >
      {/* Header: author badge + category + timestamp */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border ${role.border} ${role.bg} ${role.text} text-[11px] font-medium px-2.5 py-1`}
          >
            <span className="material-symbols-outlined text-[13px]">{role.icon}</span>
            {role.label} · задал вопрос
          </span>
          <span className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em]">
            {item.category}
          </span>
        </div>
        <span className="text-[10px] font-mono text-on-surface-variant/80">
          {formatTimeAgo(item.created_at)}
        </span>
      </div>

      {/* Question */}
      <p className="text-sm font-medium text-on-surface leading-snug">
        {item.question_text}
      </p>
      {item.author_name && (
        <p className="text-[11px] text-on-surface-variant/70 mt-1">
          — {item.author_name}
        </p>
      )}

      {/* Inline answer */}
      {item.answer_text && (
        <div className="border-l-2 border-white/[0.06] pl-3 mt-3">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {answerRole && (
              <span
                className={`inline-flex items-center gap-1 rounded-md ${answerRole.bg} ${answerRole.text} text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5`}
              >
                {answerRole.label}
              </span>
            )}
            {item.answer_author_name && (
              <span className="text-[11px] text-on-surface">{item.answer_author_name}</span>
            )}
            {item.answered_at && (
              <span className="text-[10px] font-mono text-on-surface-variant/70">
                · {formatTimeAgo(item.answered_at)}
              </span>
            )}
          </div>
          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            {item.answer_text}
          </p>
        </div>
      )}

      {/* Footer: status + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap mt-4 pt-3 border-t border-white/[0.04]">
        <div className={`flex items-center gap-2 text-xs ${status.tone}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          <span>{status.label.replace('• ', '')}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actionButtons}
        </div>
      </div>

      {/* Comments thread (full-page mode) */}
      {comments && comments.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/[0.04] space-y-2">
          {comments.map((c) => {
            const cRole = ROLE_STYLE[c.author_role] ?? ROLE_STYLE.client
            return (
              <div key={c.id} className="flex items-start gap-2.5">
                <span
                  className={`material-symbols-outlined text-[16px] mt-0.5 ${cRole.text} flex-shrink-0`}
                >
                  {cRole.icon}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[11px] font-medium ${cRole.text}`}>{c.author_name}</span>
                    <span className="text-[10px] font-mono text-on-surface-variant/60">
                      · {formatTimeAgo(c.created_at)}
                    </span>
                  </div>
                  <p className="text-[12px] text-on-surface-variant leading-relaxed">{c.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Inline answer — only when the parent can save it (no dead input). */}
      {showAnswerField && (
        <form
          className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submitAnswer()
          }}
        >
          <label htmlFor={`answer-${item.id}`} className="sr-only">
            Ваш ответ
          </label>
          <input
            id={`answer-${item.id}`}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ваш ответ…"
            maxLength={4000}
            className="flex-1 rounded-xl bg-surface-container border border-white/[0.06] focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 text-xs text-on-surface px-3 py-2 placeholder:text-on-surface-variant/60"
          />
          <button
            type="submit"
            aria-label="Отправить ответ"
            disabled={busy || draft.trim().length < 4}
            className="rounded-xl bg-primary/90 hover:bg-primary disabled:opacity-50 text-on-primary px-3 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              {busy ? 'progress_activity' : 'send'}
            </span>
          </button>
        </form>
      )}
    </article>
  )
}

export default InsightItem
