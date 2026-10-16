/**
 * Telegram → inbox ingest: same audit/claim/enqueue path as the other
 * channels; dedupe by update id (audit) and message id (message upsert).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ingestTelegramInboxUpdate, type TelegramIngestPersistence } from '@/lib/omnichannel/telegram-ingest'
import { parseTelegramInboxUpdate } from '@/lib/omnichannel/telegram-webhook'

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const parsed = parseTelegramInboxUpdate(
  {
    update_id: 900,
    message: {
      message_id: 11,
      date: Math.floor(NOW / 1000) - 5,
      chat: { id: 42, type: 'private' },
      from: { id: 42, is_bot: false, first_name: 'Ерлан' },
      text: 'Хочу в Клуб',
    },
  },
  { kind: 'business_bot', botId: '7000000001', botUsername: 'honor_shop_bot' },
  NOW,
)!

function fakeStore(overrides: Partial<Record<keyof TelegramIngestPersistence, unknown>> = {}) {
  return {
    recordWebhookEvent: vi.fn(async () => ({ id: 'audit-1', duplicate: false, status: 'received' as const })),
    claimWebhookEventForProcessing: vi.fn(async () => true),
    transitionWebhookEvent: vi.fn(async () => undefined),
    ingestNormalizedMessage: vi.fn(async () => ({
      duplicate: false, messageId: 'msg-1', conversationId: 'conv-1', shouldQueue: true,
    })),
    ...overrides,
  } as unknown as TelegramIngestPersistence & Record<string, ReturnType<typeof vi.fn>>
}

describe('ingestTelegramInboxUpdate', () => {
  let queue: { enqueue: ReturnType<typeof vi.fn<(input: { messageId: string; conversationId: string }) => Promise<void>>> }
  beforeEach(() => {
    queue = { enqueue: vi.fn(async (_input: { messageId: string; conversationId: string }) => undefined) }
  })

  it('records the update, stores the message and enqueues it for processing', async () => {
    const store = fakeStore()
    const result = await ingestTelegramInboxUpdate(parsed, { persistence: store, queue })
    expect(result).toMatchObject({ outcome: 'processed', messageId: 'msg-1', queued: true })
    expect(store.recordWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      eventType: 'tg_message',
      accountExternalId: 'tgbot:7000000001',
      eventHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(store.ingestNormalizedMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      externalMessageId: 'tgbot:7000000001:42:11',
      text: 'Хочу в Клуб',
    }))
    expect(queue.enqueue).toHaveBeenCalledWith({ messageId: 'msg-1', conversationId: 'conv-1' })
    expect(store.transitionWebhookEvent).toHaveBeenCalledWith('audit-1', 'processed')
  })

  it('a replayed update (terminal audit) is acknowledged without touching messages', async () => {
    const store = fakeStore({
      recordWebhookEvent: vi.fn(async () => ({ id: 'audit-1', duplicate: true, status: 'processed' })),
    })
    const result = await ingestTelegramInboxUpdate(parsed, { persistence: store, queue })
    expect(result.outcome).toBe('duplicate')
    expect(store.ingestNormalizedMessage).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('a duplicate message (already processed) is not queued twice', async () => {
    const store = fakeStore({
      ingestNormalizedMessage: vi.fn(async () => ({
        duplicate: true, messageId: 'msg-1', conversationId: 'conv-1', shouldQueue: false,
      })),
    })
    const result = await ingestTelegramInboxUpdate(parsed, { persistence: store, queue })
    expect(result.outcome).toBe('duplicate')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('a concurrent delivery holding the lease is reported as in flight (retry)', async () => {
    const store = fakeStore({ claimWebhookEventForProcessing: vi.fn(async () => false) })
    const result = await ingestTelegramInboxUpdate(parsed, { persistence: store, queue })
    expect(result.outcome).toBe('in_flight')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('an enqueue failure marks the audit failed and rethrows so Telegram retries', async () => {
    const store = fakeStore()
    queue.enqueue.mockRejectedValueOnce(new Error('queue down'))
    await expect(ingestTelegramInboxUpdate(parsed, { persistence: store, queue })).rejects.toThrow('queue down')
    expect(store.transitionWebhookEvent).toHaveBeenCalledWith('audit-1', 'failed', 'queue_enqueue_failed')
  })
})
