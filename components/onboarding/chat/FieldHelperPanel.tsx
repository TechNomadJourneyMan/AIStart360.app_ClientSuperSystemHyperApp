'use client'

/**
 * «Помощник» at a field (spec §8.10): a side panel (desktop) / an 85 % sheet
 * (phone) on the same conversation, bound to one question. «Объясни вопрос»
 * and «Где взять цифру?» come from the registry (no AI); «Помоги ответить» is
 * the chat with the AI under the same rules. The confirmed value goes INTO THE
 * FORM FIELD (`onApply`) — the form saves it on the path «helper»; the
 * database is not written from here.
 */
import { useEffect, useRef, useState } from 'react'
import { surveyQuestion, isNumericQuestion } from '@/lib/survey/questions'
import { track } from '@/lib/events/client'
import type { ChatMessageDTO } from '@/lib/survey/chat/types'
import { ChatInput, ChatMessages, QuickActions } from './ChatMessages'
import { useFieldHelper, type ChatTransport } from './useSurveyChat'

/** A value typed in «Исправить» → the form value of the field (numbers as numbers). */
export function helperFormValue(key: string, edited: unknown): unknown {
  const q = surveyQuestion(key)
  if (!q || !isNumericQuestion(q) || typeof edited !== 'string') return edited
  const n = Number(edited.replace(/[\s  ]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : edited
}

export function FieldHelperPanel({ fieldKey, onApply, onClose, transport }: {
  fieldKey: string
  onApply: (key: string, value: unknown) => void
  onClose: () => void
  transport?: ChatTransport
}) {
  const helper = useFieldHelper(fieldKey, onApply, transport)
  const q = surveyQuestion(fieldKey)
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    track('SURVEY_HELPER_OPENED', { metadata: { key: fieldKey, action: 'open' } })
    closeRef.current?.focus()
  }, [fieldKey])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = async () => {
    const text = draft.trim()
    if (text && (await helper.send(text))) setDraft('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 sm:items-stretch" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Помощник: ${q?.label ?? 'вопрос анкеты'}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[85dvh] w-full flex-col rounded-t-2xl border-t border-white/[0.08] bg-[#11141c] sm:h-full sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0"
      >
        <header className="flex items-start gap-3 border-b border-white/[0.06] p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-primary/70">Помощник</p>
            <p className="mt-0.5 text-sm font-semibold text-on-surface">{q?.label ?? fieldKey}</p>
            <p className="mt-1 text-[11px] text-on-surface-variant">Ответ появится в поле формы только после «Записать».</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть помощника"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <ChatMessages
            messages={helper.messages}
            typing={helper.sending}
            handlers={{
              onApply: (m: ChatMessageDTO, v?: unknown) => helper.accept(m, v === undefined ? undefined : helperFormValue(m.proposal?.key ?? fieldKey, v)),
              onReject: (m: ChatMessageDTO) => helper.markLocal(m, 'rejected'),
              onButton: (b) => { if (b.action === 'approx' || b.action === 'unknown' || b.action === 'skip') void helper.quick(b.action) },
              onEscalate: (m: ChatMessageDTO) => { void helper.escalate(fieldKey, m.escalate?.text ?? '') },
            }}
          />
          {helper.error && <p role="alert" className="mt-3 text-xs text-error">{helper.error}</p>}
        </div>
        <div className="space-y-2 border-t border-white/[0.06] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={helper.sending} onClick={() => { track('SURVEY_HELPER_OPENED', { metadata: { key: fieldKey, action: 'explain' } }); void helper.quick('explain') }}
              className="min-h-[36px] rounded-full border border-white/[0.1] px-3 text-xs text-on-surface-variant hover:text-primary">Объясни вопрос</button>
            <button type="button" disabled={helper.sending} onClick={() => { track('SURVEY_HELPER_OPENED', { metadata: { key: fieldKey, action: 'where' } }); void helper.quick('where') }}
              className="min-h-[36px] rounded-full border border-white/[0.1] px-3 text-xs text-on-surface-variant hover:text-primary">Где взять цифру?</button>
            {!asking && (
              <button type="button" onClick={() => { setAsking(true); track('SURVEY_HELPER_OPENED', { metadata: { key: fieldKey, action: 'answer' } }) }}
                className="min-h-[36px] rounded-full bg-primary/15 px-3 text-xs text-primary">Помоги ответить</button>
            )}
          </div>
          {asking && (
            <>
              <QuickActions disabled={helper.sending} hide={['explain', 'where']} onAction={(a) => void helper.quick(a)}
                onEscalate={() => { void helper.escalate(fieldKey, draft.trim()) }} />
              <ChatInput value={draft} onChange={setDraft} onSend={() => void send()} disabled={helper.sending} />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
