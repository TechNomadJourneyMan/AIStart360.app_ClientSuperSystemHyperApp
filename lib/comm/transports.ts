/**
 * lib/comm/transports.ts — the actual delivery per channel. Every function
 * never throws and reports a status for the comm_messages row.
 *
 *   app       createNotification (the bell) — the message itself is the feed
 *             of «Сообщения» in the cabinet.
 *   email     sendTransactionalEmail, template buildDirectMessageEmail
 *             (lib/email/templates.ts), idempotent by `comm:<message id>`.
 *   telegram  the client bot (TELEGRAM_BOT_TOKEN) to profiles.telegram_chat_id.
 *   whatsapp  the WhatsApp Web bridge of the AIStart360 QR number — the same
 *             transport as the omnichannel inbox:
 *               direct  (WHATSAPP_WEB_DELIVERY_MODE unset / 'direct') — signed
 *                       POST to the bridge, idempotency key `comm:<message id>`;
 *               pull    the bridge pulls durable deliveries, which belong to an
 *                       inbox conversation and may only answer the person's
 *                       latest message within 24 h (066 authorize rules). So
 *                       in pull mode a message goes out only as a reply to a
 *                       mirrored inbound WhatsApp message of the last 24 h
 *                       (lib/comm/inbound.ts keeps the inbox ids); otherwise
 *                       it is `skipped` (whatsapp_pull_needs_recent_reply).
 *                       The delivery then shows in the inbox conversation too.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'
import { sendTransactionalEmail } from '@/lib/email/send'
import type { EmailContent } from '@/lib/email/layout'
import { sendBotMessage } from '@/lib/telegram/bot-api'
import { botToken } from '@/lib/telegram/bots/registry'
import { createWhatsAppWebClient, getWhatsAppWebBridgeConfig } from '@/lib/omnichannel/whatsapp-web-client'
import { enqueueOutboundDelivery, whatsappWebDeliveryMode } from '@/lib/omnichannel/outbound-deliveries'
import { shouldUseOmnichannelPostgres } from '@/lib/omnichannel/postgres-runtime'
import type { CommMessageStatus } from './types'

export interface DeliveryResult {
  status: CommMessageStatus
  externalId?: string | null
  error?: string | null
}

export interface WhatsAppSendInput {
  sb: SupabaseClient
  threadId: string
  messageId: string
  jid: string
  text: string
  /** Pull mode: staff and system notices go as the manual actor of the inbox queue; bot replies are not supported yet. */
  authorKind: 'staff' | 'bot' | 'system'
  now: Date
}

export interface CommTransports {
  app(input: { userId: string; messageId: string; title: string; body: string; link: string }): Promise<DeliveryResult>
  email(input: { userId: string; messageId: string; to: string; subject: string; content: EmailContent }): Promise<DeliveryResult>
  telegram(input: { chatId: string; html: string }): Promise<DeliveryResult>
  whatsapp(input: WhatsAppSendInput): Promise<DeliveryResult>
  /** The client bot can send (token set). */
  telegramConfigured(): boolean
  /** A WhatsApp Web transport is configured for the current delivery mode. */
  whatsappConfigured(): boolean
}

function short(text: unknown): string {
  return String(text ?? 'error').replace(/\s+/g, ' ').slice(0, 300)
}

export function whatsappTransportConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = whatsappWebDeliveryMode(env)
  if (mode === 'direct') return getWhatsAppWebBridgeConfig(env) !== null
  if (mode === 'pull') {
    return /^(?:1|true|yes|on)$/i.test(env.WHATSAPP_WEB_BRIDGE_ENABLED?.trim() ?? '') && shouldUseOmnichannelPostgres()
  }
  return false
}

const PULL_WINDOW_MS = 24 * 60 * 60 * 1000

/** Pull mode: the latest inbound WhatsApp message of the thread, if it is recent and mirrored from the inbox. */
async function pullReplyContext(sb: SupabaseClient, threadId: string, now: Date): Promise<{ conversationId: string; sourceMessageId: string; sessionId: string } | null> {
  const { data } = await sb
    .from('comm_messages')
    .select('created_at, metadata')
    .eq('thread_id', threadId)
    .eq('direction', 'in')
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { created_at: string; metadata: Record<string, unknown> | null } | null
  if (!row || now.getTime() - new Date(row.created_at).getTime() > PULL_WINDOW_MS) return null
  const m = row.metadata ?? {}
  const conversationId = typeof m.omnichannelConversationId === 'string' ? m.omnichannelConversationId : null
  const sourceMessageId = typeof m.omnichannelMessageId === 'string' ? m.omnichannelMessageId : null
  const sessionId = typeof m.bridgeSessionId === 'string' ? m.bridgeSessionId : null
  return conversationId && sourceMessageId && sessionId ? { conversationId, sourceMessageId, sessionId } : null
}

async function sendWhatsApp(input: WhatsAppSendInput): Promise<DeliveryResult> {
  const mode = whatsappWebDeliveryMode()
  if (mode === null) return { status: 'failed', error: 'invalid_delivery_mode' }
  const idempotencyKey = `comm:${input.messageId}`
  if (mode === 'pull') {
    if (input.authorKind === 'bot') return { status: 'skipped', error: 'whatsapp_pull_no_bot' }
    if (!whatsappTransportConfigured()) return { status: 'skipped', error: 'whatsapp_not_configured' }
    const ctx = await pullReplyContext(input.sb, input.threadId, input.now)
    if (!ctx) return { status: 'skipped', error: 'whatsapp_pull_needs_recent_reply' }
    const queued = await enqueueOutboundDelivery({
      conversationId: ctx.conversationId,
      sourceInboundMessageId: ctx.sourceMessageId,
      sessionId: ctx.sessionId,
      idempotencyKey,
      text: input.text,
      actor: 'manual',
      aiGenerated: false,
      metadata: { source: 'aistart360_comm', commMessageId: input.messageId },
      finalization: { kind: 'manual', reason: 'aistart360_comm' },
    })
    return { status: 'queued', externalId: `delivery:${queued.id}` }
  }
  const config = getWhatsAppWebBridgeConfig()
  if (!config) return { status: 'skipped', error: 'whatsapp_not_configured' }
  const res = await createWhatsAppWebClient().sendText({
    recipientId: input.jid,
    text: input.text,
    accountExternalId: config.accountExternalId,
    idempotencyKey,
  })
  return res.ok ? { status: 'sent', externalId: res.externalMessageId } : { status: 'failed', error: short(res.code) }
}

export const defaultTransports: CommTransports = {
  async app({ userId, messageId, title, body, link }) {
    const ok = await createNotification({
      userId, title, body, link, category: 'expert', priority: 'medium',
      metadata: { event: 'comm_message', comm_message_id: messageId },
    })
    return ok ? { status: 'delivered' } : { status: 'failed', error: 'notification_insert_failed' }
  },
  async email({ userId, messageId, to, subject, content }) {
    try {
      const res = await sendTransactionalEmail({
        kind: 'direct_message', to, subject, content, userId,
        dedupeKey: `comm:${messageId}`,
        metadata: { comm_message_id: messageId },
      })
      return res.ok ? { status: 'sent', externalId: res.providerId ?? null } : { status: 'failed', error: short(res.error) }
    } catch (err) {
      return { status: 'failed', error: short(err instanceof Error ? err.message : err) }
    }
  },
  async telegram({ chatId, html }) {
    const res = await sendBotMessage(chatId, html)
    return res.ok ? { status: 'sent', externalId: String(res.result.message_id) } : { status: 'failed', error: short(res.description) }
  },
  async whatsapp(input) {
    try {
      return await sendWhatsApp(input)
    } catch (err) {
      return { status: 'failed', error: short(err instanceof Error ? err.message.split('\n')[0] : err) }
    }
  },
  telegramConfigured: () => !!botToken('client'),
  whatsappConfigured: () => whatsappTransportConfigured(),
}
