/**
 * Client «Обзор» and «Сценарии» tabs (plan Phase 2 Task 8). The repo has no jsdom, so the
 * behaviour lives in framework-free modules (overviewModel.ts, pointBStateController.ts) driven
 * here with a fetch double, and the markup is checked with react-dom/server. The state route
 * (GET /api/v1/point-b/state) is built separately: the doubles follow the contract of the plan.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureModelResult, fixturePointB, POINT_B_FIXTURE_VARIANTS } from '@/lib/point-b/fixtures'
import type { ModelResult, ScenarioResult } from '@/lib/point-b/model/types'
import {
  VERDICT_VIEW, chartData, comparisonRows, corridorGeometry, linePath, monthsRange, moneyRange, nearestPoint, nextTab,
  parsePointBState, scenarioCards, scenariosMode, verdictView, type CorridorChartData, type PointBPlanState,
} from '@/components/point-b/overviewModel'
import { PointBStateController, type PointBStateSnapshot } from '@/components/point-b/pointBStateController'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string }) => React.createElement('a', { href: p.href, className: p.className }, p.children) }))

const { OverviewView, default: OverviewTab } = await import('@/components/point-b/tabs/OverviewTab')
const { default: ScenariosTab } = await import('@/components/point-b/tabs/ScenariosTab')
const { default: PointBTabs } = await import('@/components/point-b/tabs/PointBTabs')
const { default: CorridorChart } = await import('@/components/point-b/CorridorChart')
const { default: PointBView } = await import('@/components/point-b/PointBView')

const NO_PLAN: PointBPlanState = { status: 'none', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null }
const published = (result: ModelResult): PointBPlanState => ({ status: 'published', version: 2, selectedScenario: 'moderate', scenarios: result.scenarios, approvedAt: '2026-10-14T10:00:00.000Z', authorName: 'Анна Ким' })
const snapOf = (result: ModelResult, plan: PointBPlanState): PointBStateSnapshot => ({ phase: 'ready', error: null, result, plan })
const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')

describe('overviewModel', () => {
  it('maps verdict keys to a Russian headline and a tone', () => {
    expect(VERDICT_VIEW.on_track).toMatchObject({ label: 'На курсе', tone: 'good' })
    expect(VERDICT_VIEW.at_risk).toMatchObject({ label: 'Есть риск', tone: 'warn' })
    expect(VERDICT_VIEW.behind).toMatchObject({ label: 'Отстаём', tone: 'bad' })
    expect(VERDICT_VIEW.no_data).toMatchObject({ label: 'Мало данных', tone: 'neutral' })
    const r = fixtureModelResult('full')
    expect(verdictView(r)).toMatchObject({ key: 'behind', tone: 'bad', headline: r.verdict.headline, reason: r.verdict.reason })
    // the server headline wins, a missing one falls back to the default Russian text
    expect(verdictView({ ...r, verdict: { key: 'on_track', headline: '', reason: '' } }).headline).toBe(VERDICT_VIEW.on_track.headline)
  })

  it('the fixtures are consistent: low ≤ base ≤ high and non-decreasing trajectories, no NaN', () => {
    for (const v of POINT_B_FIXTURE_VARIANTS) {
      const r = fixtureModelResult(v)
      for (const s of r.scenarios) {
        s.trajectory.forEach((p, i) => {
          expect(p.low).toBeLessThanOrEqual(p.base)
          expect(p.base).toBeLessThanOrEqual(p.high)
          if (i) expect(p.base).toBeGreaterThanOrEqual(s.trajectory[i - 1].base)
        })
      }
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
    }
  })

  it('formats ranges without inventing numbers: null stays «—», zero months means reached', () => {
    expect(moneyRange({ low: null, base: null, high: null })).toEqual({ main: '—', range: null })
    expect(monthsRange({ low: null, base: null, high: null }).main).toBe('—')
    expect(monthsRange({ low: 0, base: 0, high: 0 }).main).toBe('цель уже достигнута')
    const m = monthsRange({ low: 36, base: 30, high: 25 })
    expect(m.main).toBe('≈ 30 мес.')
    expect(m.range).toBe('25–36 мес.')
  })

  it('parses the state response tolerantly and rejects a broken one', () => {
    const r = fixtureModelResult('full')
    const ok = parsePointBState({ ok: true, data: { access: 'ok', overview: { result: r, labelledAutomatic: true }, plan: { status: 'published', version: 2, selectedScenario: 'moderate', scenarios: r.scenarios, approvedAt: '2026-10-14T10:00:00Z', authorName: 'Анна' } } })
    expect(ok?.plan.scenarios).toHaveLength(3)
    expect(ok?.result.verdict.key).toBe('behind')
    // missing plan block → empty plan; unknown scenario keys and non-finite numbers are dropped
    const loose = parsePointBState({ ok: true, data: { overview: { result: { ...r, gap: { ...r.gap, baseAnnual: 'x' } } }, plan: { scenarios: [{ key: 'bogus' }, ...r.scenarios] } } })
    expect(loose?.result.gap.baseAnnual).toBeNull()
    expect(loose?.plan.status).toBe('none')
    expect(loose?.plan.scenarios).toHaveLength(3)
    expect(parsePointBState({ ok: true, data: {} })).toBeNull()
    expect(parsePointBState({ ok: false })).toBeNull()
  })

  it('tab keyboard model: arrows wrap, Home and End jump, other keys are ignored', () => {
    expect(nextTab('overview', 'ArrowRight')).toBe('scenarios')
    expect(nextTab('details', 'ArrowRight')).toBe('overview')
    expect(nextTab('overview', 'ArrowLeft')).toBe('details')
    expect(nextTab('scenarios', 'Home')).toBe('overview')
    expect(nextTab('scenarios', 'End')).toBe('details')
    expect(nextTab('scenarios', 'a')).toBeNull()
  })
})

describe('«Обзор»', () => {
  it('shows the verdict, the А → Б cells and the automatic-calculation label', () => {
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: fixtureModelResult('full'), plan: NO_PLAN })))
    expect(html).toContain('Отстаём от цели')
    for (const label of ['Сейчас', 'Цель', 'При текущем ходе', 'Разрыв']) expect(html).toContain(label)
    expect(html).toContain('Автоматический расчёт, не проверен экспертом')
    expect(html).toContain('Что делать: смотреть сценарии')
    // No approved plan → no scenarios on the page → no corridor chart, an honest hint instead.
    expect(html).not.toContain('<svg')
    expect(html).toContain('Траектория по сценариям появится после того, как эксперт одобрит план')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('the corridor chart appears from the approved plan scenarios', () => {
    const full = fixtureModelResult('full')
    const plan = { ...NO_PLAN, status: 'published' as const, version: 1, scenarios: full.scenarios, selectedScenario: 'moderate' }
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: { ...full, scenarios: [] }, plan })))
    expect(html).toContain('<svg')
    expect(html).not.toContain('Траектория по сценариям появится')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('level 0 shows the placeholder instead of the chart and lists the missing inputs with three actions', () => {
    const r = fixtureModelResult('no-goal')
    // the fixture asks for the survey and the expert; add documents to see all three buttons
    const withAll: ModelResult = { ...r, missing: [{ ...r.missing[0], actions: ['survey', 'documents', 'expert'] }] }
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: withAll, plan: NO_PLAN })))
    expect(html).not.toContain('<svg')
    expect(html).toContain('Графика пока нет')
    expect(html).toContain('Траектория появится, когда будет задана цель')
    expect(html).toContain('Цель по выручке')
    expect(html).toContain('Откроет: вердикт, прогноз и сценарии темпа')
    expect(html).toContain('href="/client/onboarding"')
    expect(html).toContain('Заполнить в анкете')
    expect(html).toContain('href="/client/onboarding/documents"')
    expect(html).toContain('Загрузить файл')
    expect(html).toContain('href="/client/messages"')
    expect(html).toContain('Попросить эксперта')
    expect(html).not.toContain('Что делать: смотреть сценарии')
  })

  it('a stale-base warning renders the banner at the top, before the verdict', () => {
    const r = fixtureModelResult('stale-base')
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: r, plan: NO_PLAN })))
    const banner = html.indexOf('Данные о выручке устарели')
    expect(banner).toBeGreaterThanOrEqual(0)
    expect(banner).toBeLessThan(html.indexOf('aria-label="Вердикт"'))
    expect(html).toContain('Выручка за 2024 год')
    // the other warnings are listed separately, the stale one is not repeated there
    expect(html.match(/Выручка за 2024 год/g)).toHaveLength(1)
    expect(html).toContain('Что учесть в расчёте')
    // and a result without the warning has no banner
    expect(flat(renderToStaticMarkup(React.createElement(OverviewView, { result: fixtureModelResult('full'), plan: NO_PLAN })))).not.toContain('Данные о выручке устарели')
  })

  it('the loading state is a skeleton and a failed load is a local retry card', () => {
    const loading: PointBStateSnapshot = { phase: 'loading', error: null, result: null, plan: NO_PLAN }
    expect(renderToStaticMarkup(React.createElement(OverviewTab, { snap: loading }))).toContain('aria-busy="true"')
    const failed: PointBStateSnapshot = { phase: 'error', error: 'Нет связи с сервером.', result: null, plan: NO_PLAN }
    const html = renderToStaticMarkup(React.createElement(OverviewTab, { snap: failed, onRetry: () => undefined }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Нет связи с сервером.')
    expect(html).toContain('Повторить')
    expect(html).toContain('«Подробности»')
  })
})

describe('CorridorChart', () => {
  const data = (): CorridorChartData => {
    const r = fixtureModelResult('full')
    return chartData(r, null)!.data
  }

  it('builds a corridor with low ≤ base ≤ high points, a target line and a deadline mark, no NaN in any path', () => {
    const d = data()
    const geo = corridorGeometry(d, 640, 260)!
    expect(geo).toBeTruthy()
    for (const p of [geo.band, geo.baseLine, geo.paceLine ?? '']) expect(p).not.toMatch(/NaN|Infinity/)
    expect(geo.targetY).not.toBeNull()
    expect(geo.deadlineX).not.toBeNull()
    // higher value → smaller y: the target line sits above the start of the base line
    const firstY = Number(geo.baseLine.split(' ')[1])
    expect(geo.targetY!).toBeLessThan(firstY)
    // the band is closed and has twice the points of the line
    expect(geo.band.endsWith('Z')).toBe(true)
    const html = flat(renderToStaticMarkup(React.createElement(CorridorChart, { data: d, scenarioLabel: 'Умеренный', placeholder: 'нет' })))
    expect(html).toContain('<svg')
    expect(html).toContain('role="img"')
    expect(html).toMatch(/Цель 120 млн ₸/)
    expect(html).toContain('срок цели')
    expect(html).toContain('При текущем ходе')
    expect(html).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('cleans bad points instead of drawing NaN: non-finite points are dropped, inverted ones are ordered', () => {
    const d: CorridorChartData = {
      points: [
        { month: 1, low: 10, base: 12, high: 14 },
        { month: 2, low: Number.NaN, base: 13, high: 15 },
        { month: 3, low: 16, base: 13, high: 12 }, // inverted: low > high
        { month: 4, low: 14, base: 15, high: 17 },
      ],
      startAnnual: 9, target: 20, goalMonths: 4, pace: null,
    }
    const geo = corridorGeometry(d, 500, 240)!
    expect(geo.band + geo.baseLine).not.toMatch(/NaN/)
    expect(linePath([[1, 2], [Number.NaN, 3]])).toBe('') // fewer than two finite points → no path
    // fewer than two usable points → no chart at all (the caller shows the placeholder)
    expect(corridorGeometry({ points: [], startAnnual: 5, target: 9, goalMonths: 3, pace: null }, 500, 240)).toBeNull()
    expect(corridorGeometry({ ...d, points: [{ month: 1, low: 1, base: 1, high: 1 }], startAnnual: null }, 500, 240)).toBeNull()
  })

  it('a pointer reads the nearest month', () => {
    const d = data()
    const geo = corridorGeometry(d, 640, 260)!
    const p = nearestPoint(d, geo, geo.plot.right)!
    expect(p.month).toBe(d.points[d.points.length - 1].month)
    expect(nearestPoint(d, geo, geo.plot.left)!.month).toBe(0)
  })

  it('shows the placeholder text when the geometry cannot be built', () => {
    const html = renderToStaticMarkup(React.createElement(CorridorChart, { data: { points: [], startAnnual: null, target: null, goalMonths: null, pace: null }, scenarioLabel: 'x', placeholder: 'Нет данных для графика' }))
    expect(html).not.toContain('<svg')
    expect(html).toContain('Нет данных для графика')
  })
})

describe('«Сценарии»', () => {
  it('without scenarios shows «Эксперт готовит сценарии» and what the owner can add', () => {
    const r = fixtureModelResult('stale-base')
    for (const plan of [NO_PLAN, { ...NO_PLAN, status: 'preparing' as const }]) {
      const html = flat(renderToStaticMarkup(React.createElement(ScenariosTab, { snap: snapOf(r, plan) })))
      expect(html).toContain('Эксперт готовит сценарии')
      expect(html).toContain('Заявки в месяц')
      expect(html).toContain('Заполнить в анкете')
      expect(html).not.toContain('Сравнение сценариев')
    }
    // an approved version without scenarios says so instead of «готовит»
    const html = flat(renderToStaticMarkup(React.createElement(ScenariosTab, { snap: snapOf(r, { ...NO_PLAN, status: 'published', version: 3 }) })))
    expect(html).toContain('В одобренном плане сценариев нет')
    expect(scenariosMode({ ...NO_PLAN, status: 'published' })).toBe('no_scenarios')
  })

  it('with scenarios shows three cards, the comparison table and a card list for the phone; the infeasible one is flagged', () => {
    const r = fixtureModelResult('full')
    const html = flat(renderToStaticMarkup(React.createElement(ScenariosTab, { snap: snapOf(r, published(r)) })))
    for (const label of ['Осторожный', 'Умеренный', 'Ускоренный']) expect(html).toContain(label)
    expect(html).toContain('План v2 одобрен')
    expect(html).toContain('подготовил Анна Ким')
    expect(html).toContain('Выбран экспертом')
    expect((html.match(/Выбран экспертом/g) ?? [])).toHaveLength(1)
    expect(html).toContain('<table')
    expect(html).toContain('Сравнение сценариев')
    expect(html).toContain('Срок выхода на цель')
    expect(html).toContain('Потребность в персонале')
    // phone layout: a card per scenario, hidden from md up
    expect(html).toContain('md:hidden')
    expect(html).toContain('aria-label="Сценарий «Ускоренный»"')
    // the infeasible scenario carries an explicit note with the reason
    expect(html).toContain('Не достижим.')
    expect(html).toContain('выше потолка ×3')
    expect(html.match(/role="note"/g)).toHaveLength(1)
    // groups are expandable details
    for (const g of ['Ограничения', 'Риски', 'Условия успеха', 'Точки пересмотра', 'Признаки, что пора менять темп']) expect(html).toContain(g)
    expect(html).toContain('<details')
    // no «choose the pace» for the owner in this phase
    expect(html).not.toContain('Выбрать темп')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('comparison rows: money, months, uplift lines and a missing CAC stay honest', () => {
    const rows = comparisonRows(fixtureModelResult('stale-base').scenarios)
    const marketing = rows.find((r) => r.key === 'marketing')!
    expect(marketing.cells.every((c) => c[0] === '—')).toBe(true)
    expect(rows.find((r) => r.key === 'staff')!.cells.every((c) => c[0] === '—')).toBe(true)
    expect(rows.find((r) => r.key === 'investNote')).toBeTruthy()
    const full = comparisonRows(fixtureModelResult('full').scenarios)
    expect(full.find((r) => r.key === 'uplift')!.cells[0].join(' ')).toMatch(/Конверсия в оплату: 12% → 14,4% \(\+20%\)/)
    expect(full.find((r) => r.key === 'feasible')!.cells.map((c) => c[0])).toEqual(['Достижим', 'Достижим', 'Не достижим'])
  })

  it('scenario cards say how much of the goal is reached by the deadline', () => {
    const r = fixtureModelResult('full')
    const cards = scenarioCards(r.scenarios, 'cautious', r.gap.targetAnnual)
    expect(cards.find((c) => c.selected)!.key).toBe('cautious')
    expect(cards[0].share).toMatch(/^\d+% цели к сроку$/)
  })
})

describe('tab shell', () => {
  const panels = { overview: React.createElement('p', null, 'ОБЗОР'), scenarios: React.createElement('p', null, 'СЦЕНАРИИ'), details: React.createElement('p', null, 'ПОДРОБНОСТИ') }

  it('is an accessible tablist: roles, aria-selected, roving tabindex, panel linked to its tab', () => {
    const html = renderToStaticMarkup(React.createElement(PointBTabs, { panels }))
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html).toMatch(/aria-selected="true"[^>]*>Обзор|Обзор<\/button>/)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2)
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('ОБЗОР')
    // only the opened tab is mounted: «Подробности» does not load until it is opened
    expect(html).not.toContain('ПОДРОБНОСТИ')
    expect(html).not.toContain('СЦЕНАРИИ')
    // the strip scrolls sideways on a phone
    expect(html).toContain('overflow-x-auto')
  })

  it('«Подробности» renders the legacy view untouched', () => {
    const legacy = React.createElement(PointBView, { pointB: fixturePointB('full'), previewMode: true })
    const alone = renderToStaticMarkup(legacy)
    const inTab = renderToStaticMarkup(React.createElement(PointBTabs, { initialTab: 'details', panels: { ...panels, details: legacy } }))
    expect(alone).toContain('Куда вы идёте')
    expect(inTab).toContain(alone)
    expect(inTab).toMatch(/<div role="tabpanel"[^>]*id="[^"]*-panel-details"/)
  })
})

describe('PointBStateController', () => {
  const okBody = () => {
    const r = fixtureModelResult('full')
    return { ok: true, data: { access: 'ok', overview: { result: r, labelledAutomatic: true }, plan: { status: 'published', version: 2, selectedScenario: 'moderate', scenarios: r.scenarios, approvedAt: '2026-10-14T10:00:00Z', authorName: 'Анна' } } }
  }
  const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch

  it('loads the state from the session-scoped route with no query', async () => {
    const f = reply(200, okBody())
    const ctl = new PointBStateController(f)
    expect(ctl.getSnapshot().phase).toBe('loading')
    await ctl.load()
    const snap = ctl.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.result?.level).toBe(1)
    expect(snap.plan.scenarios).toHaveLength(3)
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/v1/point-b/state')
  })

  it('402 locks the page; the server text, a status text and a network failure become a local error', async () => {
    const locked = new PointBStateController(reply(402, { ok: false, error: 'upgrade_required' }))
    await locked.load()
    expect(locked.getSnapshot()).toMatchObject({ phase: 'locked', result: null })

    const server = new PointBStateController(reply(500, { ok: false, error: 'Сервис расчёта недоступен' }))
    await server.load()
    expect(server.getSnapshot()).toMatchObject({ phase: 'error', error: 'Сервис расчёта недоступен' })

    const session = new PointBStateController(reply(401, { ok: false }))
    await session.load()
    expect(session.getSnapshot().error).toBe('Сессия закончилась — войдите заново')

    const net = new PointBStateController((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await net.load()
    expect(net.getSnapshot()).toMatchObject({ phase: 'error', error: 'Нет связи с сервером. Проверьте соединение и повторите.' })

    const garbled = new PointBStateController(reply(200, { ok: true, data: { overview: {} } }))
    await garbled.load()
    expect(garbled.getSnapshot().phase).toBe('error')
  })

  it('a failed reload keeps the error visible and a good one replaces it', async () => {
    let status = 500
    const f = vi.fn(async () => (status === 200 ? { ok: true, status, json: async () => okBody() } : { ok: false, status, json: async () => ({ ok: false }) })) as unknown as typeof fetch
    const ctl = new PointBStateController(f)
    const seen: string[] = []
    ctl.subscribe(() => seen.push(ctl.getSnapshot().phase))
    await ctl.load()
    expect(ctl.getSnapshot().phase).toBe('error')
    status = 200
    await ctl.load()
    expect(ctl.getSnapshot().phase).toBe('ready')
    expect(seen).toContain('loading')
  })
})

// The scenarios in the fixture must satisfy the same rules the UI relies on.
describe('scenario result shape', () => {
  it('every fixture scenario has a range with low/high around base and money fields as numbers or null', () => {
    const all: ScenarioResult[] = [...fixtureModelResult('full').scenarios, ...fixtureModelResult('stale-base').scenarios]
    for (const s of all) {
      expect(s.revenueAtDeadline.low!).toBeLessThanOrEqual(s.revenueAtDeadline.base!)
      expect(s.revenueAtDeadline.base!).toBeLessThanOrEqual(s.revenueAtDeadline.high!)
      expect(s.timeToGoalMonths.low!).toBeGreaterThanOrEqual(s.timeToGoalMonths.high!)
    }
  })
})
