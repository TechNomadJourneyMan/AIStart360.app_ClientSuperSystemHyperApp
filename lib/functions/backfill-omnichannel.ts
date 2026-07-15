import { inngest } from '@/lib/inngest'
import { backfillInstagramConversations } from '@/lib/omnichannel/instagram-backfill'
import {
  OMNICHANNEL_BACKFILL_REQUESTED_EVENT,
  OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
  type OmnichannelBackfillRequestedEventData,
} from '@/lib/omnichannel/events'
import {
  ingestNormalizedMessage,
  listImportedWhatsAppHistoryForDraft,
  listOmnichannelExternalMessageIds,
  type ImportedWhatsAppHistoryCandidate,
} from '@/lib/omnichannel/repository'

const WHATSAPP_HISTORY_ANALYSIS_LIMIT = 100

type DraftEvent = {
  name: typeof OMNICHANNEL_MESSAGE_RECEIVED_EVENT
  id: string
  data: { message_id: string; conversation_id: string; force_draft: true }
}

export const backfillOmnichannel = inngest.createFunction(
  {
    id: 'backfill-omnichannel',
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ event: OMNICHANNEL_BACKFILL_REQUESTED_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event, step }: any) => {
    const data = event.data as OmnichannelBackfillRequestedEventData
    if (!data || !['instagram', 'whatsapp'].includes(data.channel)) {
      return { skipped: true, reason: 'unsupported_backfill_channel' }
    }

    if (data.channel === 'whatsapp') {
      const candidates: ImportedWhatsAppHistoryCandidate[] = await step.run(
        'load-imported-whatsapp-web-history',
        () => listImportedWhatsAppHistoryForDraft(WHATSAPP_HISTORY_ANALYSIS_LIMIT),
      )
      const queued: DraftEvent[] = candidates.map((candidate) => ({
        name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
        // Stable IDs make repeated button presses safe while the first batch
        // is still waiting in Inngest. The processor also re-checks status.
        id: `omnichannel-history-draft-${candidate.messageId}`,
        data: {
          message_id: candidate.messageId,
          conversation_id: candidate.conversationId,
          force_draft: true,
        },
      }))
      if (queued.length > 0) {
        await step.sendEvent('enqueue-imported-whatsapp-web-history', queued)
      }
      return {
        requested_by: data.requested_by,
        source: 'already_ingested_whatsapp_web_history',
        candidates_found: candidates.length,
        drafts_queued: queued.length,
        limit: WHATSAPP_HISTORY_ANALYSIS_LIMIT,
        // Cloud API still has no arbitrary-history endpoint. These rows were
        // already received through the separately running QR bridge.
        cloud_api_history_fetched: false,
      }
    }

    const existingMessageIds = await step.run('load-imported-instagram-message-ids', () =>
      listOmnichannelExternalMessageIds('instagram'),
    )
    const result = await step.run('fetch-bounded-instagram-history', () =>
      backfillInstagramConversations({ excludeMessageIds: existingMessageIds }),
    )
    if (!result.ok) throw new Error(result.error)

    const queued: DraftEvent[] = []
    let inserted = 0
    let duplicates = 0
    let outbound = 0

    for (const [index, message] of result.messages.entries()) {
      const persisted = await step.run(`persist-imported-message-${index + 1}`, () =>
        ingestNormalizedMessage(message),
      )
      if (persisted.duplicate) duplicates += 1
      else inserted += 1

      if (message.direction === 'out') {
        outbound += 1
      } else if (!persisted.duplicate) {
        queued.push({
          name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
          id: `omnichannel-backfill-${persisted.messageId}`,
          data: {
            message_id: persisted.messageId,
            conversation_id: persisted.conversationId,
            force_draft: true,
          },
        })
      }
    }

    if (queued.length > 0) {
      await step.sendEvent('enqueue-imported-inbound-messages', queued)
    }

    const batch = Math.max(0, Number(data.batch ?? 0))
    const continuationQueued = result.truncated && result.messagesFetched > 0 && batch < 24
    if (continuationQueued) {
      await step.sendEvent('continue-instagram-history-import', {
        name: OMNICHANNEL_BACKFILL_REQUESTED_EVENT,
        data: {
          ...data,
          batch: batch + 1,
        },
      })
    }

    return {
      requested_by: data.requested_by,
      conversations_scanned: result.conversationsScanned,
      messages_fetched: result.messagesFetched,
      inserted,
      duplicates,
      outbound,
      drafts_queued: queued.length,
      truncated: result.truncated,
      partial_errors: result.partialErrors,
      batch,
      continuation_queued: continuationQueued,
    }
  },
)
