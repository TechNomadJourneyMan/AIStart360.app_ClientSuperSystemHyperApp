import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const actor = vi.hoisted(() => ({ get: vi.fn() }))
const queue = vi.hoisted(() => ({ send: vi.fn() }))
const audit = vi.hoisted(() => ({ log: vi.fn() }))
const repository = vi.hoisted(() => ({ listHistory: vi.fn() }))
const postgres = vi.hoisted(() => ({ enabled: vi.fn() }))
const processingJobs = vi.hoisted(() => ({ enqueueBatch: vi.fn() }))

vi.mock('@/lib/admin/giga-actor', () => ({ getGigaActor: actor.get }))
vi.mock('@/lib/inngest', () => ({ inngest: queue }))
vi.mock('@/lib/audit', () => ({ logAudit: audit.log }))
vi.mock('@/lib/omnichannel/repository', () => ({
  listImportedWhatsAppHistoryForDraft: repository.listHistory,
}))
vi.mock('@/lib/omnichannel/postgres-runtime', () => ({
  shouldUseOmnichannelPostgres: postgres.enabled,
}))
vi.mock('@/lib/omnichannel/processing-jobs', () => ({
  enqueueOmnichannelProcessingJobsViaPostgres: processingJobs.enqueueBatch,
}))

import { POST } from '@/app/api/giga-admin/omnichannel/backfill/route'

function request(channel: unknown): NextRequest {
  return new NextRequest('http://localhost/api/giga-admin/omnichannel/backfill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel }),
  })
}

describe('Giga Inbox backfill route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    actor.get.mockResolvedValue({ id: 'admin-1', kind: 'session' })
    audit.log.mockResolvedValue(undefined)
    queue.send.mockResolvedValue({ ids: ['event-1'] })
    processingJobs.enqueueBatch.mockResolvedValue([])
  })

  it('durably enqueues imported WhatsApp rows as drafts in one bounded batch', async () => {
    postgres.enabled.mockReturnValue(true)
    repository.listHistory.mockResolvedValue([
      { messageId: 'history-1', conversationId: 'conversation-1' },
      { messageId: 'history-2', conversationId: 'conversation-2' },
    ])
    processingJobs.enqueueBatch.mockResolvedValue([
      { status: 'queued', forceDraft: true },
      { status: 'leased', forceDraft: true },
    ])

    const response = await POST(request('whatsapp'))

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      queued: true,
      channel: 'whatsapp',
      source: 'already_ingested_whatsapp_web_history',
      candidates_found: 2,
      jobs_recorded: 2,
      jobs_queued: 1,
      jobs_in_progress: 1,
      jobs_completed: 0,
      jobs_dead: 0,
      completed: 0,
      failed: 0,
      force_draft: true,
      cloud_api_history_fetched: false,
    })
    expect(repository.listHistory).toHaveBeenCalledWith(100)
    expect(processingJobs.enqueueBatch).toHaveBeenCalledWith([
      { messageId: 'history-1', forceDraft: true },
      { messageId: 'history-2', forceDraft: true },
    ])
    expect(queue.send).not.toHaveBeenCalled()
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'omnichannel.history_analysis_enqueued',
    }))
  })

  it('returns durable progress for idempotently existing jobs without processing inline', async () => {
    postgres.enabled.mockReturnValue(true)
    repository.listHistory.mockResolvedValue([
      { messageId: 'history-1', conversationId: 'conversation-1' },
      { messageId: 'history-2', conversationId: 'conversation-2' },
      { messageId: 'history-3', conversationId: 'conversation-3' },
    ])
    processingJobs.enqueueBatch.mockResolvedValue([
      { status: 'succeeded', forceDraft: true },
      { status: 'dead', forceDraft: true },
      // A non-draft leased row cannot be upgraded safely by the RPC and must
      // never be reported as accepted historical draft work.
      { status: 'leased', forceDraft: false },
    ])

    const response = await POST(request('whatsapp'))

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      queued: false,
      candidates_found: 3,
      jobs_recorded: 3,
      jobs_queued: 0,
      jobs_in_progress: 0,
      jobs_completed: 1,
      jobs_dead: 1,
      force_draft_conflicts: 1,
      completed: 1,
      failed: 2,
    })
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('keeps authorization and request validation ahead of all queue work', async () => {
    actor.get.mockResolvedValueOnce(null)

    const forbidden = await POST(request('whatsapp'))
    expect(forbidden.status).toBe(403)

    actor.get.mockResolvedValueOnce({ id: 'admin-1', kind: 'session' })
    const invalid = await POST(request('telegram'))
    expect(invalid.status).toBe(400)

    expect(repository.listHistory).not.toHaveBeenCalled()
    expect(processingJobs.enqueueBatch).not.toHaveBeenCalled()
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('uses the durable Inngest path in production without fetching Cloud API history', async () => {
    postgres.enabled.mockReturnValue(false)

    const response = await POST(request('whatsapp'))

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      queued: true,
      channel: 'whatsapp',
      source: 'already_ingested_whatsapp_web_history',
      force_draft: true,
      cloud_api_history_fetched: false,
    })
    expect(queue.send).toHaveBeenCalledWith({
      name: 'omnichannel/backfill.requested',
      data: {
        channel: 'whatsapp',
        requested_by: 'admin-1',
        requested_at: expect.any(String),
      },
    })
    expect(repository.listHistory).not.toHaveBeenCalled()
    expect(processingJobs.enqueueBatch).not.toHaveBeenCalled()
  })

  it('keeps Instagram import on its existing durable Inngest workflow', async () => {
    postgres.enabled.mockReturnValue(true)

    const response = await POST(request('instagram'))

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      queued: true,
      channel: 'instagram',
      event_ids: ['event-1'],
    })
    expect(queue.send).toHaveBeenCalledWith({
      name: 'omnichannel/backfill.requested',
      data: {
        channel: 'instagram',
        requested_by: 'admin-1',
        requested_at: expect.any(String),
      },
    })
    expect(repository.listHistory).not.toHaveBeenCalled()
    expect(processingJobs.enqueueBatch).not.toHaveBeenCalled()
  })
})
