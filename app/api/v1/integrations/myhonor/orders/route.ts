export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

import { NextRequest, NextResponse } from 'next/server'
import {
  getMyHonorAnalyticsConfiguration,
  myHonorOrderAnalyticsSchema,
  normalizeMyHonorOrderAnalytics,
  verifyMyHonorAnalyticsSignature,
} from '@/lib/integrations/myhonor/order-analytics'
import { ingestMyHonorOrderAnalytics } from '@/lib/integrations/myhonor/order-analytics-repository'

// Normalization adds bounded product metadata + hashes to every item before
// the database RPC. Keep the wire envelope below the RPC's JSONB ceiling and
// verify the normalized item payload again before persistence.
const MAX_BODY_BYTES = 160_000
const MAX_NORMALIZED_ITEMS_BYTES = 200_000

class BodyTooLargeError extends Error {}

function json(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): NextResponse {
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

async function readBoundedBody(request: NextRequest): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new BodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const configuration = getMyHonorAnalyticsConfiguration()
  if (
    !configuration.ready
    || !configuration.webhookSecret
    || !configuration.userId
    || !configuration.companyId
  ) {
    return errorResponse(
      503,
      'integration_not_configured',
      'MyHonor order analytics integration is not configured',
      true,
      { missing: configuration.missing },
    )
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return errorResponse(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json',
    )
  }

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (
      !Number.isSafeInteger(contentLength)
      || contentLength < 0
      || contentLength > MAX_BODY_BYTES
    ) {
      return errorResponse(
        contentLength > MAX_BODY_BYTES ? 413 : 400,
        contentLength > MAX_BODY_BYTES
          ? 'payload_too_large'
          : 'invalid_content_length',
        contentLength > MAX_BODY_BYTES
          ? 'Request body is too large'
          : 'Content-Length is invalid',
      )
    }
  }

  let rawBody: Uint8Array
  try {
    rawBody = await readBoundedBody(request)
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, 'payload_too_large', 'Request body is too large')
    }
    return errorResponse(400, 'invalid_body', 'Request body could not be read')
  }

  const signature = verifyMyHonorAnalyticsSignature({
    rawBody,
    timestampHeader: request.headers.get('x-aistart-timestamp'),
    signatureHeader: request.headers.get('x-aistart-signature'),
    secret: configuration.webhookSecret,
    replayWindowSeconds: configuration.replayWindowSeconds,
  })
  if (!signature.ok) {
    return errorResponse(
      401,
      signature.reason === 'stale_timestamp'
        ? 'stale_webhook_timestamp'
        : 'invalid_webhook_signature',
      'Webhook authentication failed',
    )
  }

  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
  } catch {
    return errorResponse(400, 'invalid_encoding', 'Request body must be UTF-8')
  }

  let body: unknown
  try {
    body = JSON.parse(decoded) as unknown
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body is not valid JSON')
  }
  const parsed = myHonorOrderAnalyticsSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      422,
      'invalid_request',
      'Request body does not match the MyHonor order analytics contract',
      false,
      {
        fields: parsed.error.issues.slice(0, 12).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    )
  }

  const analytics = normalizeMyHonorOrderAnalytics(parsed.data)
  if (
    Buffer.byteLength(JSON.stringify(analytics.order.items), 'utf8')
    > MAX_NORMALIZED_ITEMS_BYTES
  ) {
    return errorResponse(
      413,
      'normalized_payload_too_large',
      'Normalized order items exceed the analytics storage limit',
    )
  }

  let ingested
  try {
    ingested = await ingestMyHonorOrderAnalytics({
      analytics,
      binding: {
        userId: configuration.userId,
        companyId: configuration.companyId,
      },
    })
  } catch {
    return errorResponse(
      503,
      'analytics_store_unavailable',
      'Order analytics could not be persisted',
      true,
    )
  }

  const effectiveResult =
    ingested.result === 'duplicate'
      ? ingested.originalResult
      : ingested.result
  if (ingested.conflict || effectiveResult === 'conflict') {
    return errorResponse(
      409,
      'order_version_conflict',
      'The event conflicts with an existing order version',
      false,
      {
        event_id: parsed.data.event_id,
        stored_status_version: ingested.storedStatusVersion,
      },
    )
  }

  return json({
    ok: true,
    event_id: parsed.data.event_id,
    order_id: ingested.orderId,
    result: ingested.result,
    original_result: ingested.originalResult,
    applied: ingested.applied,
    duplicate:
      ingested.result === 'duplicate'
      || ingested.result === 'duplicate_version',
    ignored: effectiveResult === 'out_of_order',
    stored_status_version: ingested.storedStatusVersion,
  }, ingested.applied && ingested.created ? 201 : 200)
}
