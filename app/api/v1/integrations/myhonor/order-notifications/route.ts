export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import {
  enqueueMyHonorOrderNotification,
  type MyHonorNotificationState,
} from '@/lib/integrations/myhonor/order-notification-repository'
import {
  getMyHonorOrderNotificationConfiguration,
  isAuthorizedMyHonorBearer,
  myHonorOrderNotificationRequestHash,
  myHonorOrderNotificationSchema,
  normalizeMyHonorOrderNotification,
} from '@/lib/integrations/myhonor/order-notifications'
import { processMyHonorOrderNotificationWorkflow } from '@/workflows/process-myhonor-order-notification'

const MAX_BODY_BYTES = 16_384
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/

function json(body: unknown, status: number, headers: HeadersInit = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): NextResponse {
  return json({
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(details ? { details } : {}),
    },
  }, status, retryable ? { 'Retry-After': '5' } : {})
}

function isInProgress(state: MyHonorNotificationState): boolean {
  return state === 'queued' || state === 'leased' || state === 'authorized'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const configuration = getMyHonorOrderNotificationConfiguration()
  if (configuration.apiKeys.length === 0) {
    return errorResponse(
      503,
      'integration_not_configured',
      'MyHonor order notification integration is not configured',
      true,
    )
  }
  if (!isAuthorizedMyHonorBearer(
    req.headers.get('authorization'),
    configuration.apiKeys,
  )) {
    return errorResponse(401, 'unauthorized', 'Invalid integration credentials')
  }
  if (!configuration.ready) {
    return errorResponse(
      503,
      'provider_not_ready',
      'WhatsApp utility-template provider is not configured',
      true,
      { missing: configuration.missing },
    )
  }

  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return errorResponse(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json',
    )
  }
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'payload_too_large', 'Request body is too large')
  }

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return errorResponse(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must contain 8-200 safe characters',
    )
  }

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body is not valid JSON')
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return errorResponse(413, 'payload_too_large', 'Request body is too large')
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody) as unknown
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body is not valid JSON')
  }
  const parsed = myHonorOrderNotificationSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      422,
      'invalid_request',
      'Request body does not match the order notification contract',
      false,
      {
        fields: parsed.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    )
  }

  const notification = normalizeMyHonorOrderNotification(parsed.data)
  if (notification.event_id !== idempotencyKey) {
    return errorResponse(
      409,
      'idempotency_event_mismatch',
      'Idempotency-Key must equal event_id',
    )
  }
  if (configuration.templateLanguage !== notification.locale) {
    return errorResponse(
      422,
      'unsupported_locale',
      'No approved WhatsApp template is configured for this locale',
    )
  }

  let queued
  try {
    queued = await enqueueMyHonorOrderNotification({
      notification,
      idempotencyKey,
      requestHash: myHonorOrderNotificationRequestHash(notification),
    })
  } catch {
    return errorResponse(
      503,
      'notification_store_unavailable',
      'Order notification could not be persisted',
      true,
    )
  }

  if (queued.conflict) {
    return errorResponse(
      409,
      'idempotency_conflict',
      'Idempotency-Key was already used with a different request body',
    )
  }

  if (queued.state === 'queued') {
    try {
      await start(processMyHonorOrderNotificationWorkflow, [{
        notification_id: queued.id,
      }])
    } catch {
      // Persistence is already the durability boundary. Returning a retryable
      // error makes the store repeat the same key; the duplicate route starts
      // another fenced workflow without creating another provider message.
      return errorResponse(
        503,
        'notification_dispatch_unavailable',
        'Order notification was persisted but its worker could not be started',
        true,
        { notification_id: queued.id, state: queued.state },
      )
    }

    return json({
      ok: true,
      notification_id: queued.id,
      event_id: notification.event_id,
      state: queued.state,
      duplicate: !queued.created,
    }, 202)
  }

  return json({
    ok: true,
    notification_id: queued.id,
    event_id: notification.event_id,
    state: queued.state,
    duplicate: !queued.created,
    ...(queued.providerMessageId
      ? { provider_message_id: queued.providerMessageId }
      : {}),
  }, isInProgress(queued.state) ? 202 : 200)
}
