/**
 * lib/popups/store.ts — pop-up data for the cabinet. Today the only source is
 * the user's own conversation (comm_messages), so no tables or migrations:
 *
 *   state of a pop-up      comm_messages.metadata.popup { seenAt, dismissedAt, snoozedUntil, actedAt }
 *   «важное» flag          comm_messages.flags.important (set by staff, honoured for staff authors only)
 *
 * A pop-up is built ONLY from an outgoing, in-app message written by a person
 * (author_kind = 'staff'). Bot answers, system notices and broadcasts
 * (author_kind = 'system') are never pop-ups and never important.
 *
 * Pure of server-only imports on purpose: the client layer reuses
 * `candidateFromMessage` for messages that arrive over Realtime.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { previewOf } from '@/lib/comm/state'
import { findThreadByUser } from '@/lib/comm/store'
import type { CommMessageRow } from '@/lib/comm/types'
import type { PopupAction, PopupCandidate, PopupSnoozeDays, PopupState } from './types'
import { POPUP_SNOOZE_DAYS } from './types'

export const MESSAGES_HREF = '/client/messages'
const DAY_MS = 86_400_000
/** Rows looked at per request: the newest staff messages inside the window. */
const MAX_ROWS = 20
const REACHED_STATUSES = ['queued', 'sending', 'sent', 'delivered']
const BODY_PREVIEW = 240

type MessageLike = Pick<CommMessageRow, 'id' | 'author_kind' | 'author_name' | 'subject' | 'body' | 'flags' | 'created_at'> & {
  direction?: CommMessageRow['direction']
  channel?: CommMessageRow['channel']
}

/** `flags.important === true` counts only for a staff author. */
export function isImportantMessage(row: Pick<MessageLike, 'author_kind' | 'flags'>): boolean {
  return row.author_kind === 'staff' && (row.flags as { important?: unknown } | null)?.important === true
}

/**
 * The pop-up for one message, or null when the message may never be one
 * (not staff, not outgoing, not an in-app row).
 */
export function candidateFromMessage(row: MessageLike, opts: { canReply?: boolean } = {}): PopupCandidate | null {
  if (row.author_kind !== 'staff') return null
  if (row.direction && row.direction !== 'out') return null
  if (row.channel && row.channel !== 'app') return null
  const important = isImportantMessage(row)
  return {
    id: row.id,
    kind: 'expert_message',
    display: important ? 'modal' : 'card',
    priority: important ? 0 : 10,
    title: row.subject?.trim() || 'Сообщение от эксперта',
    body: previewOf(row.body).slice(0, BODY_PREVIEW),
    authorName: row.author_name?.trim() || null,
    authorSpecialty: null,
    createdAt: row.created_at,
    href: MESSAGES_HREF,
    important,
    canReply: opts.canReply ?? true,
  }
}

function readState(id: string, metadata: unknown): PopupState {
  const p = ((metadata as { popup?: Record<string, unknown> } | null)?.popup ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const st: PopupState = { id }
  const seenAt = str(p.seenAt), dismissedAt = str(p.dismissedAt), snoozedUntil = str(p.snoozedUntil)
  if (seenAt) st.seenAt = seenAt
  if (dismissedAt) st.dismissedAt = dismissedAt
  if (snoozedUntil) st.snoozedUntil = snoozedUntil
  return st
}

export interface ExpertMessageCandidates {
  threadId: string | null
  candidates: PopupCandidate[]
  states: Record<string, PopupState>
  /** Important messages shown during the last 24 hours (the modal budget). */
  modalsShown24h: number
}

const NONE: ExpertMessageCandidates = { threadId: null, candidates: [], states: {}, modalsShown24h: 0 }

/**
 * Staff messages of the user's own conversation that may pop up: outgoing,
 * in-app, written by a person, delivered, inside the window — and only while
 * the user still has unread messages (opening «Сообщения» clears them).
 * Two short queries: the conversation, then the newest rows.
 */
export async function loadExpertMessageCandidates(sb: SupabaseClient, userId: string, now: Date, windowDays: number): Promise<ExpertMessageCandidates> {
  const thread = await findThreadByUser(sb, userId)
  if (!thread) return NONE
  if ((thread.unread_user ?? 0) <= 0) return { ...NONE, threadId: thread.id }

  const since = new Date(now.getTime() - Math.max(0, windowDays) * DAY_MS).toISOString()
  const { data, error } = await sb
    .from('comm_messages')
    .select('id, thread_id, direction, channel, author_kind, author_name, subject, body, flags, metadata, status, created_at')
    .eq('thread_id', thread.id)
    .eq('author_kind', 'staff')
    .eq('channel', 'app')
    .eq('direction', 'out')
    .in('status', REACHED_STATUSES)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  if (error) throw new Error(`popups: read messages: ${(error as { code?: string }).code ?? ''}`.trim())

  const canReply = !thread.blocked_at
  const candidates: PopupCandidate[] = []
  const states: Record<string, PopupState> = {}
  let modalsShown24h = 0
  const dayAgo = now.getTime() - DAY_MS
  for (const row of (data ?? []) as Array<CommMessageRow>) {
    const c = candidateFromMessage(row, { canReply })
    if (!c) continue
    candidates.push(c)
    const st = readState(row.id, row.metadata)
    states[row.id] = st
    if (c.important && st.seenAt && new Date(st.seenAt).getTime() > dayAgo) modalsShown24h += 1
  }
  return { threadId: thread.id, candidates, states, modalsShown24h }
}

/**
 * Record what the user did with a pop-up. Writes only to a staff, outgoing,
 * in-app message of THIS user's conversation; anything else → false (nothing
 * is written).
 */
export async function markPopup(
  sb: SupabaseClient,
  userId: string,
  messageId: string,
  action: PopupAction,
  opts: { days?: PopupSnoozeDays | number; now?: Date } = {},
): Promise<boolean> {
  if (action === 'snooze' && !(POPUP_SNOOZE_DAYS as readonly number[]).includes(opts.days ?? -1)) return false
  const thread = await findThreadByUser(sb, userId)
  if (!thread) return false

  const { data, error } = await sb
    .from('comm_messages')
    .select('id, metadata')
    .eq('id', messageId)
    .eq('thread_id', thread.id)
    .eq('author_kind', 'staff')
    .eq('channel', 'app')
    .eq('direction', 'out')
    .maybeSingle()
  if (error) throw new Error(`popups: read message: ${(error as { code?: string }).code ?? ''}`.trim())
  const row = data as { id: string; metadata: Record<string, unknown> | null } | null
  if (!row) return false

  const now = opts.now ?? new Date()
  const at = now.toISOString()
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const popup = { ...((metadata.popup as Record<string, unknown> | undefined) ?? {}) }
  if (action === 'seen') {
    if (!popup.seenAt) popup.seenAt = at
  } else if (action === 'dismiss') {
    popup.dismissedAt = at
  } else if (action === 'acted') {
    popup.dismissedAt = at
    popup.actedAt = at
  } else {
    popup.snoozedUntil = new Date(now.getTime() + (opts.days as number) * DAY_MS).toISOString()
  }

  const { error: upErr } = await sb
    .from('comm_messages')
    .update({ metadata: { ...metadata, popup } })
    .eq('id', row.id)
    .eq('thread_id', thread.id)
  if (upErr) throw new Error(`popups: update message: ${(upErr as { code?: string }).code ?? ''}`.trim())
  return true
}
