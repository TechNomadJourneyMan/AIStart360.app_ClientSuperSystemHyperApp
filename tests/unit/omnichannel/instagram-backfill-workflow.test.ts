import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedOmnichannelMessage } from '@/lib/omnichannel/types'

const dependencies = vi.hoisted(() => ({
  start: vi.fn(),
  fetchBackfill: vi.fn(),
  listIds: vi.fn(),
  ingest: vi.fn(),
  processMessage: vi.fn(),
}))

vi.mock('workflow/api', () => ({ start: dependencies.start }))
vi.mock('@/lib/omnichannel/instagram-backfill', () => ({
  backfillInstagramConversations: dependencies.fetchBackfill,
}))
vi.mock('@/lib/omnichannel/repository', () => ({
  listOmnichannelExternalMessageIds: dependencies.listIds,
  ingestNormalizedMessage: dependencies.ingest,
}))
vi.mock('@/workflows/process-omnichannel-message', () => ({
  processOmnichannelMessageWorkflow: dependencies.processMessage,
}))

import { backfillInstagramHistoryWorkflow } from '@/workflows/backfill-instagram-history'

function message(
  externalMessageId: string,
  direction: 'in' | 'out',
): NormalizedOmnichannelMessage {
  return {
    eventType: 'message',
    channel: 'instagram',
    accountExternalId: 'ig-account',
    conversationExternalId: `contact-${externalMessageId}`,
    contactExternalId: `contact-${externalMessageId}`,
    contactName: null,
    externalMessageId,
    direction,
    messageType: 'text',
    text: `message-${externalMessageId}`,
    status: 'imported',
    replyToExternalId: null,
    occurredAt: '2026-07-16T10:00:00.000Z',
    metadata: { source: 'test' },
  }
}

describe('Instagram history backfill Workflow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.start.mockResolvedValue({ runId: 'wrun-message' })
    dependencies.ingest.mockImplementation(
      async (candidate: NormalizedOmnichannelMessage) => ({
        duplicate: false,
        messageId: `db-${candidate.externalMessageId}`,
        conversationId: `conversation-${candidate.externalMessageId}`,
        shouldQueue: true,
      }),
    )
  })

  it('passes the conversation cursor and continues beyond the first 25 conversations', async () => {
    const firstInbound = message('in-1', 'in')
    const firstOutbound = message('out-1', 'out')
    const secondInbound = message('in-2', 'in')
    dependencies.listIds
      .mockResolvedValueOnce(['existing-1'])
      .mockResolvedValueOnce(['existing-1', 'in-1', 'out-1'])
    dependencies.fetchBackfill
      .mockResolvedValueOnce({
        ok: true,
        conversationsScanned: 25,
        messagesFetched: 2,
        messages: [firstInbound, firstOutbound],
        partialErrors: ['first-batch-warning'],
        truncated: true,
        conversationPage: 'ig-account/conversations?limit=25',
        nextConversationPage: 'https://graph.instagram.com/v25.0/ig-account/conversations?after=cursor-25',
      })
      .mockResolvedValueOnce({
        ok: true,
        conversationsScanned: 1,
        messagesFetched: 1,
        messages: [secondInbound],
        partialErrors: [],
        truncated: false,
        conversationPage: 'https://graph.instagram.com/v25.0/ig-account/conversations?after=cursor-25',
        nextConversationPage: null,
      })

    const result = await backfillInstagramHistoryWorkflow({
      requestedBy: 'admin-1',
      requestedAt: '2026-07-16T10:00:00.000Z',
    })

    expect(dependencies.fetchBackfill).toHaveBeenNthCalledWith(1, {
      excludeMessageIds: ['existing-1'],
    })
    expect(dependencies.fetchBackfill).toHaveBeenNthCalledWith(2, {
      excludeMessageIds: ['existing-1', 'in-1', 'out-1'],
      conversationPage: 'https://graph.instagram.com/v25.0/ig-account/conversations?after=cursor-25',
    })
    expect(dependencies.start).toHaveBeenCalledTimes(2)
    expect(dependencies.start).toHaveBeenNthCalledWith(
      1,
      dependencies.processMessage,
      [{
        message_id: 'db-in-1',
        conversation_id: 'conversation-in-1',
        force_draft: true,
      }],
    )
    expect(dependencies.start).toHaveBeenNthCalledWith(
      2,
      dependencies.processMessage,
      [{
        message_id: 'db-in-2',
        conversation_id: 'conversation-in-2',
        force_draft: true,
      }],
    )
    expect(result).toEqual({
      requested_by: 'admin-1',
      requested_at: '2026-07-16T10:00:00.000Z',
      batches_completed: 2,
      conversations_scanned: 26,
      messages_fetched: 3,
      inserted: 3,
      duplicates: 0,
      outbound: 1,
      drafts_queued: 2,
      partial_errors: ['first-batch-warning'],
      truncated: false,
      stopped_reason: 'complete',
    })
  })

  it('stops a truncated import when Meta yields no normalizable progress', async () => {
    dependencies.listIds.mockResolvedValue(['existing-1'])
    dependencies.fetchBackfill.mockResolvedValue({
      ok: true,
      conversationsScanned: 2,
      messagesFetched: 2,
      messages: [],
      partialErrors: ['details could not be normalized'],
      truncated: true,
      conversationPage: 'ig-account/conversations?limit=25',
      nextConversationPage: 'ig-account/conversations?limit=25',
    })

    const result = await backfillInstagramHistoryWorkflow({
      requestedBy: 'admin-1',
      requestedAt: '2026-07-16T10:00:00.000Z',
    })

    expect(dependencies.fetchBackfill).toHaveBeenCalledTimes(1)
    expect(dependencies.start).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      batches_completed: 1,
      messages_fetched: 2,
      drafts_queued: 0,
      truncated: true,
      stopped_reason: 'no_progress',
    })
  })

  it('recovers a persisted imported row after an interrupted step result', async () => {
    const recoverable = message('recoverable-in', 'in')
    const terminal = message('terminal-in', 'in')
    dependencies.listIds.mockResolvedValue([])
    dependencies.fetchBackfill.mockResolvedValue({
      ok: true,
      conversationsScanned: 1,
      messagesFetched: 2,
      messages: [recoverable, terminal],
      partialErrors: [],
      truncated: false,
      conversationPage: 'ig-account/conversations?limit=25',
      nextConversationPage: null,
    })
    dependencies.ingest
      .mockResolvedValueOnce({
        duplicate: true,
        messageId: 'db-recoverable-in',
        conversationId: 'conversation-recoverable-in',
        shouldQueue: true,
      })
      .mockResolvedValueOnce({
        duplicate: true,
        messageId: 'db-terminal-in',
        conversationId: 'conversation-terminal-in',
        shouldQueue: false,
      })

    const result = await backfillInstagramHistoryWorkflow({
      requestedBy: 'admin-1',
      requestedAt: '2026-07-16T10:00:00.000Z',
    })

    expect(dependencies.start).toHaveBeenCalledTimes(1)
    expect(dependencies.start).toHaveBeenCalledWith(
      dependencies.processMessage,
      [{
        message_id: 'db-recoverable-in',
        conversation_id: 'conversation-recoverable-in',
        force_draft: true,
      }],
    )
    expect(result).toMatchObject({
      inserted: 0,
      duplicates: 2,
      drafts_queued: 1,
      stopped_reason: 'complete',
    })
  })

  it('persists the full chat before starting only its latest unanswered inbound draft', async () => {
    const inboundOne = message('in-1', 'in')
    const inboundTwo = message('in-2', 'in')
    const answered = message('out-1', 'out')
    const latestInbound = message('in-3', 'in')
    dependencies.listIds.mockResolvedValue([])
    dependencies.fetchBackfill.mockResolvedValue({
      ok: true,
      conversationsScanned: 1,
      messagesFetched: 4,
      messages: [inboundOne, inboundTwo, answered, latestInbound],
      partialErrors: [],
      truncated: false,
      conversationPage: 'page-1',
      nextConversationPage: null,
    })
    dependencies.ingest.mockImplementation(
      async (candidate: NormalizedOmnichannelMessage) => ({
        duplicate: false,
        messageId: `db-${candidate.externalMessageId}`,
        conversationId: 'conversation-shared',
        shouldQueue: candidate.direction === 'in',
      }),
    )

    const result = await backfillInstagramHistoryWorkflow({
      requestedBy: 'admin-1',
      requestedAt: '2026-07-16T10:00:00.000Z',
    })

    expect(dependencies.ingest).toHaveBeenCalledTimes(4)
    expect(dependencies.start).toHaveBeenCalledOnce()
    expect(dependencies.start).toHaveBeenCalledWith(
      dependencies.processMessage,
      [{
        message_id: 'db-in-3',
        conversation_id: 'conversation-shared',
        force_draft: true,
      }],
    )
    expect(dependencies.ingest.mock.invocationCallOrder[3]).toBeLessThan(
      dependencies.start.mock.invocationCallOrder[0],
    )
    expect(result).toMatchObject({ drafts_queued: 1, outbound: 1 })
  })

  it('stops when Meta cycles back to a completed conversation cursor', async () => {
    dependencies.listIds.mockResolvedValue([])
    dependencies.fetchBackfill
      .mockResolvedValueOnce({
        ok: true,
        conversationsScanned: 25,
        messagesFetched: 0,
        messages: [],
        partialErrors: [],
        truncated: true,
        conversationPage: 'page-1',
        nextConversationPage: 'page-2',
      })
      .mockResolvedValueOnce({
        ok: true,
        conversationsScanned: 25,
        messagesFetched: 0,
        messages: [],
        partialErrors: [],
        truncated: true,
        conversationPage: 'page-2',
        nextConversationPage: 'page-1',
      })

    const result = await backfillInstagramHistoryWorkflow({
      requestedBy: 'admin-1',
      requestedAt: '2026-07-16T10:00:00.000Z',
    })

    expect(dependencies.fetchBackfill).toHaveBeenCalledTimes(2)
    expect(dependencies.fetchBackfill).toHaveBeenNthCalledWith(2, {
      excludeMessageIds: [],
      conversationPage: 'page-2',
    })
    expect(result).toMatchObject({
      batches_completed: 2,
      truncated: true,
      stopped_reason: 'cursor_repeat',
    })
  })
})
