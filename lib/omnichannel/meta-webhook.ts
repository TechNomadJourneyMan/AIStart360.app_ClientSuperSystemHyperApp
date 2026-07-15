import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type {
  JsonObject,
  JsonValue,
  NormalizedMetaWebhookEvent,
  NormalizedOmnichannelMessage,
  NormalizedWhatsAppStatus,
  OmnichannelMessageType,
  WhatsAppDeliveryStatus,
} from './types'

type UnknownRecord = Record<string, unknown>

const WHATSAPP_OBJECT = 'whatsapp_business_account'
const WHATSAPP_STATUSES = new Set<WhatsAppDeliveryStatus>(['sent', 'delivered', 'read', 'failed'])
const WHATSAPP_MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker'])

const WHATSAPP_PLACEHOLDERS: Record<string, string> = {
  image: '[WhatsApp image]',
  video: '[WhatsApp video]',
  audio: '[WhatsApp audio]',
  document: '[WhatsApp document]',
  sticker: '[WhatsApp sticker]',
  location: '[WhatsApp location]',
  contacts: '[WhatsApp contact]',
  reaction: '[WhatsApp reaction]',
}

/**
 * Verify Meta's `x-hub-signature-256` against the exact, unparsed request body.
 * The secret and signature are never returned or included in thrown errors.
 */
export function verifyMetaWebhookSignature(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  const submittedHex = signatureHeader.slice('sha256='.length)
  if (!/^[a-f0-9]{64}$/i.test(submittedHex)) return false

  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  const submitted = Buffer.from(submittedHex, 'hex')

  return submitted.length === expected.length && timingSafeEqual(submitted, expected)
}

/**
 * Convert supported Instagram Messaging and WhatsApp Cloud API payloads into
 * a shared, persistence-ready event shape. Unknown or malformed entries are
 * skipped instead of making the entire webhook fail.
 */
export function parseMetaWebhook(payload: unknown): NormalizedMetaWebhookEvent[] {
  const root = asRecord(payload)
  if (!root) return []

  const object = asString(root.object)
  if (object === WHATSAPP_OBJECT) return parseWhatsAppWebhook(root)
  if (object === 'instagram') return parseInstagramWebhook(root)
  return []
}

function parseInstagramWebhook(root: UnknownRecord): NormalizedOmnichannelMessage[] {
  const events: NormalizedOmnichannelMessage[] = []

  for (const entryValue of asArray(root.entry)) {
    const entry = asRecord(entryValue)
    const accountExternalId = asString(entry?.id)
    if (!entry || !accountExternalId) continue

    for (const messagingValue of asArray(entry.messaging)) {
      const messaging = asRecord(messagingValue)
      if (!messaging) continue

      const senderExternalId = asString(asRecord(messaging.sender)?.id)
      const recipientExternalId = asString(asRecord(messaging.recipient)?.id)
      if (!senderExternalId || !recipientExternalId) continue

      // Meta echoes an Instagram business account's own messages. Comparing
      // sender with entry.id is authoritative even when `is_echo` is absent.
      const direction = senderExternalId === accountExternalId ? 'out' : 'in'
      const contactExternalId = direction === 'out' ? recipientExternalId : senderExternalId
      const message = asRecord(messaging.message)
      const postback = asRecord(messaging.postback)
      if (!message && !postback) continue

      const timestamp = asFiniteNumber(messaging.timestamp)
      const occurredAt = timestamp === null ? null : toIsoTimestamp(timestamp, 'milliseconds')
      const parsed = postback
        ? parseInstagramPostback(postback)
        : parseInstagramMessage(message as UnknownRecord)

      const providerMessageId = asString((postback ?? message)?.mid)
      const externalMessageId = providerMessageId ?? syntheticInstagramMessageId({
        accountExternalId,
        senderExternalId,
        recipientExternalId,
        timestamp,
        event: postback ?? message,
      })

      events.push({
        eventType: 'message',
        channel: 'instagram',
        accountExternalId,
        conversationExternalId: contactExternalId,
        contactExternalId,
        contactName: null,
        externalMessageId,
        direction,
        messageType: parsed.messageType,
        text: parsed.text,
        status: direction === 'out' ? 'sent' : 'received',
        replyToExternalId: message ? instagramReplyId(message) : null,
        occurredAt,
        metadata: {
          ...parsed.metadata,
          isEcho: direction === 'out',
        },
      })
    }
  }

  return events
}

function parseInstagramMessage(message: UnknownRecord): {
  messageType: OmnichannelMessageType
  text: string | null
  metadata: JsonObject
} {
  const quickReply = asRecord(message.quick_reply)
  const quickReplyPayload = asString(quickReply?.payload)
  if (quickReplyPayload) {
    return {
      messageType: 'button',
      text: asString(message.text) ?? quickReplyPayload,
      metadata: { quickReplyPayload },
    }
  }

  const attachments = asArray(message.attachments)
    .map(asRecord)
    .filter((attachment): attachment is UnknownRecord => attachment !== null)
  const attachmentTypes = attachments
    .map((attachment) => asString(attachment.type))
    .filter((type): type is string => type !== null)

  if (attachments.length > 0) {
    const fallback = attachmentTypes.length > 0
      ? `[Instagram attachment: ${attachmentTypes.join(', ')}]`
      : '[Instagram attachment]'

    return {
      messageType: 'attachment',
      text: asString(message.text) ?? fallback,
      metadata: {
        attachmentCount: attachments.length,
        attachmentTypes,
      },
    }
  }

  return {
    messageType: 'text',
    text: asString(message.text),
    metadata: {},
  }
}

function parseInstagramPostback(postback: UnknownRecord): {
  messageType: 'postback'
  text: string
  metadata: JsonObject
} {
  const title = asString(postback.title)
  const payload = asString(postback.payload)

  return {
    messageType: 'postback',
    text: title ?? payload ?? '[Instagram postback]',
    metadata: payload ? { postbackPayload: payload } : {},
  }
}

function instagramReplyId(message: UnknownRecord): string | null {
  const replyTo = asRecord(message.reply_to)
  return asString(replyTo?.mid) ?? asString(replyTo?.id)
}

function syntheticInstagramMessageId(input: {
  accountExternalId: string
  senderExternalId: string
  recipientExternalId: string
  timestamp: number | null
  event: UnknownRecord | null
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
  return `ig.synthetic.${digest}`
}

function parseWhatsAppWebhook(root: UnknownRecord): NormalizedMetaWebhookEvent[] {
  const events: NormalizedMetaWebhookEvent[] = []

  for (const entryValue of asArray(root.entry)) {
    const entry = asRecord(entryValue)
    if (!entry) continue

    const wabaExternalId = asString(entry.id)
    for (const changeValue of asArray(entry.changes)) {
      const change = asRecord(changeValue)
      const value = asRecord(change?.value)
      if (!value) continue

      const metadata = asRecord(value.metadata)
      const accountExternalId = asString(metadata?.phone_number_id) ?? wabaExternalId
      if (!accountExternalId) continue

      const contactNames = whatsappContactNames(value.contacts)

      for (const messageValue of asArray(value.messages)) {
        const message = asRecord(messageValue)
        const event = message
          ? parseWhatsAppMessage(message, accountExternalId, wabaExternalId, contactNames)
          : null
        if (event) events.push(event)
      }

      for (const statusValue of asArray(value.statuses)) {
        const status = asRecord(statusValue)
        const event = status
          ? parseWhatsAppStatus(status, accountExternalId, wabaExternalId)
          : null
        if (event) events.push(event)
      }
    }
  }

  return events
}

function parseWhatsAppMessage(
  message: UnknownRecord,
  accountExternalId: string,
  wabaExternalId: string | null,
  contactNames: Map<string, string>,
): NormalizedOmnichannelMessage | null {
  const contactExternalId = asString(message.from)
  const externalMessageId = asString(message.id)
  if (!contactExternalId || !externalMessageId) return null

  const content = parseWhatsAppContent(message)
  const context = asRecord(message.context)

  return {
    eventType: 'message',
    channel: 'whatsapp',
    accountExternalId,
    conversationExternalId: contactExternalId,
    contactExternalId,
    contactName: contactNames.get(contactExternalId) ?? null,
    externalMessageId,
    direction: 'in',
    messageType: content.messageType,
    text: content.text,
    status: 'received',
    replyToExternalId: asString(context?.id),
    occurredAt: toIsoTimestamp(asFiniteNumber(message.timestamp), 'seconds'),
    metadata: withOptionalJsonValue(content.metadata, 'wabaExternalId', wabaExternalId),
  }
}

function parseWhatsAppContent(message: UnknownRecord): {
  messageType: OmnichannelMessageType
  text: string | null
  metadata: JsonObject
} {
  const providerType = asString(message.type) ?? 'unknown'

  if (providerType === 'text') {
    return {
      messageType: 'text',
      text: asString(asRecord(message.text)?.body),
      metadata: { providerMessageType: providerType },
    }
  }

  if (providerType === 'button') {
    const button = asRecord(message.button)
    const payload = asString(button?.payload)
    return {
      messageType: 'button',
      text: asString(button?.text) ?? payload ?? '[WhatsApp button reply]',
      metadata: withOptionalJsonValue(
        { providerMessageType: providerType },
        'buttonPayload',
        payload,
      ),
    }
  }

  if (providerType === 'interactive') {
    return parseWhatsAppInteractive(asRecord(message.interactive))
  }

  if (WHATSAPP_MEDIA_TYPES.has(providerType)) {
    const media = asRecord(message[providerType])
    const caption = asString(media?.caption)
    const placeholder = WHATSAPP_PLACEHOLDERS[providerType] ?? `[WhatsApp ${providerType}]`
    let metadata: JsonObject = { providerMessageType: providerType }
    metadata = withOptionalJsonValue(metadata, 'mediaId', asString(media?.id))
    metadata = withOptionalJsonValue(metadata, 'mimeType', asString(media?.mime_type))
    metadata = withOptionalJsonValue(metadata, 'filename', asString(media?.filename))

    return {
      messageType: providerType as OmnichannelMessageType,
      text: caption ? `${placeholder} ${caption}` : placeholder,
      metadata,
    }
  }

  if (providerType === 'location' || providerType === 'contacts') {
    return {
      messageType: providerType,
      text: WHATSAPP_PLACEHOLDERS[providerType],
      metadata: { providerMessageType: providerType },
    }
  }

  if (providerType === 'reaction') {
    const reaction = asRecord(message.reaction)
    let metadata: JsonObject = { providerMessageType: providerType }
    metadata = withOptionalJsonValue(metadata, 'reactionToExternalId', asString(reaction?.message_id))
    return {
      messageType: 'reaction',
      text: asString(reaction?.emoji) ?? WHATSAPP_PLACEHOLDERS.reaction,
      metadata,
    }
  }

  return {
    messageType: 'unknown',
    text: `[Unsupported WhatsApp message: ${safeProviderType(providerType)}]`,
    metadata: { providerMessageType: safeProviderType(providerType) },
  }
}

function parseWhatsAppInteractive(interactive: UnknownRecord | null): {
  messageType: 'interactive' | 'unknown'
  text: string
  metadata: JsonObject
} {
  const interactiveType = asString(interactive?.type) ?? 'unknown'
  const reply = interactiveType === 'button_reply'
    ? asRecord(interactive?.button_reply)
    : interactiveType === 'list_reply'
      ? asRecord(interactive?.list_reply)
      : null
  const replyId = validWhatsAppInteractiveReplyId(reply?.id, interactiveType)
  const title = asString(reply?.title)
  const description = asString(reply?.description)
  let metadata: JsonObject = { interactiveType: safeProviderType(interactiveType) }
  metadata = withOptionalJsonValue(metadata, 'interactiveId', replyId)

  // Only reply types whose identifier can be correlated with an option sent by
  // this application are safe for automated handling. WhatsApp Flows
  // (`nfm_reply`) and future/unknown interactive payloads can contain structured
  // data with different semantics, so they must go through human triage.
  if (!reply || !replyId) {
    return {
      messageType: 'unknown',
      text: title
        ?? description
        ?? `[Unsupported WhatsApp interactive: ${safeProviderType(interactiveType)}]`,
      metadata,
    }
  }

  return {
    messageType: 'interactive',
    text: title ?? description ?? `[WhatsApp interactive: ${safeProviderType(interactiveType)}]`,
    metadata,
  }
}

function validWhatsAppInteractiveReplyId(
  value: unknown,
  interactiveType: string,
): string | null {
  const id = asString(value)
  if (!id || id !== id.trim() || /[\u0000-\u001F\u007F]/u.test(id)) return null

  const maximumLength = interactiveType === 'list_reply' ? 200 : 256
  return id.length <= maximumLength ? id : null
}

function parseWhatsAppStatus(
  statusRecord: UnknownRecord,
  accountExternalId: string,
  wabaExternalId: string | null,
): NormalizedWhatsAppStatus | null {
  const externalMessageId = asString(statusRecord.id)
  const contactExternalId = asString(statusRecord.recipient_id)
  const statusValue = asString(statusRecord.status)
  if (
    !externalMessageId
    || !contactExternalId
    || !statusValue
    || !WHATSAPP_STATUSES.has(statusValue as WhatsAppDeliveryStatus)
  ) {
    return null
  }

  const conversation = asRecord(statusRecord.conversation)
  const origin = asRecord(conversation?.origin)
  const pricing = asRecord(statusRecord.pricing)
  const errors = asArray(statusRecord.errors)
    .map(asRecord)
    .filter((error): error is UnknownRecord => error !== null)
  const firstError = errors[0]

  let metadata: JsonObject = {
    errorCodes: errors
      .map((error) => asFiniteNumber(error.code))
      .filter((code): code is number => code !== null),
  }
  metadata = withOptionalJsonValue(metadata, 'wabaExternalId', wabaExternalId)
  metadata = withOptionalJsonValue(metadata, 'providerConversationId', asString(conversation?.id))
  metadata = withOptionalJsonValue(metadata, 'conversationOrigin', asString(origin?.type))
  metadata = withOptionalJsonValue(metadata, 'pricingCategory', asString(pricing?.category))

  return {
    eventType: 'status',
    channel: 'whatsapp',
    accountExternalId,
    conversationExternalId: contactExternalId,
    contactExternalId,
    externalMessageId,
    status: statusValue as WhatsAppDeliveryStatus,
    occurredAt: toIsoTimestamp(asFiniteNumber(statusRecord.timestamp), 'seconds'),
    errorReason: asString(firstError?.message) ?? asString(firstError?.title),
    metadata,
  }
}

function whatsappContactNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>()
  for (const contactValue of asArray(value)) {
    const contact = asRecord(contactValue)
    const id = asString(contact?.wa_id)
    const name = asString(asRecord(contact?.profile)?.name)
    if (id && name) names.set(id, name)
  }
  return names
}

function withOptionalJsonValue(
  source: JsonObject,
  key: string,
  value: JsonValue | undefined,
): JsonObject {
  return value === null || value === undefined ? source : { ...source, [key]: value }
}

function toIsoTimestamp(value: number | null, unit: 'seconds' | 'milliseconds'): string | null {
  if (value === null) return null
  const date = new Date(unit === 'seconds' ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function safeProviderType(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64)
  return sanitized || 'unknown'
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.length > 0
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}
