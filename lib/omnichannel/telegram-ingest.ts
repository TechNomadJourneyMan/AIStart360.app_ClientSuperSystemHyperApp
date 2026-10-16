/**
 * Persist one Telegram message into the unified inbox and hand it to the
 * SAME processing path as WhatsApp/Instagram: audit row (replay guard by
 * update id) → idempotent message upsert (dedupe by provider message id) →
 * leased claim → enqueue on the configured backend (database job queue,
 * Vercel Workflow or Inngest). No AI work and no Bot API calls happen here;
 * the webhook stays a short write + enqueue.
 */
import { waitUntil } from '@vercel/functions'
import { OMNICHANNEL_MESSAGE_RECEIVED_EVENT } from './events'
import { shouldUseOmnichannelPostgres } from './postgres-runtime'
import type {
  IngestNormalizedMessageResult,
  RecordedWebhookEvent,
  RecordWebhookEventInput,
} from './repository'
import type { NormalizedOmnichannelMessage, OmnichannelWebhookEventStatus } from './types'
import { telegramUpdateEventHash, type ParsedTelegramInboxUpdate } from './telegram-webhook'

const MAX_FAST_PATH_DELAY_MS = 30_000

export interface TelegramIngestPersistence {
  recordWebhookEvent(input: RecordWebhookEventInput): Promise<RecordedWebhookEvent>
  claimWebhookEventForProcessing(eventId: string): Promise<boolean>
  transitionWebhookEvent(
    eventId: string,
    status: OmnichannelWebhookEventStatus,
    errorMessage?: string | null,
  ): Promise<void>
  ingestNormalizedMessage(message: NormalizedOmnichannelMessage): Promise<IngestNormalizedMessageResult>
}

export interface TelegramIngestQueue {
  enqueue(input: { messageId: string; conversationId: string }): Promise<void>
}

export type TelegramIngestOutcome =
  /** Stored (and queued when new); acknowledge. */
  | 'processed'
  /** This update was already handled; acknowledge. */
  | 'duplicate'
  /** Another delivery of the same update holds the lease; ask Telegram to retry. */
  | 'in_flight'

export interface TelegramIngestResult {
  outcome: TelegramIngestOutcome
  messageId?: string
  conversationId?: string
  queued?: boolean
}

async function defaultPersistence(): Promise<TelegramIngestPersistence> {
  if (shouldUseOmnichannelPostgres()) return import('./postgres-ingest')
  const repository = await import('./repository')
  return {
    recordWebhookEvent: (input) => repository.recordWebhookEvent(input),
    claimWebhookEventForProcessing: (id) => repository.claimWebhookEventForProcessing(id),
    transitionWebhookEvent: (id, status, error) => repository.transitionWebhookEvent(id, status, error ?? null),
    ingestNormalizedMessage: (message) => repository.ingestNormalizedMessage(message),
  }
}

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '')
}

type ProcessingBackend = 'database' | 'workflow' | 'inngest' | 'inline'

function processingBackend(): ProcessingBackend {
  const configured = process.env.OMNICHANNEL_PROCESSING_BACKEND?.trim().toLowerCase()
  if (configured === 'database' || configured === 'workflow') return configured
  if (process.env.NODE_ENV === 'development' && enabled(process.env.OMNICHANNEL_INLINE_PROCESSING)) {
    return 'inline'
  }
  return 'inngest'
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Same best-effort low-latency drain as the Meta/WhatsApp webhooks. */
function scheduleDatabaseQueueFastPath(runAt: string): void {
  if (process.env.VERCEL !== '1') return
  const runAtMs = new Date(runAt).getTime()
  if (!Number.isFinite(runAtMs)) return
  const delayMs = Math.max(0, runAtMs - Date.now())
  if (delayMs > MAX_FAST_PATH_DELAY_MS) return
  const work = (async () => {
    if (delayMs > 0) await sleep(delayMs)
    const { drainOmnichannelProcessingJobs } = await import('./process-job-queue')
    await drainOmnichannelProcessingJobs({ limit: 1 })
  })().catch(() => {
    // The durable job stays queued and is recovered by a later drain.
  })
  try {
    waitUntil(work)
  } catch {
    // Outside Vercel the promise is already running.
  }
}

/** Enqueue on whichever backend the other inbox webhooks use. */
export const defaultTelegramIngestQueue: TelegramIngestQueue = {
  async enqueue({ messageId, conversationId }) {
    const backend = processingBackend()
    const data = { message_id: messageId, conversation_id: conversationId, force_draft: false }
    if (backend === 'database') {
      const { enqueueOmnichannelProcessingJob } = await import('./processing-jobs')
      const job = await enqueueOmnichannelProcessingJob({ messageId, forceDraft: false })
      scheduleDatabaseQueueFastPath(job.runAt)
      return
    }
    if (backend === 'workflow') {
      const [{ start }, { processOmnichannelMessageWorkflow }] = await Promise.all([
        import('workflow/api'),
        import('@/workflows/process-omnichannel-message'),
      ])
      await start(processOmnichannelMessageWorkflow, [data])
      return
    }
    if (backend === 'inline') {
      const { processOmnichannelMessageDirect } = await import('@/lib/functions/process-omnichannel-message')
      await processOmnichannelMessageDirect(data)
      return
    }
    const { inngest } = await import('@/lib/inngest')
    await inngest.send({
      id: `omnichannel-message-${messageId}`,
      name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
      data,
    })
  },
}

function isOwnedDuplicate(audit: RecordedWebhookEvent): boolean {
  return audit.duplicate && ['queued', 'processed', 'ignored'].includes(audit.status)
}

export async function ingestTelegramInboxUpdate(
  parsed: ParsedTelegramInboxUpdate,
  deps: { persistence?: TelegramIngestPersistence; queue?: TelegramIngestQueue } = {},
): Promise<TelegramIngestResult> {
  const store = deps.persistence ?? (await defaultPersistence())
  const queue = deps.queue ?? defaultTelegramIngestQueue
  const message = parsed.message
  let auditId: string | null = null
  let auditClaimed = false
  try {
    const audit = await store.recordWebhookEvent({
      channel: 'telegram',
      eventHash: telegramUpdateEventHash(message.accountExternalId, parsed.updateId),
      eventType: parsed.edited ? 'tg_edited_message' : 'tg_message',
      accountExternalId: message.accountExternalId,
      metadata: {
        eventCount: 1,
        transport: String(message.metadata.transport ?? 'telegram_bot'),
        ...(parsed.edited ? { edited: true } : {}),
      },
    })
    auditId = audit.id
    if (isOwnedDuplicate(audit)) return { outcome: 'duplicate' }

    const ingested = await store.ingestNormalizedMessage(message)
    const claimed = await store.claimWebhookEventForProcessing(audit.id)
    if (!claimed) return { outcome: 'in_flight' }
    auditClaimed = true

    if (ingested.shouldQueue) {
      try {
        await queue.enqueue({ messageId: ingested.messageId, conversationId: ingested.conversationId })
      } catch (error) {
        try {
          await store.transitionWebhookEvent(audit.id, 'failed', 'queue_enqueue_failed')
        } catch {
          // The retry of the update will recover the received row.
        }
        auditClaimed = false
        throw error
      }
    }
    await store.transitionWebhookEvent(audit.id, 'processed')
    return {
      outcome: ingested.duplicate ? 'duplicate' : 'processed',
      messageId: ingested.messageId,
      conversationId: ingested.conversationId,
      queued: ingested.shouldQueue,
    }
  } catch (error) {
    if (auditId && auditClaimed) {
      try {
        await store.transitionWebhookEvent(auditId, 'failed', 'webhook_processing_failed')
      } catch {
        // Keep the original error.
      }
    }
    throw error
  }
}
