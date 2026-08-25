export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The database fast path may wait for the configured human-like reply delay
// and then run two bounded model attempts. Its durable job remains recoverable
// if the serverless invocation still ends before completion.
export const maxDuration = 300

import { createHash, timingSafeEqual } from 'crypto'
import { waitUntil } from '@vercel/functions'
import { NextResponse, type NextRequest } from 'next/server'
import { start } from 'workflow/api'
import { applyMyHonorOrderNotificationDeliveryStatus } from '@/lib/integrations/myhonor/order-notification-repository'
import {
  applyMyHonorReactivationDeliveryStatus,
  applyMyHonorReactivationInboundSignal,
} from '@/lib/integrations/myhonor/reactivation/webhook-signals'
import { recordMyHonorReactivationInboundContext } from '@/lib/integrations/myhonor/reactivation/outbound-context'
import { inngest } from '@/lib/inngest'
import { OMNICHANNEL_MESSAGE_RECEIVED_EVENT } from '@/lib/omnichannel/events'
import {
  parseMetaWebhook,
  verifyMetaWebhookSignature,
} from '@/lib/omnichannel/meta-webhook'
import { getConfiguredMetaAccountId } from '@/lib/omnichannel/meta-client'
import {
  applyWhatsAppDeliveryStatus,
  claimWebhookEventForProcessing,
  ingestNormalizedMessage,
  recordWebhookEvent,
  transitionWebhookEvent,
} from '@/lib/omnichannel/repository'
import type { RecordedWebhookEvent } from '@/lib/omnichannel/repository'
import { enqueueOmnichannelProcessingJob } from '@/lib/omnichannel/processing-jobs'
import { drainOmnichannelProcessingJobs } from '@/lib/omnichannel/process-job-queue'
import { processOmnichannelMessageWorkflow } from '@/workflows/process-omnichannel-message'

const MAX_FAST_PATH_DELAY_MS = 30_000

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function genericResponse(status = 200): NextResponse {
  return NextResponse.json({ ok: status >= 200 && status < 300 }, { status })
}

function configuredSecret(value: string | undefined): string | null {
  const secret = value?.trim()
  return secret ? secret : null
}

function payloadObject(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const object = (value as { object?: unknown }).object
  return typeof object === 'string' ? object : null
}

function isOwnedDuplicate(audit: RecordedWebhookEvent): boolean {
  return audit.duplicate && ['queued', 'processed', 'ignored'].includes(audit.status)
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

type ProcessingBackend = 'database' | 'workflow' | 'inngest'

function processingBackend(): ProcessingBackend {
  const configured = process.env.OMNICHANNEL_PROCESSING_BACKEND?.trim().toLowerCase()
  if (configured === 'database' || configured === 'workflow') return configured
  return 'inngest'
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Best-effort low-latency serverless path. Enqueueing is the durability
 * boundary; a later invocation can recover the job if this work is stopped.
 */
function scheduleDatabaseQueueFastPath(runAt: string): void {
  if (process.env.VERCEL !== '1') return
  const runAtMs = new Date(runAt).getTime()
  if (!Number.isFinite(runAtMs)) return
  const delayMs = Math.max(0, runAtMs - Date.now())
  if (delayMs > MAX_FAST_PATH_DELAY_MS) return

  const work = (async () => {
    if (delayMs > 0) await sleep(delayMs)
    await drainOmnichannelProcessingJobs({ limit: 1 })
  })().catch(() => {
    // The durable job remains queued for recovery by a later invocation.
  })
  try {
    waitUntil(work)
  } catch {
    // The promise has already started in a local/non-Vercel runtime.
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
 * Signature verification happens against the exact bytes and before any
 * database or queue side effect. If Instagram uses a separate Meta app, its
 * dedicated secret is tried first and then enforced after a bounded JSON parse;
 * a WhatsApp payload can never authenticate with only the Instagram secret.
 * The raw payload is never logged or persisted; the audit table receives only
 * its SHA-256 digest and small non-sensitive counters.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const metaAppSecret = configuredSecret(process.env.META_APP_SECRET)
  const instagramAppSecret = configuredSecret(process.env.INSTAGRAM_APP_SECRET)
    ?? metaAppSecret
  if (!metaAppSecret && !instagramAppSecret) return genericResponse(503)
  const backend = processingBackend()

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

  const signature = req.headers.get('x-hub-signature-256')
  const matchesMetaSecret = Boolean(
    metaAppSecret
    && verifyMetaWebhookSignature(rawBody, signature, metaAppSecret),
  )
  const matchesInstagramSecret = Boolean(
    instagramAppSecret
    && verifyMetaWebhookSignature(rawBody, signature, instagramAppSecret),
  )
  if (!matchesMetaSecret && !matchesInstagramSecret) {
    return genericResponse(401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as unknown
  } catch {
    return genericResponse(400)
  }

  const object = payloadObject(payload)
  if (object === 'instagram') {
    if (!instagramAppSecret) return genericResponse(503)
    if (!matchesInstagramSecret) return genericResponse(401)
  } else {
    // WhatsApp and unsupported Meta objects use META_APP_SECRET. This avoids
    // cross-authentication when Instagram Login belongs to a separate app.
    if (!metaAppSecret) return genericResponse(503)
    if (!matchesMetaSecret) return genericResponse(401)
  }

  let events = parseMetaWebhook(payload)
  // Meta may send subscribed fields that this service intentionally does not
  // handle. A valid signed delivery must still be acknowledged to stop retries.
  if (events.length === 0) return genericResponse()

  const channel = events[0].channel
  const configuredAccountId = getConfiguredMetaAccountId(channel)
  if (!configuredAccountId) return genericResponse(503)

  // A Meta app can be subscribed to more than one business account. Accept
  // only the explicitly configured sender so an unrelated account's customer
  // content is never persisted in this tenant. Valid signed foreign deliveries
  // are acknowledged (not retried) without database side effects.
  events = events.filter(
    (event) => event.accountExternalId === configuredAccountId,
  )
  if (events.length === 0) return genericResponse()

  const eventTypes = [...new Set(events.map((event) => event.eventType))]
  const accountIds = [...new Set(events.map((event) => event.accountExternalId))]
  const eventHash = createHash('sha256').update(rawBody).digest('hex')
  let auditId: string | null = null
  let auditClaimed = false

  try {
    const audit = await recordWebhookEvent({
      channel,
      eventHash,
      eventType: eventTypes.length === 1 ? eventTypes[0] : 'mixed',
      accountExternalId: accountIds.length === 1 ? accountIds[0] : null,
      metadata: { eventCount: events.length },
    })
    auditId = audit.id
    if (isOwnedDuplicate(audit)) return genericResponse()

    const queuedMessages = new Map<
      string,
      { messageId: string; conversationId: string }
    >()

    for (const event of events) {
      if (event.eventType === 'status') {
        const transactional = await applyMyHonorOrderNotificationDeliveryStatus({
          providerMessageId: event.externalMessageId,
          status: event.status,
          occurredAt: event.occurredAt,
          errorCode: event.status === 'failed' ? 'meta.delivery_failed' : null,
        })
        if (transactional.matched) continue
        const reactivation = await applyMyHonorReactivationDeliveryStatus(event)
        if (reactivation.matched) continue
        await applyWhatsAppDeliveryStatus(event)
        continue
      }

      const result = await ingestNormalizedMessage(event)
      if (event.channel === 'whatsapp' && event.direction === 'in') {
        // Ingest is deliberately first: if the attribution/suppression RPC
        // fails, Meta retries this delivery while the message upsert remains
        // idempotent. The helper persists only HMAC/digest identifiers.
        const signal = await applyMyHonorReactivationInboundSignal(event)
        if (signal.attributedRecipientId && !signal.suppressed) {
          // Restore the accepted offer only after this inbound has established
          // the legacy inbox identity. Proactive-only contacts remain confined
          // to the encrypted reactivation ledger.
          await recordMyHonorReactivationInboundContext({
            event,
            recipientId: signal.attributedRecipientId,
          })
        }
      }
      if (event.direction === 'in' && result.shouldQueue) {
        queuedMessages.set(result.messageId, {
          messageId: result.messageId,
          conversationId: result.conversationId,
        })
      }
    }

    // The audit lease serializes concurrent retries of the same signed Meta
    // delivery. Message upserts remain the cross-delivery idempotency guard.
    const claimed = await claimWebhookEventForProcessing(audit.id)
    if (!claimed) return genericResponse(503)
    auditClaimed = true

    for (const message of queuedMessages.values()) {
      try {
        const eventData = {
          message_id: message.messageId,
          conversation_id: message.conversationId,
          force_draft: false,
        }
        if (backend === 'database') {
          const job = await enqueueOmnichannelProcessingJob({
            messageId: message.messageId,
            forceDraft: false,
          })
          scheduleDatabaseQueueFastPath(job.runAt)
        } else if (backend === 'workflow') {
          await start(processOmnichannelMessageWorkflow, [eventData])
        } else {
          await inngest.send({
            // A deterministic event id makes a lost HTTP response safe: Meta's
            // retry can recover a `received` row without double-running the AI.
            id: `omnichannel-message-${message.messageId}`,
            name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
            data: eventData,
          })
        }
      } catch {
        await markAuditFailed(
          audit.id,
          backend === 'database'
            ? 'database_queue_enqueue_failed'
            : backend === 'workflow'
              ? 'workflow_start_failed'
              : 'inngest_enqueue_failed',
        )
        return genericResponse(500)
      }
    }

    // "processed" here means the webhook delivery was durably ingested and
    // asynchronous work was accepted by the configured queue; it does not
    // claim that the later AI run has already completed.
    await transitionWebhookEvent(audit.id, 'processed')
    return genericResponse()
  } catch {
    if (auditId && auditClaimed) {
      await markAuditFailed(auditId, 'webhook_processing_failed')
    }
    return genericResponse(500)
  }
}
