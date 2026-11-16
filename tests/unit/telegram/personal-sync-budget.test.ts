/**
 * RA-5 (review of R4-A2) — the daily personal Telegram sync is wrapped with the route's 60 s deadline
 * (app/api/telegram/personal/sync), but its loop had no budget of its own: a long day answered 504
 * every morning (a failure in the job journal) while the loop went on alone. Now a run stops taking
 * dialogs and messages after its budget (40 s by default, TELEGRAM_PERSONAL_SYNC_BUDGET_MS); a message
 * is never cut in the middle, and what is left is read on the next run (last_processed_message_id).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  clock: 0,
  dialogs: [] as Array<{ entity: Record<string, unknown> }>,
  lastProcessed: new Map<string, number>(),
  lookups: [] as string[],
}))

vi.mock('@/lib/telegram/personal-client', () => ({
  createTelegramPersonalClient: async () => ({
    getDialogs: async () => h.dialogs,
    getMessages: async (entity: { id: string }) => [{ id: 7, out: false, message: `Вопрос от ${entity.id}` }],
  }),
  disconnectTelegramPersonalClient: async () => undefined,
}))
vi.mock('@/lib/telegram/profiles', () => ({
  createTelegramAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { telegram_user_id: id, linked_profile_id: null, last_processed_message_id: h.lastProcessed.get(id) ?? 0, muted: false }, error: null }) }) }),
      upsert: async () => ({ error: null }),
      update: (patch: { last_processed_message_id?: number }) => ({
        eq: async (_c: string, id: string) => {
          if (patch.last_processed_message_id !== undefined) h.lastProcessed.set(id, patch.last_processed_message_id)
          return { error: null }
        },
      }),
    }),
  }),
  // every message takes 10 s of the run (an unlinked sender: logged and ignored)
  findProfileByTelegramUserId: async (_admin: unknown, telegramUserId: string) => {
    h.lookups.push(telegramUserId)
    h.clock += 10_000
    return null
  },
  bindProfileByTelegramIdentity: vi.fn(),
  unlinkProfileTelegram: vi.fn(),
}))
vi.mock('@/lib/assistant/answer', () => ({ answerUserQuestion: vi.fn() }))
vi.mock('@/lib/assistant/context', () => ({ buildAssistantContext: vi.fn() }))
vi.mock('@/lib/assistant/escalation/adapter', () => ({ createExpertCase: vi.fn() }))

const { syncTelegramPersonalInbox, TELEGRAM_PERSONAL_SYNC_BUDGET_MS } = await import('@/lib/telegram/personal-sync')

const user = (id: string) => ({ entity: { className: 'User', id, firstName: `Клиент ${id}` } })

beforeEach(() => {
  h.clock = 0
  h.lookups = []
  h.lastProcessed = new Map()
  h.dialogs = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(user)
})

describe('RA-5: the Telegram sync loop has a budget below the route deadline', () => {
  it('40 s by default — 20 s less than the route\'s 60 s', () => {
    expect(TELEGRAM_PERSONAL_SYNC_BUDGET_MS).toBe(40_000)
  })

  it('stops taking messages when the budget is spent; the rest stays for the next run', async () => {
    const result = await syncTelegramPersonalInbox({ budgetMs: 25_000, now: () => h.clock })

    // 10 s each: after 3 messages (30 s ≥ 25 s) no 4th is started
    expect(h.lookups).toEqual(['u1', 'u2', 'u3'])
    expect(result).toMatchObject({ ok: true, processedMessages: 3, ignoredMessages: 3, deferredMessages: 3, scannedDialogs: 6 })
    expect([...h.lastProcessed.keys()]).toEqual(['u1', 'u2', 'u3'])

    // the next run takes the rest: the three already done are behind their last_processed_message_id
    h.clock = 0
    const next = await syncTelegramPersonalInbox({ budgetMs: 25_000, now: () => h.clock })
    expect(h.lookups).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
    expect(next).toMatchObject({ processedMessages: 3, deferredMessages: 0 })
  })

  it('a spent budget also stops reading more dialogs (they are read next time)', async () => {
    h.clock = 0
    const result = await syncTelegramPersonalInbox({ budgetMs: 0, now: () => h.clock })
    expect(result).toMatchObject({ scannedDialogs: 0, processedMessages: 0, deferredMessages: 0 })
    expect(h.lookups).toEqual([])
  })
})
