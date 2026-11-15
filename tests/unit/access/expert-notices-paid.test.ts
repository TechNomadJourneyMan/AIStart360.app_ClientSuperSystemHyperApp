/**
 * R2-C (security review F1 / product review H-1): the expert's comments and
 * review are part of Точка А (decision of the PO, M-4). A client with Точка А
 * closed must not get their CONTENT through a notice or a letter:
 *   • «Новый комментарий эксперта» (lib/notifications.ts notifyUser — the path
 *     of POST /api/expert/comments and GIGA User 360 → комментарии): a neutral
 *     text, no preview, no block, link /client/home#expert (the paywall block);
 *   • «Эксперт подготовил разбор» (the letter of lib/email/templates.ts): no
 *     title, no count of comments.
 * A failed access decision → closed (no text). Pro → as before.
 * Real text formation: only the transport (feed, e-mail, Telegram, journal)
 * and the access decision are replaced. The route of the review publication:
 * tests/unit/expert-review/publish.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CLIENT = '00000000-0000-4000-8000-0000000000c1'
const SECRET = 'SECRET-выручка-упала-на-40%-из-за-оттока'

const h = vi.hoisted(() => ({
  mode: 'mock' as 'mock' | 'real',
  closed: true,
  feed: [] as Array<Record<string, unknown>>,
  email: [] as Array<Record<string, unknown>>,
  telegram: [] as string[],
}))

vi.mock('@/lib/access/recipient', async (orig) => {
  const real = await orig<typeof import('@/lib/access/recipient')>()
  return {
    ...real,
    pointAClosedFor: (id: string) => (h.mode === 'real' ? real.pointAClosedFor(id) : Promise.resolve(h.closed)),
  }
})
// The real decision fails here: the service client cannot be built (fail closed).
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => { throw new Error('service client unavailable') } }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Иван', email: 'ivan@corp.kz' }, error: null }) }) }) }) }),
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => ({ id, email: 'ivan@corp.kz', fullName: 'Иван', telegramChatId: 'chat-1', preferences: { notifications: { expert: { in_app: true, email: true, telegram: true } } } }),
  countCapTouches: async () => 0,
  claimSend: async () => ({ result: 'claimed', id: 's1' }),
  releaseSend: async () => undefined,
}))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async (n: Record<string, unknown>) => { h.feed.push(n); return true } }))
vi.mock('@/lib/email/send', () => ({ sendTransactionalEmail: async (e: Record<string, unknown>) => { h.email.push(e); return { ok: true } } }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async (_chat: string, text: string) => { h.telegram.push(text); return true } }))

const { notifyUser, LOCKED_EXPERT_COMMENT } = await import('@/lib/notifications')
const { buildExpertReviewPublishedEmail } = await import('@/lib/email/templates')

const everything = () => JSON.stringify({ feed: h.feed, email: h.email, telegram: h.telegram })

beforeEach(() => {
  h.mode = 'mock'
  h.closed = true
  h.feed = []
  h.email = []
  h.telegram = []
})

describe('«Новый комментарий эксперта» for a client without Точка А', () => {
  it('feed, e-mail and Telegram carry NO text of the comment and no block; the link is the paywall block of the home page', async () => {
    await notifyUser(CLIENT, 'expert_comment', { preview: SECRET, blockKey: 'finance', expertName: 'Эксперт Пётр' })
    expect(h.feed).toHaveLength(1)
    expect(h.feed[0]).toMatchObject({ userId: CLIENT, title: 'Новый комментарий эксперта', body: LOCKED_EXPERT_COMMENT.body, link: '/client/home#expert' })
    expect(LOCKED_EXPERT_COMMENT.body).toBe('Эксперт оставил комментарий к вашей Точке А — он доступен в платном доступе.')
    expect(h.email).toHaveLength(1)
    expect(h.telegram).toHaveLength(1)
    expect(everything()).not.toContain('SECRET')
    expect(everything()).not.toContain('finance')
    expect(everything()).not.toContain('Пётр')
  })

  it('a failed access decision → closed: still no text (the real decision, fail closed)', async () => {
    h.mode = 'real'
    await notifyUser(CLIENT, 'expert_comment', { preview: SECRET })
    expect(h.feed[0]).toMatchObject({ body: LOCKED_EXPERT_COMMENT.body })
    expect(everything()).not.toContain('SECRET')
  })

  it('Pro (Точка А open) → as before: the text of the comment and «Открыть комментарий»', async () => {
    h.closed = false
    await notifyUser(CLIENT, 'expert_comment', { preview: SECRET, blockKey: 'finance', expertName: 'Эксперт Пётр' })
    expect(String(h.feed[0].body)).toContain(SECRET)
    expect(String(h.feed[0].body)).toContain('finance')
    expect(h.feed[0]).toMatchObject({ link: '/client/home#expert' })
    expect(JSON.stringify(h.email[0])).toContain('Открыть комментарий')
  })

  it('other client notices are not touched by the paid rule', async () => {
    await notifyUser(CLIENT, 'expert_case_updated', { caseId: 'c1', title: 'Вопрос по выручке', status: 'answered' })
    expect(String(h.feed[0].body)).toContain('Вопрос по выручке')
  })
})

describe('the letter «Эксперт подготовил разбор»', () => {
  const input = { name: 'Иван', expertName: 'Пётр', commentsCount: 3, title: `Разбор: ${SECRET}`, publishedAt: '2026-11-12T10:00:00Z', url: 'https://x/client/home#expert' }

  it('Точка А closed → no title, no count of comments; leads to the paywall block', () => {
    const { content } = buildExpertReviewPublishedEmail({ ...input, paidLocked: true })
    const text = JSON.stringify(content)
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('3 комментария')
    expect(text).toContain('платный доступ')
    expect(content.cta).toEqual({ label: 'Подробнее', url: 'https://x/client/home#expert' })
  })

  it('open → as before (title and count)', () => {
    const text = JSON.stringify(buildExpertReviewPublishedEmail(input).content)
    expect(text).toContain('SECRET')
    expect(text).toContain('3 комментария')
  })
})
