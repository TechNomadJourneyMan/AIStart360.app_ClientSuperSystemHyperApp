import { beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({
  start: vi.fn(),
  listHistory: vi.fn(),
  processMessage: vi.fn(),
}))

vi.mock('workflow/api', () => ({ start: dependencies.start }))
vi.mock('@/lib/omnichannel/repository', () => ({
  listImportedWhatsAppHistoryForDraft: dependencies.listHistory,
}))
vi.mock('@/workflows/process-omnichannel-message', () => ({
  processOmnichannelMessageWorkflow: dependencies.processMessage,
}))

import { backfillWhatsAppHistoryWorkflow } from '@/workflows/backfill-whatsapp-history'

describe('WhatsApp history backfill Workflow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.start.mockResolvedValue({ runId: 'wrun-message' })
  })

  it('starts bounded draft-only child workflows for already imported QR history', async () => {
    dependencies.listHistory.mockResolvedValue([
      { messageId: 'message-1', conversationId: 'conversation-1' },
      { messageId: 'message-2', conversationId: 'conversation-2' },
    ])

    const result = await backfillWhatsAppHistoryWorkflow({
      requestedBy: 'admin-1',
      requestedAt: '2026-07-16T10:00:00.000Z',
    })

    expect(dependencies.listHistory).toHaveBeenCalledWith(100)
    expect(dependencies.start).toHaveBeenNthCalledWith(
      1,
      dependencies.processMessage,
      [{
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        force_draft: true,
      }],
    )
    expect(dependencies.start).toHaveBeenNthCalledWith(
      2,
      dependencies.processMessage,
      [{
        message_id: 'message-2',
        conversation_id: 'conversation-2',
        force_draft: true,
      }],
    )
    expect(result).toEqual({
      requested_by: 'admin-1',
      requested_at: '2026-07-16T10:00:00.000Z',
      source: 'already_ingested_whatsapp_web_history',
      candidates_found: 2,
      drafts_queued: 2,
      force_draft: true,
      cloud_api_history_fetched: false,
    })
  })
})
