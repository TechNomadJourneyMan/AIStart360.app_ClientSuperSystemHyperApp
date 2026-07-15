export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { createHash, timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { inngest } from '@/lib/inngest'
import { OMNICHANNEL_MESSAGE_RECEIVED_EVENT } from '@/lib/omnichannel/events'
import {
  parseMetaWebhook,
  verifyMetaWebhookSignature,
} from '@/lib/omnichannel/meta-webhook'
import {
  applyWhatsAppDeliveryStatus,
  ingestNormalizedMessage,
  recordWebhookEvent,
  transitionWebhookEvent,
} from '@/lib/omnichannel/repository'

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function genericResponse(status = 200): NextResponse {
  return NextResponse.json({ ok: status >= 200 && status < 300 }, { status })
}

async function markAuditFailed(eventId: string, errorCode: string): Promise<void> {
  try {
    // Store a stable internal code only. Provider errors and request data may
    // contain customer content and must never be copied into the audit row.
    await transitionWebhookEvent(eventId, 'failed', errorCode)
  } catch {
    // Meta will retry because the route returns 500. Avoid logging request or
    // credential-adjacent data if even the best-effort audit update fails.
  }
}

/** Meta webhook endpoint verification (Instagram and WhatsApp). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const configuredToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (!configuredToken) return genericResponse(503)

  const params = new URL(req.url).searchParams
  const mode = params.get('hub.mode')
  const suppliedToken = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (
    mode !== 'subscribe'
    || !suppliedToken
    || challenge === null
    || !constantTimeEqual(configuredToken, suppliedToken)
  ) {
    return genericResponse(403)
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Receive signed Meta webhook deliveries.
 *
 * Signature verification happens against the exact bytes before JSON parsing
 * and before any database or queue side effect. The raw payload is never
 * logged or persisted; the audit table receives only its SHA-256 digest and
 * small non-sensitive counters.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) return genericResponse(503)

  const maxBodyBytes = 1_000_000
  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return genericResponse(413)
  }

  let rawBody: Buffer
  try {
    rawBody = Buffer.from(await req.arrayBuffer())
  } catch {
    return genericResponse(400)
  }
  if (rawBody.byteLength > maxBodyBytes) return genericResponse(413)

  if (!verifyMetaWebhookSignature(
    rawBody,
    req.headers.get('x-hub-signature-256'),
    appSecret,
  )) {
    return genericResponse(401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as unknown
  } catch {
    return genericResponse(400)
  }

  const events = parseMetaWebhook(payload)
  // Meta may send subscribed fields that this service intentionally does not
  // handle. A valid signed delivery must still be acknowledged to stop retries.
  if (events.length === 0) return genericResponse()

  const channel = events[0].channel
  const eventTypes = [...new Set(events.map((event) => event.eventType))]
  const accountIds = [...new Set(events.map((event) => event.accountExternalId))]
  const eventHash = createHash('sha256').update(rawBody).digest('hex')
  let auditId: string | null = null

  try {
    const audit = await recordWebhookEvent({
      channel,
      eventHash,
      eventType: eventTypes.length === 1 ? eventTypes[0] : 'mixed',
      accountExternalId: accountIds.length === 1 ? accountIds[0] : null,
      metadata: { eventCount: events.length },
    })
    auditId = audit.id

    const queuedMessages: Array<{ messageId: string; conversationId: string }> = []

    for (const event of events) {
      if (event.eventType === 'status') {
        await applyWhatsAppDeliveryStatus(event)
        continue
      }

      const result = await ingestNormalizedMessage(event)
      if (event.direction === 'in' && result.shouldQueue) {
        queuedMessages.push({
          messageId: result.messageId,
          conversationId: result.conversationId,
        })
      }
    }

    for (const message of queuedMessages) {
      try {
        await inngest.send({
          // A deterministic event id makes a lost HTTP response safe: Meta's
          // retry can recover a `received` row without double-running the AI.
          id: `omnichannel-message-${message.messageId}`,
          name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
          data: {
            message_id: message.messageId,
            conversation_id: message.conversationId,
            force_draft: false,
          },
        })
      } catch {
        await markAuditFailed(audit.id, 'inngest_enqueue_failed')
        return genericResponse(500)
      }
    }

    // "processed" here means the webhook delivery was durably ingested and
    // any asynchronous work was accepted by Inngest; it does not claim that
    // the later AI run has already completed.
    await transitionWebhookEvent(audit.id, 'processed')
    return genericResponse()
  } catch {
    if (auditId) await markAuditFailed(auditId, 'webhook_processing_failed')
    return genericResponse(500)
  }
}
