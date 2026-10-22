/**
 * Expert «Рекомендации клиента» panel in User 360 → «Точка Б» and the «Рекомендации на проверке» block of the admin
 * queue (plan Ф6a Task 8). The repo has no jsdom, so the behaviour lives in a framework-free controller
 * (components/giga-panel/user360/point-b/recommendationsController.ts) driven with a fetch double, and the markup is
 * checked with react-dom/server. The routes of plan Task 6 are built separately: the doubles follow the contract.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Recommendation } from '@/lib/point-b/recs/types'
import {
  AI_WARNING_TEXT, INITIAL_RECS_SNAPSHOT, RecommendationsController, defaultScopeNote, editPatch, groupByStatus, parseRecommendationList,
  parseRecsQueue, type RecsPanelSnapshot,
} from '@/components/giga-panel/user360/point-b/recommendationsController'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string }) => React.createElement('a', { href: p.href, className: p.className }, p.children) }))
vi.mock('@/components/giga-panel/StaffContext', () => ({ RequirePermission: (p: { children: React.ReactNode }) => p.children }))
vi.mock('@/components/giga-panel/WorkspaceContext', () => ({ useWorkspace: () => ({ base: '/admin-giga-panel', label: 'GIGA' }) }))

const { RecommendationsPanelView } = await import('@/components/giga-panel/user360/point-b/RecommendationsPanel')
const { RecsQueueView } = await import('@/components/giga-panel/pages/PointBQueuePage')

const USER = 'cccccccc-0000-4000-8000-000000000001'
const URL_RECS = `/api/giga-admin/users/${USER}/point-b/recommendations`
const V2 = 'v-2'
const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')

const rec = (over: Partial<Recommendation> & { id: string }): Recommendation => ({
  companyId: 'co-1', versionId: V2, kind: 'lever', title: 'Поднять конверсию', essence: 'Единый скрипт продаж', reason: 'Конверсия 12% ниже нужной',
  expectedEffect: 'Конверсия 14,4%', resources: 'Руководитель продаж', confidence: 'medium', confidenceReason: 'Данные анкеты', risks: 'Просадка при росте потока',
  nextAction: 'Разобрать звонки', sourceRefs: [{ type: 'metric', ref: 'conversion', label: 'Конверсия в оплату — 12%' }], status: 'pending_review', generatedBy: 'ai',
  inputsHash: 'h1', recVersion: 1, supersedesId: null, reviewerName: null, reviewerSpecialty: null, reviewedAt: null, scopeNote: null, reviewComment: null,
  createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:00:00.000Z', ...over,
})

const ITEMS: Recommendation[] = [
  rec({ id: 'p1' }),
  rec({ id: 'p2', generatedBy: 'rule', kind: 'constraint', title: 'Ограничивающий фактор — конверсия', createdAt: '2026-10-15T09:00:00.000Z' }),
  rec({ id: 'v1', status: 'expert_verified', generatedBy: 'expert', title: 'Найм заранее', reviewerName: 'Анна Ким', reviewerSpecialty: 'Эксперт по продажам', reviewedAt: '2026-10-16T12:00:00.000Z', scopeNote: 'Для плана v2' }),
  rec({ id: 'x1', status: 'expert_rejected', title: 'Снизить цены', reviewerName: 'Анна Ким', reviewComment: 'Противоречит цели по марже' }),
  rec({ id: 's1', status: 'stale', title: 'Резерв на рекламу' }),
]

interface Call { method: string; url: string; body: unknown }
type Reply = { status: number; body: unknown }

function harness(replies: Reply[], versions = { numbers: { [V2]: 2 }, current: 2 }) {
  const calls: Call[] = []
  const queue = [...replies]
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = queue.shift() ?? { status: 200, body: { ok: true, data: { items: ITEMS } } }
    return { ok: r.status < 400, status: r.status, json: async () => r.body }
  })
  return { ctl: new RecommendationsController(USER, fetchFn as unknown as typeof fetch, versions), calls }
}

const list = (items: Recommendation[] = ITEMS): Reply => ({ status: 200, body: { ok: true, data: { items } } })
const noop = () => undefined
const viewHtml = (snap: RecsPanelSnapshot) => flat(renderToStaticMarkup(React.createElement(RecommendationsPanelView, {
  snap, onRetry: noop, onGenerate: noop, onRunRules: noop, onOpenForm: noop, onCloseForm: noop, onField: noop, onSubmit: noop,
})))

describe('RecommendationsPanel', () => {
  it('groups recommendations by status and shows the source', async () => {
    const { ctl, calls } = harness([list()])
    await ctl.load()
    expect(calls[0]).toMatchObject({ method: 'GET', url: URL_RECS })
    const snap = ctl.getSnapshot()
    expect(groupByStatus(snap.items).map((g) => [g.label, g.items.map((r) => r.id)])).toEqual([
      ['На проверке', ['p2', 'p1']],
      ['Проверены', ['v1']],
      ['Отклонены', ['x1']],
      ['Требуют обновления', ['s1']],
    ])
    const html = viewHtml(snap)
    for (const t of ['На проверке', 'Проверены', 'Отклонены', 'Требуют обновления', 'Источник: ИИ', 'Источник: Правило', 'Источник: Эксперт']) expect(html).toContain(t)
    expect(html).toContain(AI_WARNING_TEXT)
    for (const t of ['Сгенерировать рекомендации ИИ', 'Применить правила и инвайты', 'Добавить свою']) expect(html).toContain(t)
    expect(html).toContain('Проверил: Анна Ким · Эксперт по продажам · 16 октября 2026')
    expect(html).toContain('Комментарий: Противоречит цели по марже')
    // «Подтвердить» / «Отклонить» only on those under review: two pending → two of each
    expect(html.match(/>Подтвердить</g)).toHaveLength(2)
    expect(html.match(/>Отклонить</g)).toHaveLength(2)
    // snake_case rows of the store are read too
    expect(parseRecommendationList({ ok: true, data: [{ id: 'a', title: 'T', status: 'pending_review', generated_by: 'rule', rec_version: 3, source_refs: [] }] })![0])
      .toMatchObject({ generatedBy: 'rule', recVersion: 3 })
    // a load failure is local with the server's text
    const bad = harness([{ status: 403, body: { ok: false, error: 'Клиент вам не назначен' } }])
    await bad.ctl.load()
    expect(bad.ctl.getSnapshot()).toMatchObject({ phase: 'error', loadError: 'Клиент вам не назначен' })
  })

  it('verify form pre-fills the scope note and sends scope and comment', async () => {
    const { ctl, calls } = harness([list(), { status: 200, body: { ok: true, data: { ...ITEMS[0], status: 'expert_verified' } } }, list()])
    await ctl.load()
    ctl.openForm('verify', 'p1')
    const form = ctl.getSnapshot().form!
    expect(form.mode).toBe('verify')
    expect(form.values.scopeNote).toBe('Для плана v2, данные на 14 октября 2026 г.')
    expect(defaultScopeNote({ versionId: null, createdAt: '' })).toBe('Для текущего плана')
    const html = viewHtml(ctl.getSnapshot())
    expect(html).toContain('Область применимости')
    expect(html).toContain('>Для плана v2, данные на 14 октября 2026 г.</textarea>')

    // an empty scope never reaches the server
    ctl.setField('scopeNote', '   ')
    expect(await ctl.submitForm()).toBe(false)
    expect(ctl.getSnapshot().form!.errors.scopeNote).toMatch(/область применимости/i)
    expect(calls).toHaveLength(1)

    ctl.setField('scopeNote', 'Для плана v2, сценарий «Умеренный»')
    ctl.setField('comment', 'Числа сверены с моделью')
    expect(await ctl.submitForm()).toBe(true)
    expect(calls[1]).toEqual({ method: 'PATCH', url: `${URL_RECS}/p1`, body: { action: 'verify', scopeNote: 'Для плана v2, сценарий «Умеренный»', comment: 'Числа сверены с моделью' } })
    expect(calls[2].method).toBe('GET') // reloaded
    expect(ctl.getSnapshot()).toMatchObject({ form: null, busy: null })
    expect(ctl.getSnapshot().notice).toMatch(/подтверждена/)

    // the server's 400 with the field lands next to the field; 409 is shown as the server says
    const t = harness([list(), { status: 400, body: { ok: false, error: 'Недопустимые слова в поле', field: 'scopeNote' } }])
    await t.ctl.load()
    t.ctl.openForm('verify', 'p1')
    expect(await t.ctl.submitForm()).toBe(false)
    expect(t.ctl.getSnapshot().form!.errors.scopeNote).toBe('Недопустимые слова в поле')
    const c = harness([list(), { status: 409, body: { ok: false, error: 'bad_state' } }])
    await c.ctl.load()
    c.ctl.openForm('verify', 'p1')
    await c.ctl.submitForm()
    expect(c.ctl.getSnapshot().error).toMatchObject({ status: 409, message: 'Рекомендацию уже проверили или изменили — обновите список' })
  })

  it('reject requires a comment', async () => {
    const { ctl, calls } = harness([list(), { status: 200, body: { ok: true, data: { ...ITEMS[0], status: 'expert_rejected' } } }])
    await ctl.load()
    ctl.openForm('reject', 'p1')
    expect(await ctl.submitForm()).toBe(false)
    expect(ctl.getSnapshot().form!.errors.comment).toBe('Напишите, почему рекомендация отклонена')
    expect(calls).toHaveLength(1)
    const html = viewHtml(ctl.getSnapshot())
    expect(html).toContain('role="alert" class="mt-0.5 text-[11px] text-red-300">Напишите, почему рекомендация отклонена')
    expect(html).toContain('aria-required="true"')
    expect(html).not.toContain('Область применимости')
    ctl.setField('comment', 'Противоречит цели по марже')
    expect(await ctl.submitForm()).toBe(true)
    expect(calls[1]).toEqual({ method: 'PATCH', url: `${URL_RECS}/p1`, body: { action: 'reject', comment: 'Противоречит цели по марже' } })
  })

  it('edit sends the patch and shows the new pending version', async () => {
    const v2 = rec({ id: 'p1-v2', recVersion: 2, supersedesId: 'p1', title: 'Поднять конверсию до 14,4%' })
    const after = [v2, ...ITEMS.slice(1), { ...ITEMS[0], status: 'stale' as const }]
    const { ctl, calls } = harness([list(), { status: 200, body: { ok: true, data: v2 } }, list(after)])
    await ctl.load()
    ctl.openForm('edit', 'p1')
    expect(ctl.getSnapshot().form!.values.title).toBe('Поднять конверсию')
    // nothing changed → nothing sent
    expect(await ctl.submitForm()).toBe(false)
    expect(calls).toHaveLength(1)
    ctl.setField('title', 'Поднять конверсию до 14,4%')
    ctl.setField('risks', '')
    expect(editPatch(ITEMS[0], ctl.getSnapshot().form!.values)).toEqual({ title: 'Поднять конверсию до 14,4%', risks: null })
    expect(await ctl.submitForm()).toBe(true)
    expect(calls[1]).toEqual({ method: 'PATCH', url: `${URL_RECS}/p1`, body: { action: 'edit', patch: { title: 'Поднять конверсию до 14,4%', risks: null } } })
    expect(ctl.getSnapshot().notice).toMatch(/Создана версия 2 — она снова на проверке/)
    const html = viewHtml(ctl.getSnapshot())
    expect(html).toContain('Версия 2')
    const groups = groupByStatus(ctl.getSnapshot().items)
    expect(groups.find((g) => g.status === 'pending_review')!.items.map((r) => r.id)).toContain('p1-v2')
    expect(groups.find((g) => g.status === 'stale')!.items.map((r) => r.id)).toContain('p1')
  })

  it('generate shows loading, warnings and 429 text', async () => {
    let release: () => void = noop
    const gate = new Promise<void>((r) => { release = r })
    const calls: Call[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (init?.method === 'POST') {
        await gate
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { created: [ITEMS[0]], warnings: ['отброшена: число не из данных', 'too_soon'] } }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { items: ITEMS } }) }
    })
    const ctl = new RecommendationsController(USER, fetchFn as unknown as typeof fetch)
    await ctl.load()
    const running = ctl.generate()
    expect(ctl.getSnapshot().busy).toBe('generate')
    const loading = viewHtml(ctl.getSnapshot())
    expect(loading).toContain('ИИ готовит рекомендации…')
    expect(loading).toContain('Генерация идёт')
    // a second click while running does nothing
    expect(await ctl.generate()).toBe(false)
    release()
    expect(await running).toBe(true)
    expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', url: URL_RECS, body: { action: 'generate_ai' } })
    const done = ctl.getSnapshot()
    expect(done.busy).toBeNull()
    expect(done.notice).toBe('Создано рекомендаций: 1. Они на проверке — клиент их пока не видит.')
    expect(done.warnings).toEqual(['отброшена: число не из данных', 'ИИ уже вызывался для этого клиента меньше 10 минут назад — попробуйте позже'])
    const html = viewHtml(done)
    expect(html).toContain('Предупреждения генерации')
    expect(html).toContain('отброшена: число не из данных')

    // 429: the server's text (or the fallback) is shown, nothing is reloaded
    const t = harness([list(), { status: 429, body: { ok: false, error: 'Лимит генерации: не чаще 10 раз в час' } }])
    await t.ctl.load()
    expect(await t.ctl.generate()).toBe(false)
    expect(t.ctl.getSnapshot().error).toMatchObject({ status: 429, message: 'Лимит генерации: не чаще 10 раз в час' })
    expect(viewHtml(t.ctl.getSnapshot())).toContain('Лимит генерации: не чаще 10 раз в час')
    expect(t.calls).toHaveLength(2)
    const f = harness([list(), { status: 429, body: { ok: false, error: 'rate_limited' } }])
    await f.ctl.load()
    await f.ctl.generate()
    expect(f.ctl.getSnapshot().error!.message).toMatch(/не чаще 10 раз в час/)

    // «Применить правила и инвайты» reports the counters
    const r = harness([list(), { status: 200, body: { ok: true, data: { created: 2, skipped: 1 } } }])
    await r.ctl.load()
    expect(await r.ctl.runRules()).toBe(true)
    expect(r.calls[1].body).toEqual({ action: 'run_rules' })
    expect(r.ctl.getSnapshot().notice).toBe('Правила применены: новых подсказок клиенту — 2, пропущено (повтор, пауза или лимит) — 1')
  })

  it('create sends the draft with the scope and is verified by the server', async () => {
    const { ctl, calls } = harness([list(), { status: 200, body: { ok: true, data: rec({ id: 'e1', status: 'expert_verified', generatedBy: 'expert' }) } }])
    await ctl.load()
    ctl.openForm('create')
    expect(ctl.getSnapshot().form!.values.scopeNote).toMatch(/^Для плана v2/)
    expect(await ctl.submitForm()).toBe(false)
    expect(Object.keys(ctl.getSnapshot().form!.errors).sort()).toEqual(['essence', 'reason', 'title'])
    ctl.setField('title', 'Своя рекомендация')
    ctl.setField('essence', 'Суть')
    ctl.setField('reason', 'Причина')
    expect(await ctl.submitForm()).toBe(true)
    expect(calls[1]).toMatchObject({ method: 'POST', url: URL_RECS, body: { action: 'create', draft: { title: 'Своя рекомендация', essence: 'Суть', reason: 'Причина', kind: 'action', confidence: 'medium' } } })
    expect((calls[1].body as { scopeNote: string }).scopeNote).toMatch(/^Для плана v2/)
  })
})

describe('«Рекомендации на проверке» in the admin queue', () => {
  it('queue block lists pending items with links', () => {
    const rows = parseRecsQueue({ ok: true, data: [
      { id: 'r2', user_id: 'u-2', client_name: 'Борис', company_name: 'ТОО Б', title: 'Второй', kind: 'risk', generated_by: 'rule', created_at: '2026-10-16T09:00:00Z' },
      { id: 'r1', userId: 'u-1', clientName: 'Алия', title: 'Первый', kind: 'lever', generatedBy: 'ai', createdAt: '2026-10-15T09:00:00Z' },
      { id: 'bad' },
    ] })
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']) // oldest first, broken rows dropped
    const html = flat(renderToStaticMarkup(React.createElement(RecsQueueView, { base: '/admin-giga-panel', rows, loading: false, error: null, onRetry: noop })))
    expect(html).toContain('Рекомендации на проверке')
    expect(html).toContain('href="/admin-giga-panel/users/u-1?tab=point-b"')
    expect(html).toContain('href="/admin-giga-panel/users/u-2?tab=point-b"')
    for (const t of ['Алия', 'Борис', 'ТОО Б', 'Первый', 'Второй', 'ИИ', 'Правило', 'Проверить']) expect(html).toContain(t)
    const empty = flat(renderToStaticMarkup(React.createElement(RecsQueueView, { base: '/admin-giga-panel', rows: [], loading: false, error: null, onRetry: noop })))
    expect(empty).toContain('Проверять нечего')
    expect(parseRecsQueue({ ok: false })).toEqual([])
    expect(INITIAL_RECS_SNAPSHOT.phase).toBe('loading')
  })
})
