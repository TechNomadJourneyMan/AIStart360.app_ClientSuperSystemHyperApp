export const OMNICHANNEL_CHANNELS = ['instagram', 'whatsapp'] as const
export type OmnichannelChannel = (typeof OMNICHANNEL_CHANNELS)[number]

export const OMNICHANNEL_MODES = ['off', 'draft', 'auto'] as const
export type OmnichannelMode = (typeof OMNICHANNEL_MODES)[number]

export const OMNICHANNEL_CONVERSATION_STATUSES = ['open', 'needs_human', 'resolved', 'muted'] as const
export type OmnichannelConversationStatus = (typeof OMNICHANNEL_CONVERSATION_STATUSES)[number]

export const OMNICHANNEL_MESSAGE_STATUSES = [
  'received',
  'processing',
  'imported',
  'drafted',
  'sending',
  'sent',
  'replied',
  'delivered',
  'read',
  'failed',
  'ignored',
  'superseded',
  'needs_human',
] as const
export type OmnichannelMessageStatus = (typeof OMNICHANNEL_MESSAGE_STATUSES)[number]

export const OMNICHANNEL_WEBHOOK_EVENT_STATUSES = [
  'received',
  'queued',
  'processing',
  'processed',
  'failed',
  'ignored',
] as const
export type OmnichannelWebhookEventStatus = (typeof OMNICHANNEL_WEBHOOK_EVENT_STATUSES)[number]

export type OmnichannelDirection = 'in' | 'out'

export type OmnichannelTransport =
  | 'instagram_graph'
  | 'whatsapp_cloud'
  | 'whatsapp_web'

export type OmnichannelMessageType =
  | 'text'
  | 'attachment'
  | 'postback'
  | 'button'
  | 'interactive'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'unknown'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export interface OmnichannelSettings {
  channel: OmnichannelChannel
  mode: OmnichannelMode
  enabled: boolean
  businessContext: string | null
  automationConfig: JsonObject
  confidenceThreshold: number
  replyDelaySeconds: number
  updatedAt: string
}

export interface OmnichannelContact {
  id: string
  channel: OmnichannelChannel
  externalId: string
  displayName: string | null
  username: string | null
  phone: string | null
  metadata: JsonObject
  firstSeenAt: string
  lastSeenAt: string
}

export interface OmnichannelConversation {
  id: string
  channel: OmnichannelChannel
  accountExternalId: string
  externalId: string
  contactId: string
  status: OmnichannelConversationStatus
  autoReplyOverride: boolean | null
  sendSuppressed: boolean
  suppressionReason: string | null
  suppressedAt: string | null
  intent: string | null
  sentiment: string | null
  leadScore: number | null
  summary: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  metadata: JsonObject
}

export interface OmnichannelMessage {
  id: string
  conversationId: string
  channel: OmnichannelChannel
  externalMessageId: string
  direction: OmnichannelDirection
  messageType: OmnichannelMessageType
  text: string | null
  status: OmnichannelMessageStatus
  replyToExternalId: string | null
  aiDraft: string | null
  aiConfidence: number | null
  aiReason: string | null
  aiGenerated: boolean
  metadata: JsonObject
  occurredAt: string
  processedAt: string | null
}

export interface OmnichannelWebhookEvent {
  id: string
  channel: OmnichannelChannel
  eventHash: string
  eventType: string | null
  accountExternalId: string | null
  status: OmnichannelWebhookEventStatus
  metadata: JsonObject
  error: string | null
  receivedAt: string
  processedAt: string | null
}

export interface NormalizedOmnichannelMessage {
  eventType: 'message'
  channel: OmnichannelChannel
  accountExternalId: string
  conversationExternalId: string
  contactExternalId: string
  contactName: string | null
  /** Optional verified phone. Canonical WhatsApp Web identities may be opaque LIDs. */
  contactPhone?: string | null
  externalMessageId: string
  direction: OmnichannelDirection
  messageType: OmnichannelMessageType
  text: string | null
  status: OmnichannelMessageStatus
  replyToExternalId: string | null
  occurredAt: string | null
  metadata: JsonObject
}

export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface NormalizedWhatsAppStatus {
  eventType: 'status'
  channel: 'whatsapp'
  accountExternalId: string
  conversationExternalId: string
  contactExternalId: string
  externalMessageId: string
  status: WhatsAppDeliveryStatus
  occurredAt: string | null
  errorReason: string | null
  metadata: JsonObject
}

export type NormalizedMetaWebhookEvent = NormalizedOmnichannelMessage | NormalizedWhatsAppStatus
