/**
 * lib/comm/reply-note.ts — «кто и когда ответит» in the cabinet «Сообщения»
 * (R4, R-024; PO Round 4: «ответит команда AIStart360», not «эксперт» — there
 * are no approved experts on production, staff answers).
 *
 * The deadline comes from the client's own SLA tasks (GET /api/v1/expert-sla,
 * RLS: only his rows): an open «Обращение клиента» (source 'case' — a request
 * from the conversation, «Позвать эксперта», an assistant escalation) whose
 * answer deadline has not passed → «Ответим до <срок>». The SLA switched off,
 * no such task, an overdue task (no new promise — the rule of R2-B), a failed
 * read → the common text without any date. Other tasks (Point A review, the
 * Point B plan) have their own screens and are not promised here.
 *
 * W3B-6: staff answering in the conversation does not touch the request
 * (expert_cases), so its SLA task stays open. When the team has already
 * written to the client after his last question (and after the request
 * arrived), no deadline is shown: «Команда уже ответила — ответ ниже».
 * «Answered» = an outgoing message of a person (author_kind 'staff'); the bot
 * and broadcasts ('system') are not an answer (the rule of lib/comm/bot.ts).
 * Pure: no IO, browser-safe.
 */
import { clientDueLabel } from '@/lib/expert-sla/policy'

/** One row of GET /api/v1/expert-sla `data` (only the fields used here). */
export interface ClientSlaTaskView {
  source: string
  answerDueAt: string
  overdue: boolean
  inProgress: boolean
  /** When the request arrived (ISO); absent in an older response. */
  receivedAt?: string | null
}

/** One message of the conversation (lib/comm/client.ts ClientMessage, the fields used here). */
export interface ReplyNoteMessage {
  direction: 'in' | 'out'
  authorKind: string
  createdAt: string
}

export type ReplyNoteState = 'due' | 'answered' | 'common'

export interface MessagesReplyNote {
  /** «Ответит команда AIStart360» — always. */
  who: string
  /** The line under it: the deadline, «уже ответила», or the common text. */
  text: string
  /** The promised deadline (ISO), null — no date is promised. */
  dueAt: string | null
  state: ReplyNoteState
}

export const TEAM_REPLY_WHO = 'Ответит команда AIStart360'
export const TEAM_REPLY_COMMON = 'Ответ придёт сюда же, в этот диалог, а уведомление — туда, где вам удобно.'
export const TEAM_REPLY_ANSWERED = 'Команда уже ответила на ваш последний вопрос — ответ ниже в диалоге.'

/** The SLA sources answered in «Сообщения». */
const MESSAGE_SOURCES = new Set(['case'])

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/** A person of the team wrote to the client after `since` (ms). */
function staffWroteAfter(messages: readonly ReplyNoteMessage[], since: number): boolean {
  return messages.some((m) => m.direction === 'out' && m.authorKind === 'staff' && (time(m.createdAt) ?? -Infinity) > since)
}

export function messagesReplyNote(
  tasks: readonly ClientSlaTaskView[] | null | undefined,
  now: Date = new Date(),
  messages: readonly ReplyNoteMessage[] | null | undefined = null,
): MessagesReplyNote {
  const feed = messages ?? []
  const lastQuestion = feed.reduce<number | null>((acc, m) => {
    const t = m.direction === 'in' ? time(m.createdAt) : null
    return t !== null && (acc === null || t > acc) ? t : acc
  }, null)
  const answered: MessagesReplyNote = { who: TEAM_REPLY_WHO, text: TEAM_REPLY_ANSWERED, dueAt: null, state: 'answered' }
  const open = (tasks ?? [])
    .filter((t) => MESSAGE_SOURCES.has(t.source) && !t.overdue)
    .map((t) => ({ t, due: new Date(t.answerDueAt).getTime() }))
    .filter(({ due }) => Number.isFinite(due) && due > now.getTime())
    .sort((a, b) => a.due - b.due)[0]
  if (!open) {
    if (lastQuestion !== null && staffWroteAfter(feed, lastQuestion)) return answered
    return { who: TEAM_REPLY_WHO, text: TEAM_REPLY_COMMON, dueAt: null, state: 'common' }
  }
  // The answer must come after the client's last question AND after the request arrived.
  const anchors = [lastQuestion, time(open.t.receivedAt)].filter((x): x is number => x !== null)
  if (anchors.length && staffWroteAfter(feed, Math.max(...anchors))) return answered
  const dueAt = new Date(open.due).toISOString()
  const state = open.t.inProgress ? 'Ваше обращение уже в работе.' : 'Ваше обращение получено.'
  return { who: TEAM_REPLY_WHO, text: `${state} Ответим до ${clientDueLabel(dueAt)}.`, dueAt, state: 'due' }
}

/** GET /api/v1/expert-sla → the tasks (anything malformed → none, i.e. the common text). */
export function slaTasksFromResponse(body: unknown): ClientSlaTaskView[] {
  const data = body && typeof body === 'object' ? (body as { ok?: unknown; data?: unknown }).data : null
  if (!Array.isArray(data)) return []
  return data.filter((r): r is ClientSlaTaskView =>
    !!r && typeof r === 'object'
    && typeof (r as ClientSlaTaskView).source === 'string'
    && typeof (r as ClientSlaTaskView).answerDueAt === 'string'
    && typeof (r as ClientSlaTaskView).overdue === 'boolean')
    .map((r) => ({
      source: r.source, answerDueAt: r.answerDueAt, overdue: r.overdue, inProgress: r.inProgress === true,
      receivedAt: typeof r.receivedAt === 'string' ? r.receivedAt : null,
    }))
}
