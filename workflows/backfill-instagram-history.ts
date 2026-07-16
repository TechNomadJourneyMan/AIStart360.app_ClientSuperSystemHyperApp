import { start } from 'workflow/api'
import {
  backfillInstagramConversations,
  type InstagramBackfillSuccess,
} from '@/lib/omnichannel/instagram-backfill'
import {
  ingestNormalizedMessage,
  listOmnichannelExternalMessageIds,
} from '@/lib/omnichannel/repository'
import type { NormalizedOmnichannelMessage } from '@/lib/omnichannel/types'
import { processOmnichannelMessageWorkflow } from '@/workflows/process-omnichannel-message'

export const MAX_INSTAGRAM_BACKFILL_BATCHES = 25

export interface InstagramBackfillWorkflowInput {
  requestedBy: string
  requestedAt: string
}

export interface InstagramBackfillWorkflowResult {
  requested_by: string
  requested_at: string
  batches_completed: number
  conversations_scanned: number
  messages_fetched: number
  inserted: number
  duplicates: number
  outbound: number
  drafts_queued: number
  partial_errors: string[]
  truncated: boolean
  stopped_reason: 'complete' | 'no_progress' | 'cursor_repeat' | 'batch_limit'
}

async function fetchInstagramBackfillBatchStep(
  conversationPage: string | null,
): Promise<InstagramBackfillSuccess> {
  'use step'

  const existingMessageIds = await listOmnichannelExternalMessageIds('instagram')
  const result = await backfillInstagramConversations({
    excludeMessageIds: existingMessageIds,
    ...(conversationPage ? { conversationPage } : {}),
  })
  if (!result.ok) throw new Error(result.error)
  return result
}

async function persistInstagramBackfillMessageStep(
  message: NormalizedOmnichannelMessage,
) {
  'use step'

  return ingestNormalizedMessage(message)
}

// Meta reads and database writes are idempotent. Retrying their individual
// steps cannot create duplicate provider messages or conversations.
fetchInstagramBackfillBatchStep.maxRetries = 3
persistInstagramBackfillMessageStep.maxRetries = 3

async function startInstagramHistoryDraftStep(
  messageId: string,
  conversationId: string,
): Promise<string> {
  'use step'

  const run = await start(processOmnichannelMessageWorkflow, [{
    message_id: messageId,
    conversation_id: conversationId,
    force_draft: true,
  }])
  return run.runId
}

startInstagramHistoryDraftStep.maxRetries = 3

/**
 * Durable, bounded Instagram history import for installations that use Vercel
 * Workflow instead of Inngest. Every imported inbound row is handed to its own
 * durable processor with force_draft=true, so backfill can never send replies.
 */
export async function backfillInstagramHistoryWorkflow(
  input: InstagramBackfillWorkflowInput,
): Promise<InstagramBackfillWorkflowResult> {
  'use workflow'

  let conversationsScanned = 0
  let messagesFetched = 0
  let inserted = 0
  let duplicates = 0
  let outbound = 0
  let draftsQueued = 0
  let batchesCompleted = 0
  let truncated = false
  let stoppedReason: InstagramBackfillWorkflowResult['stopped_reason'] = 'complete'
  let conversationPage: string | null = null
  const completedConversationPages = new Set<string>()
  const partialErrors: string[] = []
  const latestUnansweredByConversation = new Map<
    string,
    { messageId: string; conversationId: string }
  >()

  for (let batch = 0; batch < MAX_INSTAGRAM_BACKFILL_BATCHES; batch += 1) {
    const result: InstagramBackfillSuccess = await fetchInstagramBackfillBatchStep(
      conversationPage,
    )
    batchesCompleted += 1
    conversationsScanned += result.conversationsScanned
    messagesFetched += result.messagesFetched
    partialErrors.push(...result.partialErrors)
    for (const message of result.messages) {
      const persisted = await persistInstagramBackfillMessageStep(message)
      if (persisted.duplicate) duplicates += 1
      else inserted += 1

      if (message.direction === 'out') {
        outbound += 1
        // Import is chronological. A later provider-confirmed outbound closes
        // every earlier inbound candidate in this conversation.
        latestUnansweredByConversation.delete(persisted.conversationId)
        continue
      }
      // A step may have committed the insert immediately before its durable
      // result was interrupted. The retry then observes a duplicate imported
      // row; shouldQueue recovers that exact crash window. Terminal duplicates
      // remain skipped, so repeated admin requests stay idempotent.
      if (persisted.duplicate && !persisted.shouldQueue) {
        latestUnansweredByConversation.delete(persisted.conversationId)
        continue
      }

      // A burst gets one draft based on its latest inbound after the complete
      // batch has been persisted. Children never analyse a half-imported chat.
      latestUnansweredByConversation.set(persisted.conversationId, {
        messageId: persisted.messageId,
        conversationId: persisted.conversationId,
      })
    }

    truncated = result.truncated
    if (!result.truncated) {
      stoppedReason = 'complete'
      break
    }

    const currentPage = result.conversationPage
    const nextPage: string | null = result.nextConversationPage
    if (!nextPage) {
      stoppedReason = 'no_progress'
      break
    }

    if (nextPage !== currentPage) {
      completedConversationPages.add(currentPage)
      if (completedConversationPages.has(nextPage)) {
        stoppedReason = 'cursor_repeat'
        break
      }
    } else if (result.messages.length === 0) {
      // Re-reading the current page is valid while exclusion IDs drain more
      // than 20 details, but only an inserted/duplicate message is progress.
      stoppedReason = 'no_progress'
      break
    }

    conversationPage = nextPage

    if (batch === MAX_INSTAGRAM_BACKFILL_BATCHES - 1) {
      stoppedReason = 'batch_limit'
    }
  }

  // Start children only after every accessible batch has been persisted. This
  // prevents a draft from racing a later page that contains the business's
  // already-sent answer for the same conversation.
  for (const candidate of latestUnansweredByConversation.values()) {
    await startInstagramHistoryDraftStep(
      candidate.messageId,
      candidate.conversationId,
    )
    draftsQueued += 1
  }

  return {
    requested_by: input.requestedBy,
    requested_at: input.requestedAt,
    batches_completed: batchesCompleted,
    conversations_scanned: conversationsScanned,
    messages_fetched: messagesFetched,
    inserted,
    duplicates,
    outbound,
    drafts_queued: draftsQueued,
    partial_errors: partialErrors,
    truncated,
    stopped_reason: stoppedReason,
  }
}
