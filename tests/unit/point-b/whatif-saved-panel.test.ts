/**
 * Expert's read-only list of the client's saved «что если» in User 360 → «Точка Б» (plan Ф4 Task 5). The repo has
 * no jsdom, so the behaviour lives in a framework-free controller driven with a fetch double, and the markup is
 * checked with react-dom/server. The route (plan Task 3) is built separately: the double follows the contract.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureWhatIfSaved } from '@/lib/point-b/fixtures'
import { INITIAL_SAVED_SNAPSHOT, WhatIfSavedController, savedRowView, type WhatIfSavedSnapshot } from '@/components/giga-panel/user360/point-b/whatIfSavedController'

const { WhatIfSavedPanelView } = await import('@/components/giga-panel/user360/point-b/WhatIfSavedPanel')

const USER = 'cccccccc-0000-4000-8000-000000000001'
const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')
const html = (snap: WhatIfSavedSnapshot) => flat(renderToStaticMarkup(React.createElement(WhatIfSavedPanelView, { snap, onRetry: () => undefined })))
const ready = (items = fixtureWhatIfSaved('level2')): WhatIfSavedSnapshot => ({ ...INITIAL_SAVED_SNAPSHOT, phase: 'ready', items })

function harness(status: number, body: unknown) {
  const calls: Array<{ url: string; method: string }> = []
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    return { ok: status < 400, status, json: async () => body }
  })
  return { ctl: new WhatIfSavedController(USER, fetchFn as unknown as typeof fetch), calls }
}

describe('expert: saved «что если» of the client', () => {
  it('lists saved what-ifs with summary and the proposed mark', () => {
    const out = html(ready())
    expect(out).toContain('Сохранённые «что если» клиента')
    expect(out).toContain('Рост конверсии на 2 п.п.')
    expect(out).toContain('Стресс: выручка −40 % на 4 месяца')
    // the changes in words and the key deltas stored with the scenario
    expect(out).toContain('Конверсия +2 п.п.')
    expect(out).toContain('Падение выручки −40% на 4 мес. с месяца 2')
    expect(out).toContain('Результат на момент сохранения')
    expect(out).toContain('Выручка к сроку')
    // only the first fixture item was proposed
    expect(out.match(/Предложено клиентом/g)).toHaveLength(1)
    expect(out).toContain('Комментарий клиента: После запуска нового скрипта продаж')
    // read-only: no buttons and no inputs
    expect(out).not.toMatch(/<button|<input|<textarea/)
    expect(out).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('rows carry the words of the changes and no empty delta line', () => {
    const [first] = fixtureWhatIfSaved('level2')
    const v = savedRowView(first)
    expect(v.changes).toEqual(['Конверсия +2 п.п.'])
    expect(v.deltas.length).toBeGreaterThan(0)
    expect(savedRowView({ ...first, summary: { level: 1, delta: {} } }).deltas).toEqual([])
  })

  it('empty state', () => {
    const out = html(ready([]))
    expect(out).toContain('Клиент пока ничего не сохранил')
    expect(out).not.toContain('Предложено клиентом')
  })

  it('loading shows a skeleton, not an empty list', () => {
    const out = html(INITIAL_SAVED_SNAPSHOT)
    expect(out).toContain('animate-pulse')
    expect(out).not.toContain('Клиент пока ничего не сохранил')
  })

  it('server error is shown', async () => {
    const { ctl } = harness(403, { ok: false, error: 'Клиент вам не назначен' })
    await ctl.load()
    const s = ctl.getSnapshot()
    expect(s.phase).toBe('error')
    expect(s.error).toBe('Клиент вам не назначен')
    expect(html(s)).toContain('Клиент вам не назначен')
    // an English or empty server text falls back to ours by status
    const other = harness(403, { ok: false, error: 'Forbidden' })
    await other.ctl.load()
    expect(other.ctl.getSnapshot().error).toBe('Нет доступа к этому разделу')
  })

  it('loads from the expert route of the user, read-only (GET)', async () => {
    const { ctl, calls } = harness(200, { ok: true, data: JSON.parse(JSON.stringify(fixtureWhatIfSaved('level2'))) })
    await ctl.load()
    expect(calls).toEqual([{ url: `/api/giga-admin/users/${USER}/point-b/whatif/saved`, method: 'GET' }])
    expect(ctl.getSnapshot().phase).toBe('ready')
    expect(ctl.getSnapshot().items).toHaveLength(2)
  })

  it('an unreadable answer is an error, not an empty list; a network failure too', async () => {
    const bad = harness(200, { ok: true, data: 'x' })
    await bad.ctl.load()
    expect(bad.ctl.getSnapshot().phase).toBe('error')
    const offline = new WhatIfSavedController(USER, (async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await offline.load()
    expect(offline.getSnapshot().error).toMatch(/Нет связи/)
  })
})
