export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { ingestMyHonorMarketingContactEvent } from '@/lib/integrations/myhonor/reactivation/repository'
import {
  getMyHonorReactivationConfiguration,
  isAuthorizedMyHonorReactivationBearer,
  MYHONOR_OPAQUE_ID_PATTERN,
  myHonorMarketingContactEventHash,
  myHonorMarketingContactEventSchema,
  normalizeMyHonorMarketingContactEvent,
} from '@/lib/integrations/myhonor/reactivation/types'

const MAX_BODY_BYTES = 32_768
const SOURCE_VERSION_PATTERN = /^[1-9][0-9]{0,15}$/

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const configuration = getMyHonorReactivationConfiguration()
  if (configuration.apiKeys.length === 0) {
    return errorResponse(
      503,
      'integration_not_configured',
      'MyHonor reactivation integration is not configured',
      true,
    )
  }
  if (!isAuthorizedMyHonorReactivationBearer(
    req.headers.get('authorization'),
    configuration.apiKeys,
  )) {
    return errorResponse(401, 'unauthorized', 'Invalid integration credentials')
  }
  if (!configuration.ingestReady) {
    return errorResponse(
      503,
      'contact_store_not_ready',
      'The secure marketing-contact store is not configured',
      true,
      { missing: configuration.missingForIngest },
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
  if (!MYHONOR_OPAQUE_ID_PATTERN.test(idempotencyKey)) {
    return errorResponse(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must be an opaque MyHonor UUID or digest identifier',
    )
  }
  const sourceVersionHeader = req.headers.get('x-myhonor-source-version')?.trim() ?? ''
  const sourceVersion = Number(sourceVersionHeader)
  if (
    !SOURCE_VERSION_PATTERN.test(sourceVersionHeader)
    || !Number.isSafeInteger(sourceVersion)
    || sourceVersion <= 0
  ) {
    return errorResponse(
      400,
      'invalid_source_version',
      'X-MyHonor-Source-Version must be a positive safe integer',
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

  const parsed = myHonorMarketingContactEventSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      422,
      'invalid_request',
      'Request body does not match the marketing-contact contract',
      false,
      {
        fields: parsed.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    )
  }

  const event = normalizeMyHonorMarketingContactEvent(parsed.data)
  if (event.event_id !== idempotencyKey) {
    return errorResponse(
      409,
      'idempotency_event_mismatch',
      'Idempotency-Key must equal event_id',
    )
  }
  if (event.source_version !== sourceVersion) {
    return errorResponse(
      409,
      'source_version_mismatch',
      'X-MyHonor-Source-Version must equal source_version',
    )
  }

  let stored: {
    id: string | null
    eventId: string
    created: boolean
    duplicate: boolean
    conflict: boolean
  }
  try {
    stored = await ingestMyHonorMarketingContactEvent({
      event,
      idempotencyKey,
      requestHash: myHonorMarketingContactEventHash(event),
      configuration,
    })
  } catch {
    // Deliberately do not log the exception: database/provider errors can carry
    // encrypted-contact metadata and this endpoint must never emit contact PII.
    return errorResponse(
      503,
      'contact_store_unavailable',
      'Marketing-contact event could not be persisted',
      true,
    )
  }

  if (stored.conflict) {
    return errorResponse(
      409,
      'idempotency_conflict',
      'Idempotency-Key was already used with a different request body',
    )
  }
  if (!stored.id) {
    return errorResponse(
      503,
      'contact_store_invalid_result',
      'Marketing-contact event could not be confirmed',
      true,
    )
  }

  return json({
    ok: true,
    contact_event_id: stored.id,
    event_id: stored.eventId,
    duplicate: stored.duplicate,
  }, stored.duplicate ? 200 : 202)
}
