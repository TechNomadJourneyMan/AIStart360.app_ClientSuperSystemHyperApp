/**
 * R5 review (wave 1B, M-2): notifyClient and the lifecycle of its automation_sends claim.
 *   • it claims with `pending: true` and confirms the claim once a channel delivered;
 *   • nothing delivered → the claim is released (not confirmed);
 *   • a claim held by another process (fresh 'pending') → { ok: false, retryable: true }, nothing
 *     sent — NOT «duplicate» (which callers count as done) — so a job retry comes back and, after
 *     the stale window, takes the claim over and delivers (crash recovery);
 *   • the e-mail layer's retryable answer is not «delivered».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claims: [] as Array<Record<string, unknown>>,
  nextClaim: null as null | { result: string; id: string | null; confirm?: () => Promise<boolean> },
  confirmed: [] as string[],
  released: [] as string[],
  emailResult: { ok: true } as Record<string, unknown>,
  feedOk: true,
  email: vi.fn(),
  feed: vi.fn(),
}))

vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => ({ id, email: 'owner@example.com', fullName: 'Иван', telegramChatId: null, preferences: {} }),
  countCapTouches: async () => 0,
  claimSend: async (input: Record<string, unknown>) => {
    h.claims.push(input)
    if (h.nextClaim) return h.nextClaim
    const id = `c${h.claims.length}`
    return { result: 'claimed', id, confirm: async () => { h.confirmed.push(id); return true } }
  },
  releaseSend: async (id: string) => { h.released.push(id) },
}))
vi.mock('@/lib/email/send', () => ({
  sendTransactionalEmail: async (input: unknown) => {
    h.email(input)
    return h.emailResult
  },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (input: unknown) => {
    h.feed(input)
    return h.feedOk
  },
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => true }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => (key === 'auto_touch_weekly_cap' ? 2 : true) }))

const { notifyClient } = await import('@/lib/notifications/notify')

const base = { userId: 'u1', category: 'gri' as const, event: 'gri_completed', title: 'GRI пройден', body: 'Результат в кабинете.', dedupeKey: 'gri_completed:a1' }

beforeEach(() => {
  h.claims = []
  h.nextClaim = null
  h.confirmed = []
  h.released = []
  h.emailResult = { ok: true }
  h.feedOk = true
  h.email.mockReset()
  h.feed.mockReset()
})

describe('notifyClient — the claim lifecycle', () => {
  it('claims «pending» and confirms the claim after a channel delivered', async () => {
    const res = await notifyClient(base)
    expect(res).toMatchObject({ ok: true, delivered: { inApp: true, email: true } })
    expect(h.claims[0]).toMatchObject({ dedupeKey: 'gri_completed:a1', pending: true })
    expect(h.confirmed).toEqual(['c1'])
    expect(h.released).toEqual([])
  })

  it('nothing delivered → the claim is released, not confirmed', async () => {
    h.feedOk = false
    h.emailResult = { ok: false, error: 'resend down' }
    const res = await notifyClient(base)
    expect(res).toMatchObject({ ok: false, skipped: 'not_delivered' })
    expect(h.released).toEqual(['c1'])
    expect(h.confirmed).toEqual([])
  })

  it('a claim held by another process: retryable, nothing sent, not «duplicate»', async () => {
    h.nextClaim = { result: 'in_flight', id: null }
    const res = await notifyClient(base)
    expect(res).toMatchObject({ ok: false, retryable: true, delivered: { inApp: false, email: false, telegram: false } })
    expect(res.skipped).toBeUndefined()
    expect(h.email).not.toHaveBeenCalled()
    expect(h.feed).not.toHaveBeenCalled()
  })

  it('crash recovery: the retry after the stale window gets the claim (taken over) and delivers', async () => {
    h.nextClaim = { result: 'in_flight', id: null }
    expect(await notifyClient(base)).toMatchObject({ ok: false, retryable: true })
    let confirmed = false
    h.nextClaim = { result: 'claimed', id: 'dead-row', confirm: async () => { confirmed = true; return true } }
    expect(await notifyClient(base)).toMatchObject({ ok: true })
    expect(h.email).toHaveBeenCalledTimes(1)
    expect(confirmed).toBe(true)
  })

  it('the e-mail layer answers «retryable» (another process holds the letter): e-mail is not counted as delivered', async () => {
    h.feedOk = false
    h.emailResult = { ok: false, retryable: true, error: 'in flight' }
    const res = await notifyClient(base)
    expect(res.delivered.email).toBe(false)
    expect(res).toMatchObject({ ok: false, retryable: true })
    expect(h.released).toEqual(['c1'])
  })

  it('a duplicate stays a duplicate', async () => {
    h.nextClaim = { result: 'duplicate', id: null }
    expect(await notifyClient(base)).toMatchObject({ ok: true, skipped: 'duplicate' })
  })
})
