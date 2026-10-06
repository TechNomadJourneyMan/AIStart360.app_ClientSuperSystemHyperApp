/**
 * Point A clarifying questions — honest states:
 *   #49 / GAP-05(a) a failed feed load is an error with «Повторить», never
 *       «0 обсуждений» / «нет обсуждений» (page and the /point-a feed);
 *   #72 / GAP-05(b) a save error shows even when the feed is empty;
 *   #73 a failed inline answer keeps the typed text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({
  feed: { items: [] as unknown[], loading: false, loadError: null as string | null },
  actionsError: null as string | null,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/components/point-a/v2/useInsightsFeed', async (orig) => ({
  ...(await orig<typeof import('@/components/point-a/v2/useInsightsFeed')>()),
  useInsightsFeed: () => ({ ...s.feed, setItems: () => {}, reload: () => {} }),
}))
vi.mock('@/hooks/usePointAInsightActions', () => ({
  usePointAInsightActions: () => ({
    create: async () => null, confirm: async () => null, answer: async () => null,
    pendingId: null, error: s.actionsError, clearError: () => {},
  }),
}))

import InsightsPage from '@/app/(dashboard)/point-a/insights/page'
import { InsightsFeed } from '@/components/point-a/v2/InsightsFeed'
import { submitAnswerDraft } from '@/components/point-a/v2/InsightItem'
import { fetchInsightsFeed, INSIGHTS_LOAD_ERROR, INSIGHTS_SESSION_ERROR } from '@/components/point-a/v2/useInsightsFeed'

beforeEach(() => {
  s.feed = { items: [], loading: false, loadError: null }
  s.actionsError = null
})

const res = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('fetchInsightsFeed', () => {
  it('turns every failure into an error, and only a real answer into items', async () => {
    expect(await fetchInsightsFeed(10, res(500, { ok: false }))).toEqual({ ok: false, error: INSIGHTS_LOAD_ERROR })
    expect(await fetchInsightsFeed(10, res(401, { ok: false }))).toEqual({ ok: false, error: INSIGHTS_SESSION_ERROR })
    expect(await fetchInsightsFeed(10, res(200, { ok: false }))).toEqual({ ok: false, error: INSIGHTS_LOAD_ERROR })
    expect(await fetchInsightsFeed(10, (async () => { throw new TypeError('network') }) as unknown as typeof fetch)).toEqual({ ok: false, error: INSIGHTS_LOAD_ERROR })
    expect(await fetchInsightsFeed(10, res(200, { ok: true, data: { items: [] } }))).toEqual({ ok: true, items: [] })
  })
})

describe('/point-a/insights page', () => {
  it('a failed load shows the error with a retry, not zero discussions', () => {
    s.feed.loadError = INSIGHTS_LOAD_ERROR
    const html = renderToStaticMarkup(createElement(InsightsPage))
    expect(html).toContain(INSIGHTS_LOAD_ERROR)
    expect(html).toContain('Повторить')
    expect(html).not.toContain('0 обсуждений')
    expect(html).not.toContain('Все · 0')
    expect(html).not.toContain('нет обсуждений')
  })

  it('a really empty feed still says so', () => {
    const html = renderToStaticMarkup(createElement(InsightsPage))
    expect(html).toContain('0 обсуждений')
    expect(html).toContain('По выбранным фильтрам нет обсуждений.')
  })

  it('a save error is shown on an empty feed too (#72)', () => {
    s.actionsError = 'Сессия истекла — войдите заново'
    const html = renderToStaticMarkup(createElement(InsightsPage))
    expect(html).toContain('Сессия истекла — войдите заново')
  })
})

describe('InsightsFeed on /point-a and /dashboard', () => {
  it('a failed load shows the error with a retry, not «0 без ответа» / «Нет вопросов»', () => {
    s.feed.loadError = INSIGHTS_LOAD_ERROR
    const html = renderToStaticMarkup(createElement(InsightsFeed))
    expect(html).toContain(INSIGHTS_LOAD_ERROR)
    expect(html).toContain('Повторить')
    expect(html).not.toContain('0 без ответа')
    expect(html).not.toContain('Нет вопросов по выбранному фильтру')
  })
})

describe('inline answer (#73)', () => {
  it('keeps the draft when the save failed and clears it when it succeeded', async () => {
    const done = vi.fn()
    expect(await submitAnswerDraft('i1', '  Выручка 12 млн  ', async () => false, done)).toBe(false)
    expect(done).not.toHaveBeenCalled()
    const save = vi.fn(async () => true)
    expect(await submitAnswerDraft('i1', '  Выручка 12 млн  ', save, done)).toBe(true)
    expect(save).toHaveBeenCalledWith('i1', 'Выручка 12 млн')
    expect(done).toHaveBeenCalledTimes(1)
  })
})
