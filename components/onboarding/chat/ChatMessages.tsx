'use client'

/**
 * The messages of the questionnaire chat (spec §8.1, §14.4): `role="log"`,
 * new messages announced politely; cards, «Передать эксперту», links to the
 * form and the follow-up buttons. Shared by the chat mode, the field helper
 * and (read-only) the staff transcript.
 */
import Link from 'next/link'
import { ProposalCard } from './ProposalCard'
import type { ChatButton, ChatMessageDTO } from '@/lib/survey/chat/types'

export interface ChatMessagesHandlers {
  onApply?: (m: ChatMessageDTO, editedValue?: unknown) => void
  onReject?: (m: ChatMessageDTO) => void
  onButton?: (b: ChatButton) => void
  onEscalate?: (m: ChatMessageDTO) => void
}

export function ChatMessages({ messages, handlers = {}, readOnly = false, keyLabel, typing = false }: {
  messages: readonly ChatMessageDTO[]
  handlers?: ChatMessagesHandlers
  readOnly?: boolean
  /** Staff transcript: the question each message is about. */
  keyLabel?: (key: string) => string | null
  typing?: boolean
}) {
  const lastCard = [...messages].reverse().find((m) => m.proposal)?.id
  return (
    <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Беседа с помощником анкеты" className="flex flex-col gap-3">
      {messages.map((m) => {
        const mine = m.role === 'user'
        return (
          <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${mine ? 'bg-primary/15 text-on-surface' : 'border border-white/[0.06] bg-white/[0.03] text-on-surface'}`}>
              {keyLabel && m.key && (
                <p className="mb-1 text-[10px] font-mono uppercase tracking-wider text-on-surface-variant/70">
                  {m.focus ? 'Помощник у поля · ' : ''}{keyLabel(m.key)}
                </p>
              )}
              {!mine && <span className="sr-only">Помощник: </span>}
              <p className="whitespace-pre-line">{m.content}</p>
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  readOnly={readOnly}
                  autoFocus={m.id === lastCard}
                  onApply={(v) => handlers.onApply?.(m, v)}
                  onReject={() => handlers.onReject?.(m)}
                />
              )}
              {m.kind === 'escalate' && m.escalate && !readOnly && (
                <div className="mt-2 rounded-xl border border-white/[0.08] p-3 text-xs">
                  <p className="text-on-surface-variant">Вопрос{m.escalate.label ? `: ${m.escalate.label}` : ''}</p>
                  {m.escalate.text && <p className="mt-1 text-on-surface">«{m.escalate.text}»</p>}
                  <button type="button" onClick={() => handlers.onEscalate?.(m)}
                    className="mt-2 min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-[#003824]">
                    Передать
                  </button>
                </div>
              )}
              {m.link && (
                <Link href={m.link.href} className="mt-2 inline-flex min-h-[36px] items-center gap-1 text-xs text-primary hover:underline">
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>{m.link.label}
                </Link>
              )}
              {!readOnly && m.buttons?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.buttons.map((b) => b.action === 'mode'
                    ? <Link key={b.label} href={b.href} className="inline-flex min-h-[40px] items-center rounded-lg border border-white/[0.12] px-3 text-xs text-on-surface hover:bg-white/[0.04]">{b.label}</Link>
                    : <button key={b.label} type="button" onClick={() => handlers.onButton?.(b)} className="min-h-[40px] rounded-lg border border-white/[0.12] px-3 text-xs text-on-surface hover:bg-white/[0.04]">{b.label}</button>)}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
      {typing && <p className="text-xs text-on-surface-variant" aria-live="polite">Помощник печатает…</p>}
    </div>
  )
}

/** Quick buttons above the input (spec §8.1); none of them calls the model. */
export const QUICK_ACTIONS = [
  { action: 'unknown', label: 'Не знаю' },
  { action: 'approx', label: 'Примерно…' },
  { action: 'explain', label: 'Объясни вопрос' },
  { action: 'where', label: 'Где взять цифру?' },
  { action: 'skip', label: 'Пропустить' },
] as const

export function QuickActions({ onAction, onEscalate, disabled = false, hide = [] }: {
  onAction: (a: (typeof QUICK_ACTIONS)[number]['action']) => void
  onEscalate?: () => void
  disabled?: boolean
  hide?: ReadonlyArray<string>
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="toolbar" aria-label="Быстрые ответы">
      {QUICK_ACTIONS.filter((a) => !hide.includes(a.action)).map((a) => (
        <button key={a.action} type="button" disabled={disabled} onClick={() => onAction(a.action)}
          className="min-h-[36px] shrink-0 rounded-full border border-white/[0.1] px-3 text-xs text-on-surface-variant hover:border-primary/30 hover:text-primary disabled:opacity-50">
          {a.label}
        </button>
      ))}
      {onEscalate && (
        <button type="button" disabled={disabled} onClick={onEscalate}
          className="min-h-[36px] shrink-0 rounded-full border border-white/[0.1] px-3 text-xs text-on-surface-variant hover:border-primary/30 hover:text-primary disabled:opacity-50">
          Позвать эксперта
        </button>
      )}
    </div>
  )
}

/** The input: Enter sends, Shift+Enter is a new line; the unsent text stays when offline. */
export function ChatInput({ value, onChange, onSend, disabled, placeholder = 'Ответьте своими словами…' }: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!disabled && value.trim()) onSend() }}>
      <label className="sr-only" htmlFor="survey-chat-input">Сообщение помощнику</label>
      <textarea
        id="survey-chat-input"
        rows={1}
        value={value}
        maxLength={2000}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!disabled && value.trim()) onSend()
          }
        }}
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-base text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary/50 focus:outline-none"
      />
      <button type="submit" disabled={disabled || !value.trim()} aria-label="Отправить"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-[#003824] disabled:opacity-40">
        <span className="material-symbols-outlined text-lg" aria-hidden="true">send</span>
      </button>
    </form>
  )
}
