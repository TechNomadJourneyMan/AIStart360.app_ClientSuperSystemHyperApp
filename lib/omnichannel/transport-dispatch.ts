import {
  createMetaClient,
  isConfiguredMetaAccount,
  type MetaInteractiveOption,
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

export const OMNICHANNEL_TRANSPORTS = [
  'instagram_graph',
  'whatsapp_cloud',
  'whatsapp_web',
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
 * Presence is intentionally limited to the Web transport. Cloud API and
 * Instagram have no equivalent transient typing command in this integration.
 */
export async function dispatchOmnichannelPresence(
  input: OmnichannelPresenceInput,
): Promise<WhatsAppWebPresenceResult | null> {
  const transport = resolveOmnichannelTransport(input.channel, input.metadata)
  if (transport !== 'whatsapp_web') return null
  return createWhatsAppWebClient().sendPresence({
    recipientId: input.conversationExternalId,
    accountExternalId: input.accountExternalId,
    presence: input.presence,
  })
}
