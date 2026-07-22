import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import type {
  MyHonorOrderStatus,
  NormalizedMyHonorOrderNotification,
} from './order-notifications'

export type MyHonorNotificationState =
  | 'queued'
  | 'leased'
  | 'authorized'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'delivery_unknown'

export interface EnqueuedMyHonorNotification {
  id: string
  state: MyHonorNotificationState
  providerMessageId: string | null
  runAt: string
  created: boolean
  conflict: boolean
}

export interface ClaimedMyHonorNotification {
  id: string
  leaseToken: string
  eventId: string
  orderId: string
  orderNumber: string
  orderStatus: MyHonorOrderStatus
  statusVersion: number
  recipientPhoneE164: string
  recipientName: string
  locale: string
  details: {
    tracking_number?: string | null
    tracking_url?: string | null
    cancellation_reason?: string | null
  }
  attempts: number
  maxAttempts: number
}

export interface FinishedMyHonorNotification {
  accepted: boolean
  state: MyHonorNotificationState | null
  runAt: string | null
}

export interface AppliedMyHonorDeliveryStatus {
  matched: boolean
  notificationId: string | null
  state: MyHonorNotificationState | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function databaseError(operation: string, error: { message?: string } | null): Error {
  return new Error(
    `${operation}: ${error?.message?.slice(0, 300) || 'database error'}`,
  )
}

function record(value: unknown, operation: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation}: database returned an invalid row`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`myhonor notification database returned invalid ${field}`)
  }
  return value
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return requiredString(value, field)
}

function requiredUuid(value: unknown, field: string): string {
  const stringValue = requiredString(value, field)
  if (!UUID_PATTERN.test(stringValue)) {
    throw new Error(`myhonor notification database returned invalid ${field}`)
  }
  return stringValue
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`myhonor notification database returned invalid ${field}`)
  }
  return value
}

function requiredTimestamp(value: unknown, field: string): string {
  const raw = requiredString(value, field)
  const date = new Date(raw)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`myhonor notification database returned invalid ${field}`)
  }
  return date.toISOString()
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return requiredTimestamp(value, field)
}

function state(value: unknown): MyHonorNotificationState {
  if (
    value === 'queued'
    || value === 'leased'
    || value === 'authorized'
    || value === 'accepted'
    || value === 'sent'
    || value === 'delivered'
    || value === 'read'
    || value === 'failed'
    || value === 'delivery_unknown'
  ) {
    return value
  }
  throw new Error('myhonor notification database returned invalid state')
}

function orderStatus(value: unknown): MyHonorOrderStatus {
  if (
    value === 'confirmed'
    || value === 'shipped'
    || value === 'delivered'
    || value === 'cancelled'
  ) {
    return value
  }
  throw new Error('myhonor notification database returned invalid order_status')
}

export async function enqueueMyHonorOrderNotification(
  input: {
    notification: NormalizedMyHonorOrderNotification
    idempotencyKey: string
    requestHash: string
    maxAttempts?: number
  },
  client: SupabaseClient = createServiceClient(),
): Promise<EnqueuedMyHonorNotification> {
  const value = input.notification
  const { data, error } = await client
    .rpc('enqueue_myhonor_order_notification', {
      p_event_id: value.event_id,
      p_idempotency_key: input.idempotencyKey,
      p_request_hash: input.requestHash,
      p_occurred_at: value.occurred_at,
      p_order_id: value.order_id,
      p_order_number: value.order_number,
      p_order_status: value.status,
      p_status_version: value.status_version,
      p_recipient_phone_e164: value.recipient.phone_e164,
      p_recipient_name: value.recipient.name,
      p_whatsapp_opt_in: value.recipient.whatsapp_opt_in,
      p_locale: value.locale,
      p_details: value.details,
      p_max_attempts: input.maxAttempts ?? 5,
    })
    .maybeSingle()
  if (error) throw databaseError('enqueue myhonor notification', error)
  const row = record(data, 'enqueue myhonor notification')
  return {
    id: requiredUuid(row.notification_id, 'notification_id'),
    state: state(row.notification_state),
    providerMessageId: nullableString(
      row.provider_message_id,
      'provider_message_id',
    ),
    runAt: requiredTimestamp(row.run_at, 'run_at'),
    created: row.created === true,
    conflict: row.conflict === true,
  }
}

export async function claimMyHonorOrderNotification(
  input: {
    notificationId: string
    ownerToken: string
    leaseSeconds?: number
  },
  client: SupabaseClient = createServiceClient(),
): Promise<ClaimedMyHonorNotification | null> {
  if (!UUID_PATTERN.test(input.notificationId)) {
    throw new Error('notificationId must be a UUID')
  }
  const { data, error } = await client
    .rpc('claim_myhonor_order_notification', {
      p_notification_id: input.notificationId,
      p_owner_token: input.ownerToken,
      p_lease_seconds: input.leaseSeconds ?? 120,
    })
    .maybeSingle()
  if (error) throw databaseError('claim myhonor notification', error)
  if (!data) return null
  const row = record(data, 'claim myhonor notification')
  const details = row.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    throw new Error('myhonor notification database returned invalid details')
  }
  return {
    id: requiredUuid(row.notification_id, 'notification_id'),
    leaseToken: requiredUuid(row.lease_token, 'lease_token'),
    eventId: requiredString(row.event_id, 'event_id'),
    orderId: requiredString(row.order_id, 'order_id'),
    orderNumber: requiredString(row.order_number, 'order_number'),
    orderStatus: orderStatus(row.order_status),
    statusVersion: requiredInteger(row.status_version, 'status_version'),
    recipientPhoneE164: requiredString(
      row.recipient_phone_e164,
      'recipient_phone_e164',
    ),
    recipientName: requiredString(row.recipient_name, 'recipient_name'),
    locale: requiredString(row.locale, 'locale'),
    details: details as ClaimedMyHonorNotification['details'],
    attempts: requiredInteger(row.attempts, 'attempts'),
    maxAttempts: requiredInteger(row.max_attempts, 'max_attempts'),
  }
}

export async function authorizeMyHonorOrderNotification(
  input: {
    notificationId: string
    leaseToken: string
    ownerToken: string
    leaseSeconds?: number
  },
  client: SupabaseClient = createServiceClient(),
): Promise<{ authorized: boolean; reason: string }> {
  const { data, error } = await client
    .rpc('authorize_myhonor_order_notification', {
      p_notification_id: input.notificationId,
      p_lease_token: input.leaseToken,
      p_owner_token: input.ownerToken,
      p_lease_seconds: input.leaseSeconds ?? 120,
    })
    .maybeSingle()
  if (error) throw databaseError('authorize myhonor notification', error)
  const row = record(data, 'authorize myhonor notification')
  return {
    authorized: row.authorized === true,
    reason: requiredString(row.reason, 'reason'),
  }
}

export async function finishMyHonorOrderNotification(
  input: {
    notificationId: string
    leaseToken: string
    ownerToken: string
    outcome: 'accepted' | 'failed' | 'delivery_unknown'
    providerMessageId?: string | null
    errorCode?: string | null
    retryable?: boolean
    retryAfterSeconds?: number
  },
  client: SupabaseClient = createServiceClient(),
): Promise<FinishedMyHonorNotification> {
  const { data, error } = await client
    .rpc('finish_myhonor_order_notification', {
      p_notification_id: input.notificationId,
      p_lease_token: input.leaseToken,
      p_owner_token: input.ownerToken,
      p_outcome: input.outcome,
      p_provider_message_id: input.providerMessageId ?? null,
      p_error_code: input.errorCode ?? null,
      p_retryable: input.retryable ?? false,
      p_retry_after_seconds: input.retryAfterSeconds ?? 15,
    })
    .maybeSingle()
  if (error) throw databaseError('finish myhonor notification', error)
  const row = record(data, 'finish myhonor notification')
  return {
    accepted: row.accepted === true,
    state: row.notification_state === null
      ? null
      : state(row.notification_state),
    runAt: nullableTimestamp(row.next_run_at, 'next_run_at'),
  }
}

export async function applyMyHonorOrderNotificationDeliveryStatus(
  input: {
    providerMessageId: string
    status: 'sent' | 'delivered' | 'read' | 'failed'
    occurredAt: string | null
    errorCode?: string | null
  },
  client: SupabaseClient = createServiceClient(),
): Promise<AppliedMyHonorDeliveryStatus> {
  const { data, error } = await client
    .rpc('apply_myhonor_order_notification_delivery_status', {
      p_provider_message_id: input.providerMessageId,
      p_status: input.status,
      p_occurred_at: input.occurredAt,
      p_error_code: input.errorCode ?? null,
    })
    .maybeSingle()
  if (error) throw databaseError('apply myhonor delivery status', error)
  const row = record(data, 'apply myhonor delivery status')
  return {
    matched: row.matched === true,
    notificationId: row.notification_id === null
      ? null
      : requiredUuid(row.notification_id, 'notification_id'),
    state: row.notification_state === null
      ? null
      : state(row.notification_state),
  }
}
