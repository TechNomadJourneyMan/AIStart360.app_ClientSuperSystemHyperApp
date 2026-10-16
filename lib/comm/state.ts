/**
 * lib/comm/state.ts — how a conversation changes when a message is written
 * (pure, no IO; lib/comm/store.ts applies the patches).
 *
 *   staff writes   → waiting_user; the reply deadline and escalation are reset,
 *                    the staff unread counter is cleared (he has seen it).
 *   bot writes     → waiting_user (phase 5); the deadline stays: a bot answer
 *                    is not a human answer.
 *   system writes  → status, preview and order unchanged (automatic notices
 *                    such as the profanity warning do not hide the user's
 *                    message in the staff list).
 *   user writes    → waiting_staff, unread_staff + 1. The deadline
 *                    (staff_reply_due_at = now + comm_escalation_minutes, or
 *                    counted in work hours — lib/comm/deadline.ts) is
 *                    set by the FIRST unanswered message and not pushed back
 *                    by the following ones; `startsWaiting` tells the caller
 *                    to notify staff (once per unanswered stretch, not per message).
 *                    With profanity profanity_count + 1 (the preview is the
 *                    masked text). A blocked user's message is stored and
 *                    shown, but the thread does not start waiting and staff
 *                    are not notified.
 */
import type { CommAuthorKind, CommThreadRow } from './types'

export const PREVIEW_LENGTH = 140

export function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

type ThreadState = Pick<CommThreadRow, 'status' | 'staff_reply_due_at' | 'escalated_at' | 'unread_staff' | 'unread_user'>
  & Partial<Pick<CommThreadRow, 'profanity_count' | 'blocked_at'>>
export type ThreadPatch = Partial<Pick<CommThreadRow,
  'status' | 'last_inbound_at' | 'last_outbound_at' | 'last_message_at' | 'last_message_preview'
  | 'staff_reply_due_at' | 'escalated_at' | 'unread_staff' | 'unread_user' | 'profanity_count'>>

export function threadPatchOnOutbound(thread: ThreadState, input: { authorKind: Exclude<CommAuthorKind, 'user'>; body: string; at: Date }): ThreadPatch {
  const at = input.at.toISOString()
  if (input.authorKind === 'system') return { last_outbound_at: at, unread_user: (thread.unread_user ?? 0) + 1 }
  const patch: ThreadPatch = {
    last_outbound_at: at,
    last_message_at: at,
    last_message_preview: previewOf(input.body),
    unread_user: (thread.unread_user ?? 0) + 1,
  }
  if (input.authorKind === 'staff') {
    patch.status = 'waiting_user'
    patch.staff_reply_due_at = null
    patch.escalated_at = null
    patch.unread_staff = 0
  } else if (input.authorKind === 'bot') {
    patch.status = 'waiting_user'
  }
  return patch
}

export function threadPatchOnInbound(
  thread: ThreadState,
  input: {
    body: string; at: Date; now: Date; escalationMinutes: number; profanity?: boolean
    /** The deadline when it is not now + escalationMinutes (work hours, lib/comm/deadline.ts). */
    dueAt?: Date | null
  },
): { patch: ThreadPatch; startsWaiting: boolean } {
  const profanity = input.profanity ? { profanity_count: (thread.profanity_count ?? 0) + 1 } : {}
  if (thread.blocked_at) {
    return {
      startsWaiting: false,
      patch: {
        last_inbound_at: input.at.toISOString(),
        last_message_at: input.at.toISOString(),
        last_message_preview: previewOf(input.body),
        ...profanity,
      },
    }
  }
  const wasWaiting = thread.status === 'waiting_staff' && !!thread.staff_reply_due_at
  const due = wasWaiting
    ? thread.staff_reply_due_at
    : (input.dueAt ?? new Date(input.now.getTime() + Math.max(1, input.escalationMinutes) * 60_000)).toISOString()
  return {
    startsWaiting: !wasWaiting,
    patch: {
      status: 'waiting_staff',
      last_inbound_at: input.at.toISOString(),
      last_message_at: input.at.toISOString(),
      last_message_preview: previewOf(input.body),
      unread_staff: (thread.unread_staff ?? 0) + 1,
      staff_reply_due_at: due,
      escalated_at: wasWaiting ? thread.escalated_at : null,
      ...profanity,
    },
  }
}

/** Waiting for staff past the deadline. */
export function isOverdue(thread: Pick<CommThreadRow, 'status' | 'staff_reply_due_at'>, now: Date): boolean {
  return thread.status === 'waiting_staff' && !!thread.staff_reply_due_at && new Date(thread.staff_reply_due_at).getTime() < now.getTime()
}

/** The Telegram receipt «Сообщение получено…» goes at most once per `hours` per chat. */
export const RECEIPT_EVERY_HOURS = 6

export function shouldSendReceipt(lastAt: string | null, now: Date, hours = RECEIPT_EVERY_HOURS): boolean {
  if (!lastAt) return true
  const t = new Date(lastAt).getTime()
  return !Number.isFinite(t) || now.getTime() - t >= hours * 3_600_000
}

/** «стоп» / «stop» / «отписаться» as the whole message = opt-out of WhatsApp. */
export function isStopWord(text: string | null | undefined): boolean {
  if (!text) return false
  return /^(?:стоп|stop|отписаться|отписка|unsubscribe)[.!]*$/i.test(text.trim())
}
