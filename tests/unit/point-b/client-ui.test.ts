/**
 * Client plan UI and the admin approval queue (plan Phase 1 Task 10). No jsdom in the repo:
 * the owner-side behaviour is a framework-free controller (components/point-b/planController.ts)
 * driven with a fetch double, markup is checked with react-dom/server. The routes of plan
 * Task 7 (GET /api/v1/point-b/plan, POST …/goals/:id/respond) are not built yet — the doubles
 * follow the contract written in the plan.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GIGA_BASE, GIGA_NAV, SUPER_EXPERT_BASE, gigaSectionTitle, visibleNav } from '@/lib/admin/nav'
import { STAFF_ROLES, hasPermission } from '@/lib/admin/rbac'
import { ClientPlanController, parseClientPlan, type ClientPlanSnapshot } from '@/components/point-b/planController'
import { parseQueue, userPointBHref, waitingLabel } from '@/components/giga-panel/pages/pointBQueueModel'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string }) => React.createElement('a', { href: p.href, className: p.className }, p.children) }))

const { default: PlanStatusBanner } = await import('@/components/point-b/PlanStatusBanner')
const { default: GoalCorrectionCard } = await import('@/components/point-b/GoalCorrectionCard')
const { PlanWorkflowView } = await import('@/components/point-b/PlanWorkflowSection')
const { PointBQueueView } = await import('@/components/giga-panel/pages/PointBQueuePage')

const version = { number: 3, approvedAt: '2026-10-10T12:00:00.000Z', expertNotes: 'Фокус на конверсии', authorName: 'Анна Ким' }
const review = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', metricKey: 'biz.finansy.vyruchka_god', metricLabel: 'Выручка за 12 месяцев', status: 'corrected', from: 120_000_000, to: 90_000_000,
  reason: 'Цель нереалистична при текущей конверсии', createdAt: '2026-10-12T09:00:00.000Z', ...over,
})
const planBody = (status: string, reviews: unknown[] = [], v: unknown = null) => ({ ok: true, data: { status, version: v, goalReviews: reviews } })

interface Call { method: string; url: string; body: unknown }
function harness(get: unknown, respond: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return { ok: true, status: 200, json: async () => get }
    return { ok: respond.status < 400, status: respond.status, json: async () => respond.body }
  })
  return { ctl: new ClientPlanController(fetchFn as unknown as typeof fetch), calls }
}

const section = (snap: ClientPlanSnapshot, ctl: ClientPlanController) => renderToStaticMarkup(React.createElement(PlanWorkflowView, { snap, ctl }))

describe('PlanStatusBanner', () => {
  it('shows «Эксперт готовит план» while preparing', () => {
    const html = renderToStaticMarkup(React.createElement(PlanStatusBanner, { status: 'preparing', version: null }))
    expect(html).toContain('Эксперт готовит план')
    expect(html).toContain('aria-label="Статус плана"')
  })

  it('shows «План v{N} одобрен {дата}» once published', () => {
    const html = renderToStaticMarkup(React.createElement(PlanStatusBanner, { status: 'published', version }))
    expect(html).toContain('План v3 одобрен')
    expect(html).toContain('октября 2026')
    expect(html).toContain('Подготовил: Анна Ким')
  })

  it('shows nothing for none', () => {
    expect(renderToStaticMarkup(React.createElement(PlanStatusBanner, { status: 'none', version: null }))).toBe('')
  })

  it('a published plan without version details still says it is approved', () => {
    expect(renderToStaticMarkup(React.createElement(PlanStatusBanner, { status: 'published', version: null }))).toContain('План одобрен')
  })
})

describe('GoalCorrectionCard', () => {
  it('shows from, to and the reason with the two answers', () => {
    const t = harness(planBody('published', [review()], version))
    return t.ctl.load().then(() => {
      const c = t.ctl.getSnapshot().corrections[0]
      const html = renderToStaticMarkup(React.createElement(GoalCorrectionCard, { correction: c, busy: false, error: null, onRespond: () => {} }))
      expect(html).toContain('Эксперт предлагает изменить цель')
      expect(html).toContain('Выручка за 12 месяцев')
      expect(html).toContain((120_000_000).toLocaleString('ru-RU'))
      expect(html).toContain('→')
      expect(html).toContain((90_000_000).toLocaleString('ru-RU'))
      expect(html).toContain('Причина: Цель нереалистична при текущей конверсии')
      expect(html).toContain('Согласен')
      expect(html).toContain('Не согласен')
      expect(html).toContain('Пока вы не ответите, цель остаётся прежней.')
    })
  })

  it('posts accept / dispute and then the card disappears', async () => {
    const t = harness(planBody('published', [review({ id: 'r-1' }), review({ id: 'r-2', metricLabel: 'Прибыль', from: 10, to: 5 })], version))
    await t.ctl.load()
    expect(t.ctl.getSnapshot().corrections.map((c) => c.id)).toEqual(['r-1', 'r-2'])

    expect(await t.ctl.respond('r-1', true)).toBe(true)
    expect(await t.ctl.respond('r-2', false)).toBe(true)
    const posts = t.calls.filter((c) => c.method === 'POST')
    expect(posts).toEqual([
      { method: 'POST', url: '/api/v1/point-b/goals/r-1/respond', body: { accept: true } },
      { method: 'POST', url: '/api/v1/point-b/goals/r-2/respond', body: { accept: false } },
    ])
    const snap = t.ctl.getSnapshot()
    expect(snap.corrections).toEqual([])
    expect(section(snap, t.ctl)).not.toContain('Эксперт предлагает изменить цель')
  })

  it('only corrections waiting for an answer become cards (agreed, disputed, verified do not)', () => {
    const p = parseClientPlan(planBody('published', [review({ id: 'a', status: 'agreed' }), review({ id: 'b', status: 'disputed' }), review({ id: 'c', status: 'verified' }), review({ id: 'd' })], version))
    expect(p?.corrections.map((c) => c.id)).toEqual(['d'])
  })

  it('keeps the card and shows the server text when the answer fails; blocks a double click', async () => {
    const t = harness(planBody('published', [review()], version), { status: 403, body: { ok: false, error: 'В режиме «от имени» отвечать нельзя' } })
    await t.ctl.load()
    const first = t.ctl.respond('r-1', true)
    expect(await t.ctl.respond('r-1', true)).toBe(false) // already in flight
    expect(await first).toBe(false)
    const snap = t.ctl.getSnapshot()
    expect(snap.corrections).toHaveLength(1)
    expect(snap.errors['r-1']).toBe('В режиме «от имени» отвечать нельзя')
    expect(snap.responding).toEqual([])
    expect(t.calls.filter((c) => c.method === 'POST')).toHaveLength(1)

    const html = renderToStaticMarkup(React.createElement(GoalCorrectionCard, { correction: snap.corrections[0], busy: false, error: snap.errors['r-1'], onRespond: () => {} }))
    expect(html).toContain('В режиме «от имени» отвечать нельзя')
    expect(html).toContain('role="alert"')
  })

  it('a network failure on answering says so', async () => {
    const ctl = new ClientPlanController((async (_u: string, init?: RequestInit) => {
      if (!init?.method) return { ok: true, status: 200, json: async () => planBody('published', [review()], version) }
      throw new Error('offline')
    }) as unknown as typeof fetch)
    await ctl.load()
    await ctl.respond('r-1', true)
    expect(ctl.getSnapshot().errors['r-1']).toContain('Нет связи с сервером')
  })

  it('disables the buttons while the answer is in flight', () => {
    const html = renderToStaticMarkup(React.createElement(GoalCorrectionCard, {
      correction: { id: 'r-1', metricLabel: 'Выручка', from: 1, to: 2, reason: null, createdAt: null }, busy: true, error: null, onRespond: () => {},
    }))
    expect(html.match(/disabled=""/g)?.length).toBe(2)
    expect(html).toContain('Отправляем ответ')
    expect(html).not.toContain('Причина:')
  })
})

describe('PlanWorkflowView', () => {
  it('no cards and no banner for none; nothing before the answer is in or when the request fails', async () => {
    const none = harness(planBody('none'))
    await none.ctl.load()
    expect(section(none.ctl.getSnapshot(), none.ctl)).toBe('')

    expect(section(new ClientPlanController(vi.fn() as unknown as typeof fetch).getSnapshot(), none.ctl)).toBe('')

    const failing = new ClientPlanController((async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) })) as unknown as typeof fetch)
    await failing.load()
    expect(failing.getSnapshot().loaded).toBe(false)
    expect(section(failing.getSnapshot(), failing)).toBe('')

    const thrown = new ClientPlanController((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await thrown.load()
    expect(section(thrown.getSnapshot(), thrown)).toBe('')
  })

  it('a client without a company or a plan gets the empty answer, not an error', () => {
    expect(parseClientPlan({ ok: true, data: { status: 'none', version: null, goalReviews: [] } })).toEqual({ status: 'none', version: null, corrections: [] })
    expect(parseClientPlan({ ok: false, error: 'x' })).toBeNull()
    expect(parseClientPlan(null)).toBeNull()
  })

  it('preparing shows the banner, a correction shows its card above it', async () => {
    const t = harness(planBody('preparing', [review()]))
    await t.ctl.load()
    const html = section(t.ctl.getSnapshot(), t.ctl)
    expect(html).toContain('Эксперт готовит план')
    expect(html).toContain('Эксперт предлагает изменить цель')
    expect(html.indexOf('Эксперт предлагает')).toBeLessThan(html.indexOf('Эксперт готовит план'))
  })

  it('a correction still shows when the status is none', async () => {
    const t = harness(planBody('none', [review()]))
    await t.ctl.load()
    expect(section(t.ctl.getSnapshot(), t.ctl)).toContain('Эксперт предлагает изменить цель')
  })
})

describe('admin queue', () => {
  const rows = parseQueue({
    ok: true,
    data: [
      { versionId: 'v-1', version: 2, userId: 'u-1', clientName: 'Иван Петров', companyName: 'Ромашка', authorName: 'Анна Ким', submittedAt: '2026-10-17T09:00:00Z', waitingDays: 1 },
      { versionId: 'v-2', version: 1, userId: 'u-2', clientName: 'Мария Ли', companyName: null, authorName: null, submittedAt: '2026-10-08T09:00:00Z', waitingDays: 10 },
    ],
  })
  const queue = (over: Partial<React.ComponentProps<typeof PointBQueueView>> = {}) =>
    renderToStaticMarkup(React.createElement(PointBQueueView, { base: GIGA_BASE, label: 'GIGA-CRM', rows, loading: false, error: null, onRetry: () => {}, ...over }))

  it('renders a row per version, longest wait first, linked to the client\'s Точка Б tab', () => {
    expect(rows.map((r) => r.versionId)).toEqual(['v-2', 'v-1'])
    const html = queue()
    expect(html).toContain('Иван Петров')
    expect(html).toContain('Ромашка')
    expect(html).toContain('v2')
    expect(html).toContain('Анна Ким')
    expect(html).toContain('10 дней')
    expect(html).toContain('1 день')
    expect(html).toContain(`href="${GIGA_BASE}/users/u-1?tab=point-b"`)
    expect(html).toContain('<th')
  })

  it('renders an empty state', () => {
    const html = queue({ rows: [] })
    expect(html).toContain('Очередь пуста')
    expect(html).not.toContain('<td')
  })

  it('shows the server error with a retry instead of a table', () => {
    const html = queue({ rows: null, error: { message: 'Недостаточно прав', status: 403 } })
    expect(html).toContain('Недостаточно прав')
    expect(html).not.toContain('<table')
  })

  it('words the wait in Russian and builds links for either workspace', () => {
    expect([0, 1, 2, 4, 5, 11, 12, 21, 22, 25].map(waitingLabel)).toEqual(['сегодня', '1 день', '2 дня', '4 дня', '5 дней', '11 дней', '12 дней', '21 день', '22 дня', '25 дней'])
    expect(userPointBHref(SUPER_EXPERT_BASE, 'u-9')).toBe('/super-expert/users/u-9?tab=point-b')
  })

  it('computes the wait from submittedAt when the server gives no age, and skips broken items', () => {
    const now = Date.parse('2026-10-18T10:00:00Z')
    const parsed = parseQueue({ data: { items: [
      { id: 'v-1', version_number: 4, user_id: 'u-1', client_name: 'А', submitted_at: '2026-10-15T09:00:00Z' },
      { id: 'no-user' },
      null,
    ] } }, now)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ versionId: 'v-1', version: 4, clientName: 'А', waitingDays: 3 })
    expect(parseQueue(undefined)).toEqual([])
  })
})

describe('navigation entry', () => {
  const entry = GIGA_NAV.flatMap((g) => g.items).find((i) => i.href === `${GIGA_BASE}/point-b-queue`)

  it('is «Точка Б — на одобрении» behind clients.review, with no live badge', () => {
    expect(entry).toMatchObject({ label: 'Точка Б — на одобрении', permission: 'clients.review' })
    expect(entry?.badge).toBeUndefined()
    expect(gigaSectionTitle(`${GIGA_BASE}/point-b-queue`)).toBe('Точка Б — на одобрении')
  })

  it('is visible exactly to the roles that hold clients.review', () => {
    for (const role of STAFF_ROLES) {
      const visible = visibleNav(GIGA_NAV, (p) => hasPermission(role, p)).flatMap((g) => g.items).some((i) => i.href === entry!.href)
      expect(visible, role).toBe(hasPermission(role, 'clients.review'))
    }
    expect(STAFF_ROLES.some((r) => hasPermission(r, 'clients.review'))).toBe(true)
    expect(STAFF_ROLES.some((r) => !hasPermission(r, 'clients.review'))).toBe(true)
  })
})
