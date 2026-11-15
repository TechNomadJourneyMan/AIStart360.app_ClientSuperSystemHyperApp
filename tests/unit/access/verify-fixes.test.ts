/**
 * R2-C — the last package after the independent verification (R2-C-VERIFY.md):
 *   H-1 rest  User 360 tells the expert the truth BEFORE a comment / a review goes
 *             to a client with Точка А closed (GET …/comments and …/review →
 *             clientPaidLocked, one batch decision; a failed one → no flag);
 *   Н-3       the bulk «Сменить тариф → Pro»: the paid AI catch-up runs in the
 *             background, at most 2 clients at a time, not per client;
 *   Н-4       the bulk dialog says what Free / Pro really do; plan errors in Russian.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeFakeDb, type FakeDb } from '../expert-review/_fake-db'

const CLIENT = '11111111-2222-4333-8444-555555555555'
const STAFF = '99999999-8888-4777-8666-555555555555'

const s = vi.hoisted(() => ({
  closed: new Set<string>(),
  batchCalls: [] as string[][],
  db: null as unknown as FakeDb,
  background: [] as string[],
}))
vi.mock('@/lib/background', async (orig) => ({ ...(await orig<Record<string, unknown>>()), runInBackground: (label: string) => { s.background.push(label); return Promise.resolve() } }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))

vi.mock('@/lib/access/owner-access', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  usersWithClosedSection: async (ids: string[]) => {
    s.batchCalls.push([...ids])
    return new Set(ids.filter((id) => s.closed.has(id)))
  },
}))
vi.mock('@/lib/admin/giga-actor', async (orig) => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { ...(await orig<Record<string, unknown>>()), requireGiga: makeRequireGiga(() => ({ id: STAFF, kind: 'session', role: 'super_expert' })), forbidTarget: async () => null }
})
vi.mock('@/lib/admin/client-scope', async (orig) => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const requireGiga = makeRequireGiga(() => ({ id: STAFF, kind: 'session', role: 'super_expert' }))
  return { ...(await orig<Record<string, unknown>>()), guardClientAccess: async () => null, requireGigaClient: (req: unknown, perm: never) => requireGiga(req, perm) }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.db }))

const commentsRoute = await import('@/app/api/giga-admin/users/[id]/comments/route')
const reviewRoute = await import('@/app/api/giga-admin/users/[id]/review/route')
const copy = await import('@/components/giga-panel/user360/free-client-copy')

const get = (url: string) => new NextRequest(url)

beforeEach(() => {
  s.closed = new Set([CLIENT])
  s.batchCalls = []
  s.db = makeFakeDb({
    profiles: [{ id: STAFF, full_name: 'Анна', email: 'a@staff.io' }, { id: CLIENT, full_name: 'Иван', email: 'c@x.io' }],
    expert_comments: [{ id: 'c1', client_id: CLIENT, author_id: STAFF, author_title: null, block_key: null, text: 'T', status: 'published', source: 'expert', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }],
    expert_reviews: [],
  })
})

describe('verify H-1: User 360 says the truth before a comment / a review goes to a Free client', () => {
  it('GET …/comments → clientPaidLocked by the batch decision; unknown → no flag', async () => {
    const body = await (await commentsRoute.GET(get(`http://l/api/giga-admin/users/${CLIENT}/comments`), { params: { id: CLIENT } })).json()
    expect(body).toMatchObject({ ok: true, clientPaidLocked: true })
    expect(s.batchCalls).toEqual([[CLIENT]])
    s.closed = new Set() // open, or the decision failed (usersWithClosedSection returns only KNOWN closed)
    const open = await (await commentsRoute.GET(get(`http://l/api/giga-admin/users/${CLIENT}/comments`), { params: { id: CLIENT } })).json()
    expect(open.clientPaidLocked).toBe(false)
  })

  it('GET …/review → clientPaidLocked', async () => {
    const body = await (await reviewRoute.GET(get(`http://l/api/giga-admin/users/${CLIENT}/review`), { params: { id: CLIENT } })).json()
    expect(body).toMatchObject({ ok: true, clientPaidLocked: true })
  })

  it('the texts: Free → «только уведомление без текста … после открытия доступа»; otherwise as before', () => {
    expect(copy.commentComposerHint(true)).toBe(copy.COMMENT_FREE_NOTE)
    expect(copy.COMMENT_FREE_NOTE).toContain('только уведомление без текста')
    expect(copy.commentComposerHint(false)).toContain('Клиент увидит комментарий')
    expect(copy.commentsEmptyHint(true)).not.toContain('увидит у себя в кабинете')
    expect(copy.commentSentToast(true)).toContain('без текста')
    expect(copy.commentSentToast(false)).toBe('Комментарий отправлен клиенту')
    expect(copy.reviewPublishText(3, 2, true)).toContain('без текста комментариев')
    expect(copy.reviewPublishText(3, 2, true)).not.toContain('Клиент увидит')
    expect(copy.reviewPublishText(3, 2, false)).toContain('Клиент увидит 3 комментария в 2 блок(ах)')
  })

  it('the tabs use these texts with the server flag (wiring)', async () => {
    const { readFileSync } = await import('node:fs')
    const tab = readFileSync('components/giga-panel/user360/CommentsTab.tsx', 'utf8')
    expect(tab).toContain('description={commentComposerHint(locked)}')
    expect(tab).toContain('commentsEmptyHint(locked)')
    expect(tab).toContain('commentSentToast(locked)')
    expect(tab).not.toContain('Клиент увидит комментарий в кабинете')
    const review = readFileSync('components/giga-panel/user360/review/ReviewTab.tsx', 'utf8')
    expect(review).toContain("reviewPublishText(comments.length, byBlock.size, data?.clientPaidLocked === true)")
    expect(review).not.toMatch(/Клиент увидит \{pluralComments/)
  })
})

describe('verify Н-3: the bulk AI catch-up is bounded', () => {
  it('catchUpPaidAiBatch: never more than 2 clients at a time (even when asked for more); a failure does not stop the others', async () => {
    const { catchUpPaidAiBatch } = await import('@/lib/point-a/catch-up-batch')
    let active = 0
    let peak = 0
    const seen: string[] = []
    const ids = Array.from({ length: 9 }, (_, i) => `u${i}`)
    await catchUpPaidAiBatch(ids, {
      concurrency: 5,
      run: async (id) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 2))
        active--
        seen.push(id)
        if (id === 'u3') throw new Error('boom')
      },
    })
    expect(peak).toBe(2)
    expect(seen.sort()).toEqual([...ids].sort())
  })

  it('catchUpPaidAiAwaited holds the slot until the client\'s AI calls settle; without the AI key nothing starts', async () => {
    const { catchUpPaidAiAwaited } = await import('@/lib/point-a/catch-up-batch')
    let release!: () => void
    const call = new Promise<void>((r) => { release = r })
    let done = false
    const p = catchUpPaidAiAwaited('u1', {
      hasKey: () => true,
      catchUp: async (_id, deps) => { deps?.fire?.({ baseUrl: 'http://x', diagnosticId: 'd', userId: 'u1', locale: 'ru' }); return [] },
      fanOut: (_o, d) => d.track(call),
    }).then(() => { done = true })
    await new Promise((r) => setTimeout(r, 5))
    expect(done).toBe(false)
    release()
    await p
    expect(done).toBe(true)
    let started = false
    await catchUpPaidAiAwaited('u2', { hasKey: () => false, catchUp: async () => { started = true; return [] } })
    expect(started).toBe(false)
  })
})

describe('verify Н-3: setPlan({ catchUpAi: false }) starts no per-client catch-up (the bulk runs one bounded batch)', () => {
  function svc() {
    const chain = (data: unknown) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q
      q.maybeSingle = async () => ({ data, error: null })
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
      return q
    }
    return {
      from: (t: string) => chain(t === 'profiles' ? { id: CLIENT, tier: 'free' } : null),
      rpc: async () => ({ data: { applied: true, after: null, profile_tier: 'pro' }, error: null }),
    }
  }
  it('default → one background catch-up; catchUpAi:false → none', async () => {
    const { setPlan } = await import('@/lib/payments/billing')
    const actor = { id: STAFF, kind: 'session' as const }
    await setPlan({ userId: CLIENT, tier: 'pro', source: 'admin', actor }, svc() as never)
    await new Promise((r) => setTimeout(r, 5))
    expect(s.background).toEqual(['paid-ai-catch-up'])
    s.background = []
    await setPlan({ userId: CLIENT, tier: 'pro', source: 'admin', actor, catchUpAi: false }, svc() as never)
    await new Promise((r) => setTimeout(r, 5))
    expect(s.background).toEqual([])
  })
})

describe('verify Н-4: the bulk dialog says what the plan change does', () => {
  it('Free warns that paid subscriptions (Kaspi included) are cancelled; Pro — open-ended, requests closed, notice', async () => {
    const { bulkTierNote } = await import('@/lib/admin/bulk-users-shared')
    expect(bulkTierNote('free')).toContain('будут отменены')
    expect(bulkTierNote('free')).toContain('Kaspi')
    expect(bulkTierNote('pro')).toContain('бессрочно')
    expect(bulkTierNote('pro')).toContain('«Доступ открыт»')
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('components/giga-panel/UsersBulkBar.tsx', 'utf8')).toContain("{action === 'set_tier' && <p")
  })
})
