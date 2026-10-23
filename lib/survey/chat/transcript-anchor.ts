/**
 * lib/survey/chat/transcript-anchor.ts — from an answer «через ИИ-помощника»
 * to the place in the chat it came from (spec §5.4 «[открыть беседу]», §10,
 * §16 Ф5). Pure and browser-safe.
 *
 * Which message: the newest applied «Записать» card of the key (path chat);
 * else the newest field-helper card of the key (path helper — the value went
 * into the form, there is no pending action); else the newest message about
 * the key. The transcript holds the five latest conversations, so an old
 * answer may have no message — the caller says so honestly.
 */
import type { ChatMessageDTO } from './types'

export interface AnchorConversation {
  id: string
  messages: readonly ChatMessageDTO[]
}

export interface AnswerMessageRef {
  conversationId: string
  messageId: string
  kind: 'applied' | 'helper' | 'mention'
}

/** DOM id of a transcript message. */
export const transcriptMessageId = (messageId: string): string => `survey-chat-msg-${messageId}`

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? 0 : t
}

export function findAnswerMessage(conversations: readonly AnchorConversation[], key: string | null | undefined): AnswerMessageRef | null {
  if (!key) return null
  let best: { ref: AnswerMessageRef; rank: number; at: number } | null = null
  for (const c of conversations) {
    for (const m of c.messages) {
      let rank = 0
      let kind: AnswerMessageRef['kind'] = 'mention'
      if (m.proposal?.key === key && m.proposal.status === 'applied') { rank = 3; kind = 'applied' }
      else if (m.proposal?.key === key && m.focus && m.proposal.id === null) { rank = 2; kind = 'helper' }
      else if (m.key === key || m.proposal?.key === key) rank = 1
      if (!rank) continue
      const at = time(m.createdAt)
      if (!best || rank > best.rank || (rank === best.rank && at >= best.at)) {
        best = { ref: { conversationId: c.id, messageId: m.id, kind }, rank, at }
      }
    }
  }
  return best?.ref ?? null
}

/** The note above the transcript when it is opened from an answer. */
export function anchorNote(ref: AnswerMessageRef | null, label: string): string {
  if (!ref) return `Сообщение с ответом «${label}» не найдено: здесь пять последних бесед, ответ мог быть записан раньше.`
  if (ref.kind === 'applied') return `Отмечено сообщение, из которого записан ответ «${label}».`
  if (ref.kind === 'helper') return `Отмечен «Помощник» у поля «${label}»: значение клиент перенёс в форму.`
  return `Отмечено последнее сообщение о вопросе «${label}».`
}
