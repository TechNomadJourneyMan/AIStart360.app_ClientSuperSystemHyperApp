/**
 * Point B Ф6b, Task 7: the staff «План-факт и пересчёт» panel (User 360 and the expert portal) and the reconciliation
 * block of the queue page — the controller with a fetch double (the button: «Пересчитываем…», the result and its time,
 * 429 with the next time, a reload after a recompute) and static renders (react-dom/server, no DOM).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  INITIAL_PANEL, PlanFactPanelController, expertPlanFactUrls, gigaPlanFactUrls, parseReconciliation, recomputeMessage, runLine,
} from '@/components/giga-panel/user360/point-b/planFactPanelController'
import { PlanFactPanelView } from '@/components/giga-panel/user360/point-b/PlanFactPanel'
import { ReconciliationView } from '@/components/giga-panel/pages/PointBQueuePage'
import { fixturePlanFact } from '@/lib/point-b/fixtures'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }))

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const USER = 'cccccccc-0000-4000-8000-000000000001'
const view = { ok: true, data: { published: true, planFact: fixturePlanFact('full'), runs: [{ kind: 'manual', status: 'done', startedAt: '2026-10-22T09:00:00Z', finishedAt: '2026-10-22T09:00:05Z' }] } }

describe('the staff plan-fact controller', () => {
  it('the URLs of GIGA and of the expert portal', () => {
    expect(gigaPlanFactUrls(USER)).toEqual({ view: `/api/giga-admin/users/${USER}/point-b/plan-fact`, facts: `/api/giga-admin/users/${USER}/point-b/plan-fact`, recompute: `/api/giga-admin/users/${USER}/point-b/recompute`, recomputeBody: null })
    expect(expertPlanFactUrls(USER)).toMatchObject({ recompute: `/api/expert/clients/${USER}/point-b/plan-fact`, recomputeBody: { action: 'recompute' } })
  })

  it('loads the plan-fact and the runs; an error keeps the text of the server', async () => {
    const ctl = new PlanFactPanelController(vi.fn(async () => respond(200, view)) as unknown as typeof fetch, gigaPlanFactUrls(USER))
    expect(ctl.getSnapshot()).toEqual(INITIAL_PANEL)
    await ctl.load()
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'ready', published: true, runs: [{ kind: 'manual', status: 'done' }] })
    expect(ctl.getSnapshot().planFact?.current?.period).toBe('2026-09')
    const bad = new PlanFactPanelController(vi.fn(async () => respond(403, { ok: false, error: 'Клиент назначен другому эксперту' })) as unknown as typeof fetch, gigaPlanFactUrls(USER))
    await bad.load()
    expect(bad.getSnapshot()).toMatchObject({ phase: 'error', error: 'Клиент назначен другому эксперту' })
  })

  it('the button: running → the result with its time → the plan-fact read again', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (init?.method === 'POST') {
        await gate
        return respond(200, { ok: true, data: { status: 'done', period: '2026-09', overall: 'behind', computedAt: '2026-10-22T09:05:00.000Z', draft: { created: true, version: 3 } } })
      }
      return respond(200, view)
    })
    const ctl = new PlanFactPanelController(f as unknown as typeof fetch, expertPlanFactUrls(USER))
    const p = ctl.recompute()
    expect(ctl.getSnapshot().recompute.phase).toBe('running')
    await ctl.recompute() // a second press while running does nothing
    release()
    await p
    expect(calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
    expect(JSON.parse(String(calls[0][1]!.body))).toEqual({ action: 'recompute' })
    expect(ctl.getSnapshot().recompute).toMatchObject({ phase: 'done', at: '2026-10-22T09:05:00.000Z' })
    expect(ctl.getSnapshot().recompute.message).toBe('Отстаём за сентябрь 2026; создан черновик пересмотра (версия 3) — проверьте и отправьте на одобрение')
    expect(ctl.resultTime()).toMatch(/^\d{2}:\d{2}$/)
    expect(calls.at(-1)![0]).toBe(`/api/expert/clients/${USER}/point-b/plan-fact`) // read again
    expect(ctl.getSnapshot().phase).toBe('ready')
  })

  it('429 names the next time; other errors show the server text', async () => {
    const limited = new PlanFactPanelController(vi.fn(async () => respond(429, { ok: false, error: 'x', retryAt: '2026-10-22T09:10:00.000Z' })) as unknown as typeof fetch, gigaPlanFactUrls(USER))
    await limited.recompute()
    expect(limited.getSnapshot().recompute.message).toMatch(/^Пересчёт уже запускали недавно — следующий после \d{2}:\d{2}$/)
    const denied = new PlanFactPanelController(vi.fn(async () => respond(403, { ok: false, error: 'Forbidden' })) as unknown as typeof fetch, gigaPlanFactUrls(USER))
    await denied.recompute()
    expect(denied.getSnapshot().recompute).toMatchObject({ phase: 'error', message: 'Forbidden' })
  })

  it('the words of every outcome', () => {
    expect(recomputeMessage({ status: 'no_plan' })).toBe('У клиента нет одобренного плана — пересчитывать нечего')
    expect(recomputeMessage({ status: 'unchanged' })).toBe('Данные не изменились — расчёт актуален')
    expect(recomputeMessage({ status: 'failed', error: 'not_ready' })).toBe('План-факт ещё не включён на сервере')
    expect(recomputeMessage({ status: 'done', overall: 'on_track', period: '2026-09' })).toBe('На курсе за сентябрь 2026')
    expect(recomputeMessage({ status: 'done', overall: 'behind', period: '2026-09', draft: { created: false, version: 2 } })).toBe('Отстаём за сентябрь 2026; отклонение учтите в открытой версии плана')
    expect(runLine({ kind: 'scheduled', status: 'failed', startedAt: '2026-10-19T22:00:00Z', finishedAt: null })).toMatch(/по расписанию · с ошибкой$/)
  })
})

describe('the staff panel render', () => {
  it('the button, the result, the runs, the plan-fact with the staff form and the versions', () => {
    const snap = {
      ...INITIAL_PANEL, phase: 'ready' as const, published: true, planFact: fixturePlanFact('full'),
      runs: [{ kind: 'scheduled', status: 'done', startedAt: '2026-10-19T22:00:00Z', finishedAt: null }],
      recompute: { phase: 'done' as const, message: 'На курсе за сентябрь 2026', at: '2026-10-22T09:05:00.000Z' },
    }
    const out = renderToStaticMarkup(createElement(PlanFactPanelView, { snap, factUrl: '/x' }))
    for (const t of ['План-факт и пересчёт', 'Пересчитать', 'Пересчитано в', 'На курсе за сентябрь 2026', 'Последние пересчёты', 'по расписанию',
      'Сверки за прошлый месяц нет', 'Прогресс по целям', 'Сохраняются как факт с источником «ежемесячная сверка»', 'Версии плана']) {
      expect(out, t).toContain(t)
    }
    expect(out).not.toMatch(/NaN|undefined/)
    const running = renderToStaticMarkup(createElement(PlanFactPanelView, { snap: { ...snap, recompute: { phase: 'running', message: null, at: null } }, factUrl: '/x' }))
    expect(running).toContain('Пересчитываем…')
  })

  it('without an approved plan; while loading; an error', () => {
    expect(renderToStaticMarkup(createElement(PlanFactPanelView, { snap: { ...INITIAL_PANEL, phase: 'ready' }, factUrl: '/x' }))).toContain('Одобренного плана нет')
    expect(renderToStaticMarkup(createElement(PlanFactPanelView, { snap: INITIAL_PANEL, factUrl: '/x' }))).toContain('Пересчитать')
    expect(renderToStaticMarkup(createElement(PlanFactPanelView, { snap: { ...INITIAL_PANEL, phase: 'error', error: 'Сбой' }, factUrl: '/x' }))).toContain('Сбой')
  })
})

describe('the reconciliation block of the queue', () => {
  it('parses the list, shows who had no reconciliation first with a count and links to User 360', () => {
    const data = parseReconciliation({ ok: true, data: { period: '2026-09', items: [
      { userId: 'u1', clientName: 'Клиент Один', companyName: 'Ромашка', done: false, enteredRole: null, updatedAt: null },
      { userId: 'u2', clientName: 'Клиент Два', companyName: null, done: true, enteredRole: 'expert', updatedAt: '2026-10-02T10:00:00Z' },
      { nope: true },
    ] } })!
    expect(data.rows.map((r) => [r.userId, r.done])).toEqual([['u1', false], ['u2', true]])
    expect(parseReconciliation({ ok: false })).toBeNull()
    const out = renderToStaticMarkup(createElement(ReconciliationView, { base: '/admin-giga-panel', data, loading: false, error: null, onRetry: () => undefined }))
    for (const t of ['Ежемесячная сверка · сентябрь 2026', 'без сверки: 1', 'Не было', 'Внесена · эксперт', 'Клиент Один', 'Ромашка']) expect(out, t).toContain(t)
    expect(out).toContain('href="/admin-giga-panel/users/u1')
  })
})
