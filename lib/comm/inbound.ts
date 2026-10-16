/**
 * lib/comm/inbound.ts — a user wrote to the platform.
 *
 *   recordInbound()           the common path: the message lands in the user's
 *                             conversation (status waiting_staff, unread + 1,
 *                             reply deadline — lib/comm/state.ts) and, when it
 *                             opens an unanswered stretch, staff are notified
 *                             (the assignee, else everyone with inbox.manage),
 *                             in the background so the webhook answers fast.
 *   handleTelegramInbound()   free text to the client bot from a chat linked to
 *                             a profile (profiles.telegram_chat_id). An unlinked
 *                             chat is ignored, as before. A short receipt goes
 *                             back at most once per 6 h per chat.
 *   mirrorWhatsAppInbound()   a bridge message whose sender phone matches a
 *                             profile (one indexed lookup, comm_user_by_phone).
 *                             The omnichannel inbox keeps the message exactly as
 *                             before — this only copies it into the platform
 *                             conversation. «стоп» = WhatsApp opt-out.
 *
 * Inbound rows are unique per (channel, external_id): a redelivered update or
 * bridge event is recognised as a duplicate and notifies nobody.
 *
 * Moderation (lib/comm/moderation.ts): the text is stored as written plus a
 * masked copy and flags; profanity → profanity_count + 1 and PROFANITY_WARNING
 * back on the same channel, at most once per 6 h per thread
 * (profanity_warned_at). A user blocked in communication: the message is
 * stored, but staff are not notified and nothing is sent back.
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { runInBackground } from '@/lib/background'
import { notifyStaff } from '@/lib/notifications/staff'
import { getSetting } from '@/lib/settings/store'
import { sendTelegramMessage } from '@/lib/telegram'
import { attachmentLabel, TELEGRAM_RECEIPT_TEXT } from './format'
import { phoneKey } from './phone'
import { moderateInbound, PROFANITY_WARNING, shouldWarnProfanity, staffVisibleBody } from './moderation'
import { sendToUser } from './send'
import { isStopWord, previewOf, shouldSendReceipt, threadPatchOnInbound } from './state'
import { ensureThread, insertMessages, loadRecipient, updateThread } from './store'
import { CHANNEL_LABELS, MAX_BODY, type CommChannel, type CommMessageRow, type CommThreadRow } from './types'

export const GIGA_MESSAGES_PATH = '/admin-giga-panel/messages'

export interface InboundNotice {
  thread: CommThreadRow
  message: CommMessageRow
  userName: string
}

export interface InboundDeps {
  sb?: SupabaseClient
  now?: Date
  /** Staff notification; default notifyStaff in the background. */
  notify?: (n: InboundNotice) => Promise<void>
  /** The automatic profanity warning on the user's channel; default sendToUser (author system). */
  warn?: (w: { userId: string; channel: CommChannel; text: string }) => Promise<void>
  escalationMinutes?: number
}

export interface RecordInboundInput {
  userId: string
  channel: CommChannel
  body: string
  externalId?: string | null
  metadata?: Record<string, unknown>
  /** When the user wrote (provider timestamp); default now. */
  at?: Date
}

export interface RecordInboundResult {
  duplicate: boolean
  thread: CommThreadRow
  message: CommMessageRow | null
  startsWaiting: boolean
  /** The profanity warning went back to the user (the Telegram receipt is then skipped). */
  warned: boolean
}

async function defaultWarn(sb: SupabaseClient, w: { userId: string; channel: CommChannel; text: string }): Promise<void> {
  await sendToUser({ userId: w.userId, channels: [w.channel], body: w.text, authorKind: 'system', authorName: 'AIStart360' }, { sb })
}

async function escalationMinutes(deps: InboundDeps): Promise<number> {
  if (deps.escalationMinutes) return deps.escalationMinutes
  try {
    return await getSetting('comm_escalation_minutes')
  } catch {
    return 30
  }
}

async function defaultMode(): Promise<'manual' | 'auto'> {
  try {
    return (await getSetting('comm_bot_auto_default')) ? 'auto' : 'manual'
  } catch {
    return 'manual'
  }
}

/** The staff notification of an inbound message (WARNING, link to the conversation). */
export async function notifyStaffOfInbound({ thread, message, userName }: InboundNotice): Promise<void> {
  const due = thread.staff_reply_due_at
    ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(new Date(thread.staff_reply_due_at))
    : null
  await notifyStaff({
    level: 'WARNING',
    type: 'comm.inbound',
    title: `Новое сообщение: ${userName}`.slice(0, 200),
    lines: [
      `Канал: ${CHANNEL_LABELS[message.channel]}`,
      `«${previewOf(staffVisibleBody(message))}»`,
      ...(message.flags?.profanity ? ['⚠️ Нецензурная лексика'] : []),
      ...(due ? [`Ответить до ${due} (Алматы)`] : []),
    ],
    companyId: thread.company_id,
    entityType: 'comm_thread',
    entityId: thread.id,
    link: `${GIGA_MESSAGES_PATH}?user=${thread.user_id}`,
    dedupeKey: `comm.inbound:${message.id}`,
    // The assignee (whatever his role lets him see), otherwise whoever may answer.
    audienceUserIds: thread.assignee_id ? [thread.assignee_id] : null,
    audiencePermission: thread.assignee_id ? 'inbox.view' : 'inbox.manage',
    skipCooldown: true,
  })
}

export async function recordInbound(input: RecordInboundInput, deps: InboundDeps = {}): Promise<RecordInboundResult> {
  const sb = deps.sb ?? createServiceClient()
  const now = deps.now ?? new Date()
  const at = input.at && Number.isFinite(input.at.getTime()) && input.at.getTime() <= now.getTime() ? input.at : now
  const body = input.body.replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY) || attachmentLabel('')

  const moderation = moderateInbound(body)
  const profanity = !!moderation.flags.profanity

  const thread = await ensureThread(sb, input.userId, { defaultMode: await defaultMode() })
  const { rows, duplicate } = await insertMessages(sb, [{
    thread_id: thread.id,
    group_id: randomUUID(),
    direction: 'in',
    channel: input.channel,
    author_kind: 'user',
    author_id: input.userId,
    body,
    body_masked: moderation.bodyMasked,
    flags: moderation.flags,
    status: 'delivered',
    external_id: input.externalId ?? null,
    metadata: input.metadata ?? {},
    created_at: at.toISOString(),
    sent_at: at.toISOString(),
  }])
  if (duplicate || !rows[0]) return { duplicate: true, thread, message: null, startsWaiting: false, warned: false }
  const message = rows[0]

  const { patch, startsWaiting } = threadPatchOnInbound(thread, {
    body: moderation.bodyMasked ?? body, at, now, escalationMinutes: await escalationMinutes(deps), profanity,
  })
  const warned = profanity && !thread.blocked_at && shouldWarnProfanity(thread.profanity_warned_at, now)
  const fullPatch = warned ? { ...patch, profanity_warned_at: now.toISOString() } : patch
  await updateThread(sb, thread.id, fullPatch)
  const updated = { ...thread, ...fullPatch } as CommThreadRow

  if (warned) {
    try {
      await (deps.warn ?? ((w) => defaultWarn(sb, w)))({ userId: input.userId, channel: input.channel, text: PROFANITY_WARNING })
    } catch (err) {
      console.error('[comm] profanity warning failed', err instanceof Error ? err.message : err)
    }
  }

  if (startsWaiting) {
    const notify = deps.notify ?? ((n: InboundNotice) => runInBackground('comm-inbound-notify', () => notifyStaffOfInbound(n)))
    try {
      const recipient = await loadRecipient(sb, input.userId).catch(() => null)
      await notify({ thread: updated, message, userName: recipient?.fullName || recipient?.email || 'пользователь' })
    } catch (err) {
      console.error('[comm] staff notification failed', err instanceof Error ? err.message : err)
    }
  }
  return { duplicate: false, thread: updated, message, startsWaiting, warned }
}

// ─── Telegram ───────────────────────────────────────────────────────────────

export interface TelegramInboundInput {
  chatId: string
  text: string
  messageId: number | string | null
  /** Telegram `date` (unix seconds). */
  date?: number | null
}

export interface TelegramInboundDeps extends InboundDeps {
  sendReceipt?: (chatId: string, text: string) => Promise<boolean>
}

/** true — the chat belongs to a platform user and the text was recorded (or was a duplicate). */
export async function handleTelegramInbound(input: TelegramInboundInput, deps: TelegramInboundDeps = {}): Promise<boolean> {
  const text = input.text.trim()
  if (!text || text.startsWith('/')) return false
  const sb = deps.sb ?? createServiceClient()
  const { data } = await sb.from('profiles').select('id').eq('telegram_chat_id', input.chatId).limit(1)
  const userId = (data?.[0] as { id?: string } | undefined)?.id
  if (!userId) return false

  const now = deps.now ?? new Date()
  const res = await recordInbound({
    userId,
    channel: 'telegram',
    body: text,
    externalId: input.messageId != null ? `tg:${input.chatId}:${input.messageId}` : null,
    metadata: { chatId: input.chatId },
    at: typeof input.date === 'number' ? new Date(input.date * 1000) : undefined,
  }, { ...deps, sb, now })
  if (res.duplicate || res.warned || res.thread.blocked_at) return true

  if (shouldSendReceipt(res.thread.tg_receipt_at, now)) {
    await updateThread(sb, res.thread.id, { tg_receipt_at: now.toISOString() })
    await (deps.sendReceipt ?? sendTelegramMessage)(input.chatId, TELEGRAM_RECEIPT_TEXT)
  }
  return true
}

// ─── WhatsApp (bridge mirror) ───────────────────────────────────────────────

export interface WhatsAppMirrorInput {
  /** Verified sender phone (digits) from the bridge event, or null for a LID-only contact. */
  phone: string | null
  text: string | null
  messageType: string
  /** Namespaced provider id, `waweb:<session>:<id>` — the dedupe key. */
  externalMessageId: string
  occurredAt: string
  live: boolean
  bridgeSessionId: string | null
  jid: string | null
  /** The inbox rows the webhook created (needed to reply in pull mode). */
  omnichannelConversationId?: string | null
  omnichannelMessageId?: string | null
}

export type WhatsAppMirrorOutcome = 'no_phone' | 'ignored' | 'no_user' | 'duplicate' | 'recorded'

export async function mirrorWhatsAppInbound(input: WhatsAppMirrorInput, deps: InboundDeps = {}): Promise<WhatsAppMirrorOutcome> {
  if (input.messageType === 'reaction') return 'ignored'
  const key = phoneKey(input.phone)
  if (!key) return 'no_phone'
  const sb = deps.sb ?? createServiceClient()
  const { data, error } = await sb.rpc('comm_user_by_phone', { p_key: key })
  if (error) throw new Error(`comm_user_by_phone: ${error.message?.slice(0, 120)}`)
  const userId = typeof data === 'string' ? data : null
  if (!userId) return 'no_user'

  const text = input.text?.trim() || null
  const res = await recordInbound({
    userId,
    channel: 'whatsapp',
    body: text ?? attachmentLabel(input.messageType),
    externalId: input.externalMessageId,
    at: new Date(input.occurredAt),
    metadata: {
      ...(input.jid ? { jid: input.jid } : {}),
      live: input.live,
      messageType: input.messageType,
      ...(input.bridgeSessionId ? { bridgeSessionId: input.bridgeSessionId } : {}),
      ...(input.omnichannelConversationId ? { omnichannelConversationId: input.omnichannelConversationId } : {}),
      ...(input.omnichannelMessageId ? { omnichannelMessageId: input.omnichannelMessageId } : {}),
    },
  }, { ...deps, sb })
  if (res.duplicate) return 'duplicate'
  if (isStopWord(text) && !res.thread.whatsapp_opt_out_at) {
    await updateThread(sb, res.thread.id, { whatsapp_opt_out_at: (deps.now ?? new Date()).toISOString() })
  }
  return 'recorded'
}
