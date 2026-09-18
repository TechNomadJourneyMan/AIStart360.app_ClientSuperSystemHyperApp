import { start } from 'workflow/api'
import { listImportedWhatsAppHistoryForDraft } from '@/lib/omnichannel/repository'
import { processOmnichannelMessageWorkflow } from '@/workflows/process-omnichannel-message'

export const WHATSAPP_HISTORY_WORKFLOW_LIMIT = 100

export interface WhatsAppBackfillWorkflowInput {
  requestedBy: string
  requestedAt: string
}

async function loadImportedWhatsAppHistoryStep() {
  'use step'

  return listImportedWhatsAppHistoryForDraft(WHATSAPP_HISTORY_WORKFLOW_LIMIT)
}

loadImportedWhatsAppHistoryStep.maxRetries = 3

async function startWhatsAppHistoryDraftStep(
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

startWhatsAppHistoryDraftStep.maxRetries = 3

/**
 * Starts draft-only analysis for the bounded history already ingested by the
 * WhatsApp Web QR bridge. It never calls a provider history or send endpoint.
 */
export async function backfillWhatsAppHistoryWorkflow(
  input: WhatsAppBackfillWorkflowInput,
) {
  'use workflow'

  const candidates = await loadImportedWhatsAppHistoryStep()
  for (const candidate of candidates) {
    await startWhatsAppHistoryDraftStep(
      candidate.messageId,
      candidate.conversationId,
    )
  }

  return {
    requested_by: input.requestedBy,
    requested_at: input.requestedAt,
    source: 'already_ingested_whatsapp_web_history' as const,
    candidates_found: candidates.length,
    drafts_queued: candidates.length,
    force_draft: true as const,
    cloud_api_history_fetched: false as const,
  }
}
