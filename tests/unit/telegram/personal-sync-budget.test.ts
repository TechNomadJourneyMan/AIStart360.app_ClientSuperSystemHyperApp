/**
 * RA-5 (review of R4-A2) — the daily personal Telegram sync is wrapped with the route's 60 s deadline
 * (app/api/telegram/personal/sync), but its loop had no budget of its own: a long day answered 504
 * every morning (a failure in the job journal) while the loop went on alone. Now a run stops taking
 * dialogs and messages after its budget (40 s by default, TELEGRAM_PERSONAL_SYNC_BUDGET_MS); a message
 * is never cut in the middle, and what is left is read on the next run (last_processed_message_id).
 *
 * NV-2 (verification of the fixes) — for a chat seen for the first time the collection moved the
 * cursor to its latest message at once: a link code («AISTART-…») from such a chat, left for the next
 * run by the budget, was behind the cursor then and never handled. The cursor of a new chat now stops
 * just before its first link code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ChatRow { telegram_user_id: string; linked_profile_id: string | null; last_processed_message_id: number; muted: boolean }

const h = vi.hoisted(() => ({
  clock: 0,
  dialogs: [] as Array<{ entity: Record<string, unknown> }>,
  /** Messages of each chat (default: one question with id 7). */
  messages: new Map<string, Array<{ id: number; message: string }>>(),
  state: new Map<string, ChatRow>(),
  lookups: [] as string[],
  binds: [] as string[],
}))

vi.mock('@/lib/telegram/personal-client', () => ({
  createTelegramPersonalClient: async () => ({
    getDialogs: async () => h.dialogs,
    getMessages: async (entity: { id: string }) =>
      (h.messages.get(entity.id) ?? [{ id: 7, message: `Вопрос от ${entity.id}` }]).map((m) => ({ ...m, out: false })),
    sendMessage: async () => ({ id: 1_000 }),
  }),
  disconnectTelegramPersonalClient: async () => undefined,
}))
vi.mock('@/lib/telegram/profiles', () => ({
  createTelegramAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: h.state.get(id) ?? null, error: null }) }) }),
      upsert: async (row: Partial<ChatRow> & { telegram_user_id?: string }) => {
        // telegram_personal_chats rows (the message log rows have telegram_message_id and no cursor)
        if (row.telegram_user_id && row.last_processed_message_id !== undefined) {
          const prev = h.state.get(row.telegram_user_id)
          h.state.set(row.telegram_user_id, {
            telegram_user_id: row.telegram_user_id,
            linked_profile_id: row.linked_profile_id ?? prev?.linked_profile_id ?? null,
            last_processed_message_id: row.last_processed_message_id,
            muted: false,
          })
        }
        return { error: null }
      },
      update: (patch: { last_processed_message_id?: number }) => ({
        eq: async (_c: string, id: string) => {
          const row = h.state.get(id)
          if (row && patch.last_processed_message_id !== undefined) row.last_processed_message_id = patch.last_processed_message_id
          return { error: null }
        },
      }),
    }),
  }),
  // every message of an unlinked sender takes 10 s of the run (logged and ignored)
  findProfileByTelegramUserId: async (_admin: unknown, telegramUserId: string) => {
    h.lookups.push(telegramUserId)
    h.clock += 10_000
    return null
  },
  bindProfileByTelegramIdentity: async (_admin: unknown, token: string) => {
    h.binds.push(token)
    return { ok: true, profile: { id: 'profile-1', full_name: 'Клиент' } }
  },
  unlinkProfileTelegram: vi.fn(),
}))
vi.mock('@/lib/assistant/answer', () => ({ answerUserQuestion: vi.fn() }))
vi.mock('@/lib/assistant/context', () => ({ buildAssistantContext: vi.fn() }))
vi.mock('@/lib/assistant/escalation/adapter', () => ({ createExpertCase: vi.fn() }))

const { syncTelegramPersonalInbox, TELEGRAM_PERSONAL_SYNC_BUDGET_MS } = await import('@/lib/telegram/personal-sync')

const user = (id: string) => ({ entity: { className: 'User', id, firstName: `Клиент ${id}` } })
const known = (id: string): [string, ChatRow] => [id, { telegram_user_id: id, linked_profile_id: null, last_processed_message_id: 0, muted: false }]
const cursor = (id: string) => h.state.get(id)?.last_processed_message_id
const LINK_CODE = 'AISTART-0A1B2C3D4E'

beforeEach(() => {
  h.clock = 0
  h.lookups = []
  h.binds = []
  h.messages = new Map()
  h.dialogs = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(user)
  h.state = new Map(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(known))
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
    expect(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(cursor)).toEqual([7, 7, 7, 0, 0, 0])

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

describe('NV-2: a link code of a chat seen for the first time is not lost when the budget defers it', () => {
  beforeEach(() => {
    // three known chats with questions come first; then a new person sends the link code
    h.dialogs = ['u1', 'u2', 'u3', 'n1'].map(user)
    h.state = new Map(['u1', 'u2', 'u3'].map(known))
    h.messages.set('n1', [{ id: 40, message: 'Здравствуйте' }, { id: 42, message: LINK_CODE }])
  })

  it('deferred in the first run, the code is handled in the next one', async () => {
    const first = await syncTelegramPersonalInbox({ budgetMs: 25_000, now: () => h.clock })
    expect(first.deferredMessages).toBe(1)
    expect(h.binds).toEqual([])
    // before: 42 — the cursor already behind the code
    expect(cursor('n1')).toBe(41)

    h.clock = 0
    const second = await syncTelegramPersonalInbox({ budgetMs: 25_000, now: () => h.clock })
    expect(h.binds).toEqual([LINK_CODE])
    expect(second).toMatchObject({ linkedProfiles: 1, deferredMessages: 0 })
    expect(cursor('n1')).toBe(42)
    // the history before the code (message 40) is still skipped
    expect(h.lookups.filter((id) => id === 'n1')).toEqual([])
  })

  it('a new chat without a link code still skips its history: the cursor goes to its latest message', async () => {
    h.messages.set('n1', [{ id: 40, message: 'Здравствуйте' }, { id: 41, message: 'Есть кто?' }])
    await syncTelegramPersonalInbox({ budgetMs: 60_000, now: () => h.clock })
    expect(cursor('n1')).toBe(41)
    expect(h.lookups.filter((id) => id === 'n1')).toEqual([])
  })
})
