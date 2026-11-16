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
 * Pure: no IO, browser-safe.
 */
import { clientDueLabel } from '@/lib/expert-sla/policy'

/** One row of GET /api/v1/expert-sla `data` (only the fields used here). */
export interface ClientSlaTaskView {
  source: string
  answerDueAt: string
  overdue: boolean
  inProgress: boolean
}

export interface MessagesReplyNote {
  /** «Ответит команда AIStart360» — always. */
  who: string
  /** The line under it: the deadline, or the common text. */
  text: string
  /** The promised deadline (ISO), null — no date is promised. */
  dueAt: string | null
}

export const TEAM_REPLY_WHO = 'Ответит команда AIStart360'
export const TEAM_REPLY_COMMON = 'Ответ придёт сюда же, в этот диалог, а уведомление — туда, где вам удобно.'

/** The SLA sources answered in «Сообщения». */
const MESSAGE_SOURCES = new Set(['case'])

export function messagesReplyNote(tasks: readonly ClientSlaTaskView[] | null | undefined, now: Date = new Date()): MessagesReplyNote {
  const open = (tasks ?? [])
    .filter((t) => MESSAGE_SOURCES.has(t.source) && !t.overdue)
    .map((t) => ({ t, due: new Date(t.answerDueAt).getTime() }))
    .filter(({ due }) => Number.isFinite(due) && due > now.getTime())
    .sort((a, b) => a.due - b.due)[0]
  if (!open) return { who: TEAM_REPLY_WHO, text: TEAM_REPLY_COMMON, dueAt: null }
  const dueAt = new Date(open.due).toISOString()
  const state = open.t.inProgress ? 'Ваше обращение уже в работе.' : 'Ваше обращение получено.'
  return { who: TEAM_REPLY_WHO, text: `${state} Ответим до ${clientDueLabel(dueAt)}.`, dueAt }
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
    .map((r) => ({ source: r.source, answerDueAt: r.answerDueAt, overdue: r.overdue, inProgress: r.inProgress === true }))
}
