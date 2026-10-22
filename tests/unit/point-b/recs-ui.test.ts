/**
 * Client «Рекомендации» tab, the invite cards and «Следующий шаг» of the «Обзор» (plan Ф6a Task 7). The repo has no
 * jsdom, so the behaviour lives in framework-free modules (recsModel.ts, inviteController.ts, pointBStateController.ts)
 * driven with a fetch double, and the markup is checked with react-dom/server. The state route and the invite route
 * are built separately (plan Task 6): the doubles follow the contract of the plan.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureInvites, fixtureModelResult, fixtureNextStep, fixtureRecommendations } from '@/lib/point-b/fixtures'
import type { InviteView } from '@/lib/point-b/invites/types'
import { POINT_B_TABS, isTabKey, type PointBPlanState } from '@/components/point-b/overviewModel'
import { PointBStateController, type PointBStateSnapshot } from '@/components/point-b/pointBStateController'
import { InviteController } from '@/components/point-b/inviteController'
import {
  EMPTY_RECS, RECS_EMPTY_NONE, RECS_EMPTY_PREPARING, RECS_HONEST_TEXT, linkTarget, nextStepTarget, parseInvites, parseRecommendations,
  pendingText, recsMode, reviewedBadge,
} from '@/components/point-b/recsModel'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string }) => React.createElement('a', { href: p.href, className: p.className }, p.children) }))

const { RecommendationsView, default: RecommendationsTab } = await import('@/components/point-b/tabs/RecommendationsTab')
const { OverviewView } = await import('@/components/point-b/tabs/OverviewTab')
const { default: NextStepCard } = await import('@/components/point-b/NextStepCard')

const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')
const result = fixtureModelResult('level2')
const PLAN: PointBPlanState = { status: 'published', version: 2, selectedScenario: 'moderate', scenarios: result.scenarios, approvedAt: '2026-10-14T10:00:00.000Z', authorName: 'Анна Ким' }
const snapOf = (over: Partial<PointBStateSnapshot> = {}): PointBStateSnapshot => ({ phase: 'ready', error: null, result, plan: PLAN, ...over })
const recsHtml = (snap: PointBStateSnapshot) => flat(renderToStaticMarkup(React.createElement(RecommendationsTab, { snap })))

/** What a careless server could send: pending / rejected / never-verified items with their texts. */
const LEAKY = {
  verified: [
    ...fixtureRecommendations().verified,
    { ...fixtureRecommendations().verified[0], id: 'p-1', title: 'ТЕКСТ НА ПРОВЕРКЕ', essence: 'секрет черновика', state: 'pending_review' },
    { ...fixtureRecommendations().verified[0], id: 'x-1', title: 'ОТКЛОНЁННЫЙ ТЕКСТ', state: 'expert_rejected' },
    { ...fixtureRecommendations().verified[0], id: 'n-1', title: 'БЕЗ СТАТУСА', state: undefined },
  ],
  pending: [{ id: 'p-2', title: 'ЕЩЁ ОДИН ЧЕРНОВИК' }],
  pendingCount: 2,
}

// ── the fixtures themselves ─────────────────────────────────────────────

describe('Ф6a fixtures', () => {
  it('two verified recommendations (one stale, previously verified), a pending count, three invites incl. one modal, a next step', () => {
    const recs = fixtureRecommendations()
    expect(recs.verified.map((r) => r.state)).toEqual(['verified', 'stale'])
    expect(recs.verified.every((r) => r.reviewerName && r.reviewedAt && r.scopeNote)).toBe(true)
    expect(recs.pendingCount).toBe(2)
    const inv = fixtureInvites('level2')
    expect(inv).toHaveLength(3)
    expect(inv.filter((i) => i.display === 'modal')).toHaveLength(1)
    expect(fixtureInvites('no-goal')).toEqual([])
    expect(fixtureNextStep().recId).toBe(recs.verified[0].id)
    expect(JSON.stringify([recs, inv])).not.toMatch(/NaN|Infinity|undefined/)
    // the invite texts quote the model's own numbers
    expect(inv[1].body).toContain('120 млн ₸')
  })
})

// ── «Рекомендации» ──────────────────────────────────────────────────────

describe('«Рекомендации»', () => {
  it('verified recommendations show the expert name, specialty, date and the scope note', () => {
    const html = recsHtml(snapOf({ recommendations: fixtureRecommendations() }))
    expect(html).toContain('Проверено экспертом · Анна Ким · Эксперт по продажам · 16 октября 2026')
    expect(html).toContain('Область применимости:</span> Для плана v2, данные на 14 октября 2026')
    for (const label of ['Суть', 'Причина', 'Ожидаемый результат', 'Ресурсы', 'Уверенность', 'Риски', 'Следующее действие']) expect(html).toContain(`>${label}</dt>`)
    expect(html).toContain('Средняя — Конверсия известна из анкеты')
    // «Почему вы это видите» with the sources
    expect(html).toContain('Почему вы это видите')
    expect(html).toContain('Конверсия в оплату — 12%')
    expect(html).toContain('Снимок Точки А:')
    // the honest line of the tab
    expect(html).toContain(RECS_HONEST_TEXT)
    expect(reviewedBadge({ reviewerName: null, reviewerSpecialty: null, reviewedAt: null })).toBe('Проверено экспертом')
  })

  it('stale ones are greyed with «Требует обновления»', () => {
    const html = recsHtml(snapOf({ recommendations: fixtureRecommendations() }))
    const stale = html.slice(html.indexOf('data-state="stale"'))
    expect(html.indexOf('data-state="verified"')).toBeLessThan(html.indexOf('data-state="stale"'))
    expect(stale).toContain('Требует обновления')
    expect(stale).toMatch(/opacity-75/)
    expect(stale).toContain('Проверено экспертом · Анна Ким')
  })

  it('pending recommendations are never rendered, only the count', async () => {
    // the parser keeps only verified / stale, whatever the server sends
    const parsed = parseRecommendations(LEAKY)!
    expect(parsed.verified.map((r) => r.id)).toEqual(fixtureRecommendations().verified.map((r) => r.id))
    expect(parsed.pendingCount).toBe(2)
    // …and through the state controller too
    const body = { ok: true, data: { access: 'ok', overview: { result, labelledAutomatic: true }, plan: { status: 'published' }, recommendations: LEAKY } }
    const ctl = new PointBStateController((async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch)
    await ctl.load()
    const html = recsHtml(ctl.getSnapshot())
    for (const secret of ['ТЕКСТ НА ПРОВЕРКЕ', 'секрет черновика', 'ОТКЛОНЁННЫЙ ТЕКСТ', 'БЕЗ СТАТУСА', 'ЕЩЁ ОДИН ЧЕРНОВИК']) expect(html).not.toContain(secret)
    expect(html).toContain('2 рекомендации на проверке у эксперта')
    expect(pendingText(1)).toBe('1 рекомендация на проверке у эксперта')
    expect(pendingText(5)).toBe('5 рекомендаций на проверке у эксперта')
    expect(pendingText(0)).toBeNull()
  })

  it('empty states', () => {
    const preparing = recsHtml(snapOf({ recommendations: { verified: [], pendingCount: 3 } }))
    expect(preparing).toContain(RECS_EMPTY_PREPARING)
    expect(preparing).toContain('3 рекомендации на проверке у эксперта')
    expect(preparing).toContain(RECS_HONEST_TEXT)
    const none = recsHtml(snapOf({ recommendations: { verified: [], pendingCount: 0 } }))
    expect(none).toContain(RECS_EMPTY_NONE)
    // the server did not send the field (migration 129 not applied) → the honest empty state, not a crash
    expect(recsHtml(snapOf())).toContain(RECS_EMPTY_NONE)
    expect(recsMode({ phase: 'loading' })).toBe('loading')
    expect(recsMode({ phase: 'error' })).toBe('error')
    expect(recsHtml(snapOf({ phase: 'loading', result: null }))).toContain('aria-busy="true"')
    expect(recsHtml(snapOf({ phase: 'error', result: null, error: 'Сервис недоступен' }))).toContain('Сервис недоступен')
    expect(flat(renderToStaticMarkup(React.createElement(RecommendationsView, { recs: EMPTY_RECS })))).not.toContain('<li')
  })
})

// ── «Обзор»: next step and invites ──────────────────────────────────────

describe('«Обзор»', () => {
  const four: InviteView[] = [...fixtureInvites('level2'), { ...fixtureInvites('level2')[2], id: 'inv-4', title: 'ЧЕТВЁРТАЯ' }]

  it('next step card and up to 3 invite cards on the overview', () => {
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result, plan: PLAN, invites: four, nextStep: fixtureNextStep() })))
    expect(html).toContain('Следующий шаг')
    expect(html).toContain('Собрать единый скрипт продаж')
    expect(html).toContain('Открыть рекомендацию')
    expect(html).toContain('Из рекомендации, проверенной экспертом')
    // three cards, the fourth never
    expect(html.match(/aria-labelledby="pb-invite-/g)).toHaveLength(3)
    expect(html).not.toContain('ЧЕТВЁРТАЯ')
    for (const t of ['Почему вы это видите', 'Позже', '3 дня', '7 дней', '30 дней', 'Закрыть', 'Открыть стратегию']) expect(html).toContain(t)
    expect(html).toContain('Подсказка платформы · не проверена экспертом')
    // the next step comes before the invites
    expect(html.indexOf('pb-next-step')).toBeLessThan(html.indexOf('pb-invites'))
    expect(parseInvites(four)).toHaveLength(3)

    // nothing to show → neither block
    const bare = flat(renderToStaticMarkup(React.createElement(OverviewView, { result, plan: PLAN })))
    expect(bare).not.toContain('pb-next-step')
    expect(bare).not.toContain('pb-invites')
  })

  it('the next step leads to the right tab', () => {
    expect(nextStepTarget({ title: 'x', action: null, recId: 'r' })).toEqual({ tab: 'recs' })
    expect(nextStepTarget({ title: 'x', action: null, recId: null })).toEqual({ tab: 'strategy' })
    expect(nextStepTarget({ title: 'x', action: 'whatif', recId: null })).toEqual({ tab: 'whatif' })
    const task = flat(renderToStaticMarkup(React.createElement(NextStepCard, { step: { title: 'Описать условия программы', action: null, recId: null } })))
    expect(task).toContain('Открыть стратегию')
    expect(task).toContain('Ближайшая задача вашего плана')
    expect(renderToStaticMarkup(React.createElement(NextStepCard, { step: null }))).toBe('')
    // a deep link into the page switches the tab; another same-site link is followed; a foreign one is ignored
    expect(linkTarget('/client/point-b?tab=whatif')).toEqual({ tab: 'whatif' })
    expect(linkTarget('/client/messages')).toEqual({ href: '/client/messages' })
    expect(linkTarget('https://evil.example/x')).toBeNull()
    expect(linkTarget('//evil.example/x')).toBeNull()
  })

  it('invite actions send the right PATCH and remove the card', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    let fail = false
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return fail
        ? { ok: false, status: 403, json: async () => ({ ok: false, error: 'Нельзя менять в режиме «от имени»' }) }
        : { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    const ctl = new InviteController(fetchFn as unknown as typeof fetch, four)
    const [a, b, c] = fixtureInvites('level2').map((i) => i.id)
    expect(ctl.getSnapshot().invites.map((i) => i.id)).toEqual([a, b, c])

    await ctl.markSeen()
    await ctl.markSeen()
    expect(calls.filter((x) => (x.body as { action: string }).action === 'seen')).toHaveLength(3)
    expect(calls[0]).toEqual({ url: `/api/v1/point-b/invites/${a}`, method: 'PATCH', body: { action: 'seen' } })

    calls.length = 0
    await ctl.dismiss(a)
    expect(calls).toEqual([{ url: `/api/v1/point-b/invites/${a}`, method: 'PATCH', body: { action: 'dismiss' } }])
    // the 4th card moves up to keep three on the page
    expect(ctl.getSnapshot().invites.map((i) => i.id)).toEqual([b, c, 'inv-4'])

    await ctl.snooze(b, 7)
    expect(calls.at(-1)).toEqual({ url: `/api/v1/point-b/invites/${b}`, method: 'PATCH', body: { action: 'snooze', days: 7 } })
    await ctl.act(c)
    expect(calls.at(-1)?.body).toEqual({ action: 'acted' })
    expect(ctl.getSnapshot().invites.map((i) => i.id)).toEqual(['inv-4'])
    // days other than 3 / 7 / 30 never reach the server
    expect(await ctl.snooze('inv-4', 5 as never)).toBe(false)
    expect(calls).toHaveLength(3)

    // a reload of the page state does not bring back a card the user took away
    ctl.setInvites(four)
    expect(ctl.getSnapshot().invites.map((i) => i.id)).toEqual(['inv-4'])

    // a refusal brings the card back with the server's text
    fail = true
    expect(await ctl.dismiss('inv-4')).toBe(false)
    expect(ctl.getSnapshot()).toMatchObject({ busy: null, error: 'Нельзя менять в режиме «от имени»' })
    expect(ctl.getSnapshot().invites.map((i) => i.id)).toEqual(['inv-4'])
  })
})

// ── tabs and the state ──────────────────────────────────────────────────

describe('tabs and state', () => {
  it('tab order includes Рекомендации', () => {
    expect(POINT_B_TABS.map((t) => t.label)).toEqual(['Обзор', 'Сценарии', 'Стратегия', 'Дорожная карта', 'Рекомендации', 'План-факт и история', 'Что если', 'Финмодель', 'Подробности'])
    expect(isTabKey('recs')).toBe(true)
  })

  it('the state controller reads recommendations, invites and the next step; absent fields are empty', async () => {
    const make = (extra: Record<string, unknown>) => new PointBStateController((async () => ({
      ok: true, status: 200, json: async () => ({ ok: true, data: { access: 'ok', overview: { result, labelledAutomatic: true }, plan: { status: 'published' }, ...extra } }),
    })) as unknown as typeof fetch)
    const full = make({ recommendations: fixtureRecommendations(), invites: fixtureInvites('level2'), nextStep: fixtureNextStep() })
    await full.load()
    expect(full.getSnapshot()).toMatchObject({ phase: 'ready', recommendations: fixtureRecommendations(), invites: fixtureInvites('level2'), nextStep: fixtureNextStep() })
    const old = make({})
    await old.load()
    expect(old.getSnapshot()).toMatchObject({ phase: 'ready', recommendations: null, invites: [], nextStep: null })
  })
})
