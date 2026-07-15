import { beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  ingest: vi.fn(),
  listExternalIds: vi.fn(),
  listWhatsAppHistory: vi.fn(),
}))
const instagram = vi.hoisted(() => ({ backfill: vi.fn() }))

vi.mock('@/lib/omnichannel/repository', () => ({
  ingestNormalizedMessage: repository.ingest,
  listOmnichannelExternalMessageIds: repository.listExternalIds,
  listImportedWhatsAppHistoryForDraft: repository.listWhatsAppHistory,
}))
vi.mock('@/lib/omnichannel/instagram-backfill', () => ({
  backfillInstagramConversations: instagram.backfill,
}))

import { backfillOmnichannel } from '@/lib/functions/backfill-omnichannel'

function stepHarness() {
  return {
    run: vi.fn(async (_name: string, action: () => unknown) => action()),
    sendEvent: vi.fn(async () => undefined),
  }
}

async function invoke(channel: 'instagram' | 'whatsapp', step = stepHarness()) {
  const handler = (backfillOmnichannel as unknown as {
    fn: (input: unknown) => Promise<unknown>
  }).fn
  return handler({
    event: {
      data: {
        channel,
        requested_by: 'admin-1',
        requested_at: '2026-07-15T00:00:00.000Z',
      },
    },
    step,
  })
}

describe('omnichannel history analysis backfill', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('queues only already-imported WhatsApp history with stable force-draft events', async () => {
    repository.listWhatsAppHistory.mockResolvedValue([
      { messageId: 'history-1', conversationId: 'conversation-1' },
      { messageId: 'history-2', conversationId: 'conversation-1' },
    ])
    const step = stepHarness()

    await expect(invoke('whatsapp', step)).resolves.toMatchObject({
      source: 'already_ingested_whatsapp_web_history',
      candidates_found: 2,
      drafts_queued: 2,
      limit: 100,
      cloud_api_history_fetched: false,
    })

    expect(repository.listWhatsAppHistory).toHaveBeenCalledWith(100)
    expect(instagram.backfill).not.toHaveBeenCalled()
    expect(step.sendEvent).toHaveBeenCalledWith(
      'enqueue-imported-whatsapp-web-history',
      [
        {
          name: 'omnichannel/message.received',
          id: 'omnichannel-history-draft-history-1',
          data: {
            message_id: 'history-1',
            conversation_id: 'conversation-1',
            force_draft: true,
          },
        },
        {
          name: 'omnichannel/message.received',
          id: 'omnichannel-history-draft-history-2',
          data: {
            message_id: 'history-2',
            conversation_id: 'conversation-1',
            force_draft: true,
          },
        },
      ],
    )
  })

  it('does not emit empty batches', async () => {
    repository.listWhatsAppHistory.mockResolvedValue([])
    const step = stepHarness()

    await expect(invoke('whatsapp', step)).resolves.toMatchObject({
      candidates_found: 0,
      drafts_queued: 0,
    })
    expect(step.sendEvent).not.toHaveBeenCalled()
  })
})
