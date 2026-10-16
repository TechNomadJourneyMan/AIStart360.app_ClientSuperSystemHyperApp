/**
 * lib/comm/types.ts — the vocabulary of platform ↔ user communication
 * (migration 120, docs/superpowers/specs/2026-10-16-user-communications-design.md).
 */

export const COMM_CHANNELS = ['app', 'email', 'telegram', 'whatsapp'] as const
export type CommChannel = (typeof COMM_CHANNELS)[number]

export type CommDirection = 'out' | 'in'
export type CommAuthorKind = 'staff' | 'bot' | 'user' | 'system'
export type CommMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'skipped'
export type CommThreadStatus = 'open' | 'waiting_staff' | 'waiting_user' | 'closed'
export type CommThreadMode = 'manual' | 'auto'

export const CHANNEL_LABELS: Record<CommChannel, string> = {
  app: 'Платформа',
  email: 'Почта',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
}

export const THREAD_STATUS_LABELS: Record<CommThreadStatus, string> = {
  open: 'Открыт',
  waiting_staff: 'Ждёт ответа',
  waiting_user: 'Ждём пользователя',
  closed: 'Закрыт',
}

export function isCommChannel(v: unknown): v is CommChannel {
  return typeof v === 'string' && (COMM_CHANNELS as readonly string[]).includes(v)
}

export interface CommThreadRow {
  id: string
  user_id: string
  company_id: string | null
  assignee_id: string | null
  status: CommThreadStatus
  mode: CommThreadMode
  last_inbound_at: string | null
  last_outbound_at: string | null
  last_message_at: string | null
  last_message_preview: string | null
  staff_reply_due_at: string | null
  escalated_at: string | null
  unread_staff: number
  unread_user: number
  whatsapp_opt_out_at: string | null
  tg_receipt_at: string | null
  profanity_count: number
  profanity_warned_at: string | null
  blocked_at: string | null
  blocked_by: string | null
  block_reason: string | null
  created_at: string
  updated_at: string
}

export interface CommMessageRow {
  id: string
  thread_id: string
  group_id: string
  direction: CommDirection
  channel: CommChannel
  author_kind: CommAuthorKind
  author_id: string | null
  author_name: string | null
  body: string
  /** Inbound with profanity: the «б***» version staff see by default. */
  body_masked: string | null
  /** e.g. { profanity: true, words: 2 }. */
  flags: CommMessageFlags
  subject: string | null
  campaign_id: string | null
  status: CommMessageStatus
  error: string | null
  external_id: string | null
  reply_to_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  sent_at: string | null
}

export interface CommMessageFlags {
  profanity?: boolean
  words?: number
}

/** What lib/comm needs to know about the recipient (profiles + availability). */
export interface CommRecipient {
  id: string
  fullName: string | null
  email: string | null
  phone: string | null
  telegramChatId: string | null
  preferences: unknown
}

export const THREAD_COLUMNS =
  'id, user_id, company_id, assignee_id, status, mode, last_inbound_at, last_outbound_at, last_message_at, last_message_preview, staff_reply_due_at, escalated_at, unread_staff, unread_user, whatsapp_opt_out_at, tg_receipt_at, profanity_count, profanity_warned_at, blocked_at, blocked_by, block_reason, created_at, updated_at'

export const MESSAGE_COLUMNS =
  'id, thread_id, group_id, direction, channel, author_kind, author_id, author_name, body, body_masked, flags, subject, campaign_id, status, error, external_id, reply_to_id, metadata, created_at, sent_at'

/** Longest message body accepted from staff or a user (the DB allows 8000). */
export const MAX_BODY = 4000
