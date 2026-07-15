import { z } from 'zod'
import type { NormalizedOmnichannelMessage, OmnichannelMessageType } from './types'

const tokenSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const sessionSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/)
const providerMessageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value))
const jidSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+@(?:s\.whatsapp\.net|lid)$/)

const bridgeMessageTypeSchema = z.enum([
  'text',
  'button',
  'interactive',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'contacts',
  'reaction',
  'unknown',
])

const bridgeEventSchema = z
  .object({
    version: z.literal(1),
    event_id: tokenSchema,
    event_type: z.literal('message'),
    session_id: sessionSchema,
    message: z
      .object({
        id: providerMessageIdSchema,
        remote_jid: jidSchema,
        remote_jid_alt: jidSchema.optional(),
        push_name: z.string().trim().max(256).nullable().optional(),
        timestamp_ms: z.number().int().min(1_450_000_000_000).max(9_999_999_999_999),
        text: z.string().max(8_000).nullable().optional(),
        message_type: bridgeMessageTypeSchema,
        live: z.boolean(),
        from_me: z.literal(false),
      })
      .strict(),
  })
  .strict()

export type WhatsAppWebBridgeEvent = z.infer<typeof bridgeEventSchema>

export interface ParsedWhatsAppWebBridgeEvent {
  eventId: string
  sessionId: string
  live: boolean
  message: NormalizedOmnichannelMessage
}

function canonicalJid(event: WhatsAppWebBridgeEvent): string {
  // `remote_jid` is Baileys' canonical routing identity. Keep it stable even
  // when a PN alternate is present only on some events; otherwise one person
  // can split into two conversations after a reconnect.
  return event.message.remote_jid
}

function phoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null
  if (!jid.endsWith('@s.whatsapp.net')) return null
  const local = jid.slice(0, -'@s.whatsapp.net'.length).split(':')[0]
  return /^\d{7,15}$/.test(local) ? local : null
}

function verifiedPhone(event: WhatsAppWebBridgeEvent): string | null {
  return phoneFromJid(event.message.remote_jid_alt)
    ?? phoneFromJid(event.message.remote_jid)
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

export function parseWhatsAppWebBridgeEvent(
  payload: unknown,
  nowMs = Date.now(),
): ParsedWhatsAppWebBridgeEvent | null {
  const parsed = bridgeEventSchema.safeParse(payload)
  if (!parsed.success) return null
  const event = parsed.data
  // A provider timestamp may be old after an outage, but cannot be from the
  // future. Reject rather than opening an artificial 24-hour send window.
  if (event.message.timestamp_ms > nowMs + 5 * 60_000) return null

  const jid = canonicalJid(event)
  const accountExternalId = `waweb:${event.session_id}`
  const contactExternalId = `waweb:${event.session_id}:${jid}`
  const messageType = event.message.message_type as OmnichannelMessageType

  return {
    eventId: event.event_id,
    sessionId: event.session_id,
    live: event.message.live,
    message: {
      eventType: 'message',
      channel: 'whatsapp',
      accountExternalId,
      conversationExternalId: jid,
      contactExternalId,
      contactName: event.message.push_name?.trim() || null,
      contactPhone: verifiedPhone(event),
      externalMessageId: `waweb:${event.session_id}:${event.message.id}`,
      direction: 'in',
      messageType,
      text: cleanText(event.message.text),
      status: 'received',
      replyToExternalId: null,
      occurredAt: new Date(event.message.timestamp_ms).toISOString(),
      metadata: {
        transport: 'whatsapp_web',
        bridgeSessionId: event.session_id,
        bridgeEventId: event.event_id,
        bridgeMessageId: event.message.id,
        live: event.message.live,
        catchUp: !event.message.live,
        offline: !event.message.live,
        bridgeUpsertType: event.message.live ? 'notify' : 'append',
        remoteJid: event.message.remote_jid,
        ...(event.message.remote_jid_alt
          ? { remoteJidAlt: event.message.remote_jid_alt }
          : {}),
      },
    },
  }
}
