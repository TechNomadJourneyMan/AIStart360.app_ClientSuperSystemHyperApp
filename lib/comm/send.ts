/**
 * lib/comm/send.ts — sendToUser(): one message from staff / bot / system to a
 * user over the chosen channels, with a journal row per channel.
 *
 *   1. the user's conversation (created on first use);
 *   2. channels: explicit list or 'auto' (lib/comm/channels.ts);
 *   3. one comm_messages row per channel, all sharing group_id — a channel that
 *      cannot be used is recorded as `skipped` with the reason;
 *   4. delivery in parallel, each row updated with its status / provider id;
 *   5. the thread: last_outbound_at, waiting_user when staff or the bot wrote
 *      (staff also resets the reply deadline — lib/comm/state.ts).
 *
 * A personal message goes out at once (no working hours — that is for
 * broadcasts, phase 3).
 *
 * Moderation (lib/comm/moderation.ts): a staff text with profanity is refused
 * (ProfanityError naming the field), a bot text is masked; nothing is sent to
 * a user blocked in communication (CommError 'blocked').
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { buildDirectMessageEmail } from '@/lib/email/templates'
import { getSiteUrl } from '@/lib/site-url'
import { channelAvailability, resolveCommChannels, type ChannelRequest } from './channels'
import { telegramText, whatsappText } from './format'
import { phoneKey, whatsappJid } from './phone'
import { assertCleanOutbound, sanitizeBotReply } from './moderation'
import { previewOf, threadPatchOnOutbound } from './state'
import {
  CommError, ensureThread, insertMessages, lastInboundChannel, loadRecipient, updateMessage, updateThread,
  whatsappLinkOptedOut, type NewMessage,
} from './store'
import { defaultTransports, type CommTransports, type DeliveryResult } from './transports'
import { MAX_BODY, type CommChannel, type CommMessageRow, type CommMessageStatus, type CommThreadMode } from './types'

export const CLIENT_MESSAGES_PATH = '/client/messages'

export interface SendToUserInput {
  userId: string
  channels: ChannelRequest
  body: string
  subject?: string | null
  authorKind: 'staff' | 'bot' | 'system'
  authorId?: string | null
  authorName?: string | null
  campaignId?: string | null
  replyToId?: string | null
}

export interface SendToUserDeps {
  sb?: SupabaseClient
  transports?: CommTransports
  now?: Date
  /** Mode of a conversation created by this send (setting comm_bot_auto_default). */
  defaultMode?: CommThreadMode
}

export interface SentChannel {
  id: string
  channel: CommChannel
  status: CommMessageStatus
  error: string | null
}

export interface SendToUserResult {
  ok: boolean
  threadId: string
  groupId: string
  messages: SentChannel[]
}

/** Normalised message text or a CommError('invalid'). */
export function cleanBody(raw: unknown, max = MAX_BODY): string {
  const body = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : ''
  if (!body) throw new CommError('Введите текст сообщения', 'invalid')
  if (body.length > max) throw new CommError(`Сообщение длиннее ${max} символов`, 'invalid')
  return body
}

export async function sendToUser(input: SendToUserInput, deps: SendToUserDeps = {}): Promise<SendToUserResult> {
  const sb = deps.sb ?? createServiceClient()
  const transports = deps.transports ?? defaultTransports
  const now = deps.now ?? new Date()
  let body = cleanBody(input.body)
  const subject = input.subject?.trim().slice(0, 200) || null
  if (input.authorKind === 'staff') assertCleanOutbound({ body, subject })
  if (input.authorKind === 'bot') body = sanitizeBotReply(body)
  if (input.channels !== 'auto' && input.channels.length === 0) throw new CommError('Выберите хотя бы один канал', 'invalid')

  const recipient = await loadRecipient(sb, input.userId)
  if (!recipient) throw new CommError('Пользователь не найден', 'not_found')
  const thread = await ensureThread(sb, input.userId, { defaultMode: deps.defaultMode })
  if (thread.blocked_at) throw new CommError('Пользователь заблокирован в сообщениях — разблокируйте его, чтобы написать', 'blocked')

  const wantsWhatsApp = input.channels === 'auto' || input.channels.includes('whatsapp')
  const optedOut = !!thread.whatsapp_opt_out_at || (wantsWhatsApp && (await whatsappLinkOptedOut(sb, input.userId)))
  const availability = channelAvailability({
    hasEmail: !!recipient.email,
    hasTelegramChat: !!recipient.telegramChatId,
    telegramBotConfigured: transports.telegramConfigured(),
    hasPhone: !!phoneKey(recipient.phone),
    whatsappOptOut: optedOut,
    whatsappTransport: transports.whatsappConfigured(),
  })
  const lastIn = input.channels === 'auto' && thread.last_inbound_at ? await lastInboundChannel(sb, thread.id) : null
  const resolved = resolveCommChannels(input.channels, { availability, prefs: recipient.preferences, lastInboundChannel: lastIn })

  const groupId = randomUUID()
  const base = {
    thread_id: thread.id,
    group_id: groupId,
    direction: 'out' as const,
    author_kind: input.authorKind,
    author_id: input.authorId ?? null,
    author_name: input.authorName?.trim().slice(0, 200) || null,
    body,
    subject,
    campaign_id: input.campaignId ?? null,
    reply_to_id: input.replyToId ?? null,
  }
  const rows: NewMessage[] = [
    ...resolved.send.map((channel) => ({ ...base, channel, status: 'sending' as const })),
    ...resolved.skipped.map(({ channel, reason }) => ({ ...base, channel, status: 'skipped' as const, error: reason })),
  ]
  const { rows: inserted } = await insertMessages(sb, rows)

  const url = getSiteUrl(CLIENT_MESSAGES_PATH)
  const deliver = async (m: CommMessageRow): Promise<DeliveryResult> => {
    switch (m.channel) {
      case 'app':
        return transports.app({ userId: input.userId, messageId: m.id, title: 'Новое сообщение', body: previewOf(body), link: CLIENT_MESSAGES_PATH })
      case 'email': {
        const built = buildDirectMessageEmail({ name: recipient.fullName, authorName: input.authorKind === 'bot' ? 'Бот AIStart360' : base.author_name, subject, body, url })
        return transports.email({ userId: input.userId, messageId: m.id, to: recipient.email!, subject: built.subject, content: built.content })
      }
      case 'telegram':
        return transports.telegram({ chatId: recipient.telegramChatId!, html: telegramText({ body, authorKind: input.authorKind, authorName: base.author_name }) })
      case 'whatsapp':
        return transports.whatsapp({
          sb, threadId: thread.id, messageId: m.id, jid: whatsappJid(recipient.phone)!,
          text: whatsappText({ body, authorKind: input.authorKind, authorName: base.author_name }),
          authorKind: input.authorKind, now,
        })
    }
  }

  const results = await Promise.all(inserted.map(async (m): Promise<SentChannel> => {
    if (m.status === 'skipped') return { id: m.id, channel: m.channel, status: 'skipped', error: m.error }
    let r: DeliveryResult
    try {
      r = await deliver(m)
    } catch (err) {
      r = { status: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : 'error' }
    }
    await updateMessage(sb, m.id, {
      status: r.status,
      error: r.error ?? null,
      external_id: r.externalId ?? null,
      sent_at: r.status === 'sent' || r.status === 'delivered' ? new Date().toISOString() : null,
    })
    return { id: m.id, channel: m.channel, status: r.status, error: r.error ?? null }
  }))

  // Nothing reached the user → the conversation state stays as it was (he is
  // still waiting for an answer); the failed / skipped rows explain why.
  const ok = results.some((r) => r.status === 'sent' || r.status === 'delivered' || r.status === 'queued')
  if (ok) await updateThread(sb, thread.id, threadPatchOnOutbound(thread, { authorKind: input.authorKind, body, at: now }))

  return { ok, threadId: thread.id, groupId, messages: results }
}
