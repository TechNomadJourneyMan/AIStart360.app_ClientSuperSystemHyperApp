import {
  createMetaClient,
  isConfiguredMetaAccount,
  type MetaInteractiveOption,
  type MetaSendFailure,
  type MetaSendResult,
} from './meta-client'
import type { JsonObject, OmnichannelChannel } from './types'
import {
  enqueueOutboundDelivery,
  whatsappWebDeliveryMode,
  type OutboundDeliveryFinalization,
} from './outbound-deliveries'
import { shouldUseOmnichannelPostgres } from './postgres-runtime'
import {
  createWhatsAppWebClient,
  isConfiguredWhatsAppWebAccount,
  type WhatsAppWebPresence,
  type WhatsAppWebPresenceResult,
} from './whatsapp-web-client'
import { isEncryptionConfigured } from '@/lib/crypto/secrets'
import { botToken } from '@/lib/telegram/bots/registry'
import {
  telegramBotIdFromToken,
  telegramSendChatAction,
  telegramSendText,
} from './telegram-bot-api'
import {
  botIdFromBusinessAccount,
  getActiveTelegramBotToken,
} from './telegram-connections'

export const OMNICHANNEL_TRANSPORTS = [
  'instagram_graph',
  'whatsapp_cloud',
  'whatsapp_web',
  'telegram_bot',
  'telegram_client_bot',
] as const

export type OmnichannelTransport = (typeof OMNICHANNEL_TRANSPORTS)[number]

export interface OmnichannelChoicePresentation {
  options: MetaInteractiveOption[]
  buttonText?: string
  sectionTitle?: string
}

export interface OmnichannelDispatchInput {
  channel: OmnichannelChannel
  metadata: JsonObject | null | undefined
  accountExternalId: string
  /** Conversation-level external id. WhatsApp Web stores the canonical 1:1 JID here. */
  conversationExternalId: string
  /** Provider contact id used by Instagram and WhatsApp Cloud API. */
  contactExternalId: string
  text: string
  actor: 'automated' | 'manual'
  useHumanAgent?: boolean
  replyToExternalId?: string | null
  choices?: OmnichannelChoicePresentation | null
  /** Required for every transport; the Web bridge enforces it server-side. */
  idempotencyKey: string
  /** Required only by pull-mode WhatsApp Web delivery. */
  durableDelivery?: {
    conversationId: string
    sourceInboundMessageId?: string | null
    aiGenerated: boolean
    messageType?: 'text' | 'button' | 'interactive'
    metadata: JsonObject
    finalization: OutboundDeliveryFinalization
    typingDelayMs?: number
  }
}

export interface OmnichannelQueuedDispatch {
  ok: true
  queued: true
  deliveryId: string
  deliveryStatus:
    | 'queued'
    | 'leased'
    | 'authorized'
    | 'sent'
    | 'cancelled'
    | 'delivery_unknown'
    | 'dead'
}

export type OmnichannelDispatchResult = MetaSendResult | OmnichannelQueuedDispatch

export function isOmnichannelQueuedDispatch(
  result: OmnichannelDispatchResult,
): result is OmnichannelQueuedDispatch {
  return result.ok && (result as Partial<OmnichannelQueuedDispatch>).queued === true
}

export interface OmnichannelPresenceInput {
  channel: OmnichannelChannel
  metadata: JsonObject | null | undefined
  accountExternalId: string
  conversationExternalId: string
  presence: WhatsAppWebPresence
}

function metadataString(metadata: JsonObject | null | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Existing rows predate transport metadata. They retain their original Meta
 * routing, while WhatsApp Web must always opt in explicitly on the inbound row.
 */
export function resolveOmnichannelTransport(
  channel: OmnichannelChannel,
  metadata: JsonObject | null | undefined,
): OmnichannelTransport | null {
  const declared = metadataString(metadata, 'transport')
  if (channel === 'telegram') {
    // No legacy Telegram rows exist: the transport must always be explicit.
    return declared === 'telegram_bot' || declared === 'telegram_client_bot' ? declared : null
  }
  if (!declared) return channel === 'instagram' ? 'instagram_graph' : 'whatsapp_cloud'
  if (channel === 'instagram') return declared === 'instagram_graph' ? declared : null
  return declared === 'whatsapp_cloud' || declared === 'whatsapp_web' ? declared : null
}

export function isConfiguredOmnichannelSender(input: {
  channel: OmnichannelChannel
  metadata: JsonObject | null | undefined
  accountExternalId: string
}): boolean {
  const transport = resolveOmnichannelTransport(input.channel, input.metadata)
  if (!transport) return false
  if (transport === 'telegram_bot') {
    // Presence-only: the token is looked up (and must be ACTIVE) at send time,
    // so a disconnected bot still fails closed in dispatchOmnichannelReply.
    return botIdFromBusinessAccount(input.accountExternalId) !== null
      && isEncryptionConfigured()
  }
  if (transport === 'telegram_client_bot') {
    return isTelegramClientBotAccount(input.accountExternalId)
  }
  if (transport === 'whatsapp_web') {
    const deliveryMode = whatsappWebDeliveryMode()
    if (deliveryMode === null) return false
    if (deliveryMode === 'pull') {
      const sessionId = process.env.WHATSAPP_WEB_BRIDGE_SESSION_ID?.trim() || 'primary'
      return /^(?:1|true|yes|on)$/i.test(
        process.env.WHATSAPP_WEB_BRIDGE_ENABLED?.trim() ?? '',
      ) && shouldUseOmnichannelPostgres()
        && input.accountExternalId === `waweb:${sessionId}`
    }
    return isConfiguredWhatsAppWebAccount(input.accountExternalId)
  }
  return isConfiguredMetaAccount(input.channel, input.accountExternalId)
}

function localFailure(code: string, message: string): MetaSendResult {
  return { ok: false, status: null, code, message, retryable: false }
}

/** A local refusal that provably never reached Telegram. */
function telegramLocalFailure(code: string, message: string): MetaSendFailure {
  return { ok: false, status: null, code, message, retryable: false, requestSent: false }
}

/** `tgclient:<id>` of the platform's client bot (TELEGRAM_BOT_TOKEN), or null. */
export function telegramClientBotAccountExternalId(): string | null {
  const botId = telegramBotIdFromToken(botToken('client'))
  return botId ? `tgclient:${botId}` : null
}

function isTelegramClientBotAccount(accountExternalId: string): boolean {
  const expected = telegramClientBotAccountExternalId()
  return expected !== null && expected === accountExternalId
}

/**
 * Chats of the platform's client bot are never answered automatically: the
 * inbox settings (business context, scenario) describe the business, not
 * AIStart360. AI still prepares a draft; an operator sends it.
 */
export function isDraftOnlyOmnichannelTransport(
  channel: OmnichannelChannel,
  metadata: JsonObject | null | undefined,
): boolean {
  return resolveOmnichannelTransport(channel, metadata) === 'telegram_client_bot'
}

function isTelegramTransport(
  transport: OmnichannelTransport | null,
): transport is 'telegram_bot' | 'telegram_client_bot' {
  return transport === 'telegram_bot' || transport === 'telegram_client_bot'
}

/** Resolve the Bot API token for a Telegram conversation; never returns it to callers outside the server. */
async function telegramTokenFor(
  transport: 'telegram_bot' | 'telegram_client_bot',
  accountExternalId: string,
): Promise<{ ok: true; token: string } | { ok: false; failure: MetaSendResult }> {
  if (transport === 'telegram_client_bot') {
    const token = botToken('client')
    if (!token || !isTelegramClientBotAccount(accountExternalId)) {
      return {
        ok: false,
        failure: telegramLocalFailure('telegram_bot_not_connected', 'Клиентский бот AIStart360 не настроен или сменился'),
      }
    }
    return { ok: true, token }
  }
  const botId = botIdFromBusinessAccount(accountExternalId)
  if (!botId) {
    return { ok: false, failure: telegramLocalFailure('unsupported_transport', 'Unknown Telegram account') }
  }
  let token: string | null
  try {
    token = await getActiveTelegramBotToken(botId)
  } catch {
    return {
      ok: false,
      failure: telegramLocalFailure('telegram_bot_unavailable', 'Не удалось прочитать подключение Telegram-бота'),
    }
  }
  if (!token) {
    return {
      ok: false,
      failure: telegramLocalFailure('telegram_bot_not_connected', 'Telegram-бот отключён — подключите его в настройках inbox'),
    }
  }
  return { ok: true, token }
}

async function dispatchTelegramReply(
  transport: 'telegram_bot' | 'telegram_client_bot',
  input: OmnichannelDispatchInput,
): Promise<MetaSendResult> {
  const chatId = input.conversationExternalId
  if (!/^-?\d{1,20}$/.test(chatId)) {
    return telegramLocalFailure('invalid_input', 'Telegram chat id is invalid')
  }
  const resolved = await telegramTokenFor(transport, input.accountExternalId)
  if (!resolved.ok) return resolved.failure
  // Equipment-flow choices are already rendered as numbered text in `text`.
  const result = await telegramSendText(resolved.token, { chatId, text: input.text })
  if (!result.ok) return result
  // Telegram message ids are unique per chat only: namespace them like inbound ids.
  return {
    ...result,
    externalMessageId: `${input.accountExternalId}:${chatId}:${result.externalMessageId}`,
  }
}

function bridgeReplyToId(
  metadata: JsonObject | null | undefined,
  fallback: string | null | undefined,
): string | null {
  // The persisted external id is namespaced for cross-provider uniqueness. The
  // bridge needs its raw provider id when a quoted reply is requested.
  return metadataString(metadata, 'bridgeMessageId')
    ?? metadataString(metadata, 'providerExternalMessageId')
    ?? metadataString(metadata, 'externalMessageId')
    ?? fallback
    ?? null
}

export function outboundTransportMetadata(
  channel: OmnichannelChannel,
  inboundMetadata: JsonObject | null | undefined,
): JsonObject {
  const transport = resolveOmnichannelTransport(channel, inboundMetadata)
  if (!transport) return { transport: 'unknown' }
  const sessionId = metadataString(inboundMetadata, 'bridgeSessionId')
  return {
    transport,
    ...(sessionId ? { bridgeSessionId: sessionId } : {}),
  }
}

/**
 * Single fail-closed dispatch point for automated and operator replies.
 * WhatsApp Web intentionally receives the already rendered numbered text rather
 * than Cloud API interactive-list JSON.
 */
export async function dispatchOmnichannelReply(
  input: OmnichannelDispatchInput,
): Promise<OmnichannelDispatchResult> {
  const transport = resolveOmnichannelTransport(input.channel, input.metadata)
  if (!transport) {
    return localFailure('unsupported_transport', 'Conversation transport is not supported')
  }
  if (!input.idempotencyKey.trim()) {
    return localFailure('invalid_input', 'A stable idempotency key is required')
  }

  if (isTelegramTransport(transport)) {
    return dispatchTelegramReply(transport, input)
  }

  if (transport === 'whatsapp_web') {
    const deliveryMode = whatsappWebDeliveryMode()
    if (deliveryMode === null) {
      return localFailure(
        'invalid_delivery_mode',
        'WhatsApp Web delivery mode is invalid',
      )
    }
    if (deliveryMode === 'pull') {
      if (!shouldUseOmnichannelPostgres()) {
        return localFailure(
          'outbound_pull_unavailable',
          'Durable WhatsApp Web delivery requires direct Postgres',
        )
      }
      const delivery = input.durableDelivery
      const sessionId = metadataString(input.metadata, 'bridgeSessionId')
        ?? input.accountExternalId.match(/^waweb:([A-Za-z0-9._-]{1,64})$/)?.[1]
        ?? null
      if (!delivery || !sessionId) {
        return localFailure(
          'invalid_input',
          'Durable WhatsApp Web delivery context is required in pull mode',
        )
      }
      const queued = await enqueueOutboundDelivery({
        conversationId: delivery.conversationId,
        sourceInboundMessageId: delivery.sourceInboundMessageId,
        sessionId,
        idempotencyKey: input.idempotencyKey,
        text: input.text,
        replyToExternalId: bridgeReplyToId(
          input.metadata,
          input.replyToExternalId,
        ),
        actor: input.actor,
        aiGenerated: delivery.aiGenerated,
        messageType: delivery.messageType ?? 'text',
        metadata: delivery.metadata,
        finalization: delivery.finalization,
        typingDelayMs: delivery.typingDelayMs,
      })
      return {
        ok: true,
        queued: true,
        deliveryId: queued.id,
        deliveryStatus: queued.status,
      }
    }
    return createWhatsAppWebClient().sendText({
      recipientId: input.conversationExternalId,
      text: input.text,
      accountExternalId: input.accountExternalId,
      replyToExternalId: bridgeReplyToId(input.metadata, input.replyToExternalId),
      idempotencyKey: input.idempotencyKey,
    })
  }

  const client = createMetaClient()
  if (transport === 'instagram_graph') {
    if (input.choices) {
      return client.sendInstagramQuickReplies({
        recipientId: input.contactExternalId,
        text: input.text,
        actor: input.actor,
        accountExternalId: input.accountExternalId,
        useHumanAgent: input.useHumanAgent,
        options: input.choices.options,
      })
    }
    return client.sendInstagramText({
      recipientId: input.contactExternalId,
      text: input.text,
      actor: input.actor,
      accountExternalId: input.accountExternalId,
      useHumanAgent: input.useHumanAgent,
    })
  }

  if (input.choices) {
    return client.sendWhatsAppList({
      recipientId: input.contactExternalId,
      text: input.text,
      accountExternalId: input.accountExternalId,
      replyToExternalId: input.replyToExternalId,
      buttonText: input.choices.buttonText,
      sectionTitle: input.choices.sectionTitle,
      options: input.choices.options,
    })
  }
  return client.sendWhatsAppText({
    recipientId: input.contactExternalId,
    text: input.text,
    accountExternalId: input.accountExternalId,
    replyToExternalId: input.replyToExternalId,
  })
}

/**
 * Presence: WhatsApp Web (composing/paused) and Telegram (sendChatAction
 * typing). Cloud API and Instagram have no equivalent transient typing
 * command in this integration.
 */
export async function dispatchOmnichannelPresence(
  input: OmnichannelPresenceInput,
): Promise<WhatsAppWebPresenceResult | null> {
  const transport = resolveOmnichannelTransport(input.channel, input.metadata)
  if (isTelegramTransport(transport)) {
    // Telegram's "typing…" lasts ~5 s or until the next message; there is no
    // explicit stop, so `paused` is a no-op.
    if (input.presence !== 'composing') return { ok: true, rawStatus: 204 }
    const resolved = await telegramTokenFor(transport, input.accountExternalId)
    if (!resolved.ok) return null
    return telegramSendChatAction(resolved.token, input.conversationExternalId)
  }
  if (transport !== 'whatsapp_web') return null
  return createWhatsAppWebClient().sendPresence({
    recipientId: input.conversationExternalId,
    accountExternalId: input.accountExternalId,
    presence: input.presence,
  })
}
