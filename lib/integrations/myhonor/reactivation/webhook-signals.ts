import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { detectDeterministicRisk } from '@/lib/omnichannel/guardrails'
import type {
  NormalizedOmnichannelMessage,
  NormalizedWhatsAppStatus,
} from '@/lib/omnichannel/types'
import { createServiceClient } from '@/lib/supabase-service'
import { contactPhoneHash } from './identity'
import {
  getMyHonorReactivationConfiguration,
  type MyHonorReactivationConfiguration,
} from './types'

export interface AppliedMyHonorReactivationDeliveryStatus {
  matched: boolean
  recipientId: string | null
  state: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | null
}

export type MyHonorReactivationInboundSkipReason =
  | 'not_inbound_whatsapp'
  | 'reactivation_not_configured'
  | 'invalid_or_opaque_phone'
  | 'invalid_provider_event'

export type AppliedMyHonorReactivationInboundSignal =
  | {
      applied: false
      reason: MyHonorReactivationInboundSkipReason
      matchedContact: false
      attributedRecipientId: null
      suppressed: false
    }
  | {
      applied: true
      reason: null
      matchedContact: boolean
      attributedRecipientId: string | null
      suppressed: boolean
    }

interface WebhookSignalDependencies {
  client?: SupabaseClient
  configuration?: MyHonorReactivationConfiguration
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_64_PATTERN = /^[a-f0-9]{64}$/

function objectRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid MyHonor reactivation webhook result')
  }
  return value as Record<string, unknown>
}

function stableDigest(...parts: readonly string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8')
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
    hash.update(';')
  }
  return hash.digest('hex')
}

function configurationBinding(
  configuration: MyHonorReactivationConfiguration,
): { masterKey: string; ownerUserId: string; companyId: string } | null {
  if (
    !configuration.masterKey
    || !configuration.ownerUserId
    || !configuration.companyId
  ) return null

  return {
    masterKey: configuration.masterKey,
    ownerUserId: configuration.ownerUserId,
    companyId: configuration.companyId,
  }
}

/**
 * WhatsApp Cloud API uses E.164 digits without the leading plus as `wa_id`.
 * Opaque WhatsApp Web LIDs/JIDs are deliberately not converted or guessed.
 */
function eventPhoneE164(event: NormalizedOmnichannelMessage): string | null {
  for (const candidate of [event.contactPhone, event.contactExternalId]) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (/^\+[1-9][0-9]{7,14}$/.test(trimmed)) return trimmed
    if (/^[1-9][0-9]{7,14}$/.test(trimmed)) return `+${trimmed}`
  }
  return null
}

function occurredAt(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function skipped(
  reason: MyHonorReactivationInboundSkipReason,
): AppliedMyHonorReactivationInboundSignal {
  return {
    applied: false,
    reason,
    matchedContact: false,
    attributedRecipientId: null,
    suppressed: false,
  }
}

/**
 * Offer a WhatsApp delivery receipt to the MyHonor marketing ledger. The
 * caller retains ownership of routing order (transactional, reactivation,
 * then ordinary omnichannel).
 */
export async function applyMyHonorReactivationDeliveryStatus(
  event: NormalizedWhatsAppStatus,
  client: SupabaseClient = createServiceClient(),
): Promise<AppliedMyHonorReactivationDeliveryStatus> {
  const { data, error } = await client
    .rpc('apply_myhonor_reactivation_delivery_status', {
      p_provider_message_id: event.externalMessageId,
      p_status: event.status,
      p_occurred_at: event.occurredAt,
      p_error_code: event.status === 'failed' ? 'meta.delivery_failed' : null,
    })
    .maybeSingle()
  if (error) throw new Error('apply MyHonor reactivation delivery status failed')

  const row = objectRow(data)
  const recipientId = row.recipient_id
  const state = row.recipient_state
  if (
    typeof row.matched !== 'boolean'
    || (recipientId !== null && (
      typeof recipientId !== 'string' || !UUID_PATTERN.test(recipientId)
    ))
    || (state !== null && ![
      'accepted',
      'sent',
      'delivered',
      'read',
      'failed',
    ].includes(String(state)))
  ) {
    throw new Error('invalid MyHonor reactivation delivery status result')
  }

  return {
    matched: row.matched,
    recipientId: recipientId as string | null,
    state: state as AppliedMyHonorReactivationDeliveryStatus['state'],
  }
}

/**
 * Correlate an already-ingested inbound WhatsApp message with the most recent
 * MyHonor campaign recipient. The RPC owns the atomic reply attribution and
 * STOP suppression. Only derived booleans and digests cross this boundary;
 * message text and a plaintext phone are never persisted or logged here.
 */
export async function applyMyHonorReactivationInboundSignal(
  event: NormalizedOmnichannelMessage,
  dependencies: WebhookSignalDependencies = {},
): Promise<AppliedMyHonorReactivationInboundSignal> {
  if (event.channel !== 'whatsapp' || event.direction !== 'in') {
    return skipped('not_inbound_whatsapp')
  }

  const configuration = dependencies.configuration
    ?? getMyHonorReactivationConfiguration()
  const binding = configurationBinding(configuration)
  if (!binding) return skipped('reactivation_not_configured')

  const phoneE164 = eventPhoneE164(event)
  if (!phoneE164) return skipped('invalid_or_opaque_phone')
  const eventOccurredAt = occurredAt(event.occurredAt)
  if (!eventOccurredAt || !event.externalMessageId.trim()) {
    return skipped('invalid_provider_event')
  }

  const optOut = detectDeterministicRisk(event.text ?? '').optOut
  const providerEventDigest = stableDigest(
    'meta-whatsapp-inbound',
    event.accountExternalId,
    event.externalMessageId,
  )
  const eventId = `meta-wa:${providerEventDigest}`
  const eventHash = stableDigest(
    'myhonor-reactivation-inbound-v1',
    providerEventDigest,
    eventOccurredAt,
    event.messageType,
    optOut ? 'opt-out' : 'reply',
  )
  const actorHash = stableDigest(
    'meta-whatsapp-provider',
    event.accountExternalId,
  )
  if (!HEX_64_PATTERN.test(eventHash) || !HEX_64_PATTERN.test(actorHash)) {
    throw new Error('invalid MyHonor reactivation inbound digest')
  }

  const client = dependencies.client ?? createServiceClient()
  const { data, error } = await client
    .rpc('apply_myhonor_reactivation_inbound_signal', {
      p_user_id: binding.ownerUserId,
      p_company_id: binding.companyId,
      p_phone_hash: contactPhoneHash(phoneE164, binding.masterKey),
      p_event_id: eventId,
      p_event_hash: eventHash,
      p_occurred_at: eventOccurredAt,
      p_opt_out: optOut,
      p_actor_hash: actorHash,
    })
    .maybeSingle()
  if (error) throw new Error('apply MyHonor reactivation inbound signal failed')

  const row = objectRow(data)
  const recipientId = row.attributed_recipient_id
  if (
    typeof row.matched_contact !== 'boolean'
    || typeof row.suppressed !== 'boolean'
    || (recipientId !== null && (
      typeof recipientId !== 'string' || !UUID_PATTERN.test(recipientId)
    ))
  ) {
    throw new Error('invalid MyHonor reactivation inbound signal result')
  }

  return {
    applied: true,
    reason: null,
    matchedContact: row.matched_contact,
    attributedRecipientId: recipientId as string | null,
    suppressed: row.suppressed,
  }
}
