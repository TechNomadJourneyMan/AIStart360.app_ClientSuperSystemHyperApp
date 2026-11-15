/**
 * R2-C (M-4; product review M-4, security review F8, product review L-7): the
 * report is part of Точка А, so every place where staff PUBLISH it says the
 * truth about a client on the free tariff — he sees only the notice that the
 * report is ready:
 *   • the expert cabinet /expert/reports (behaviour, not the source text);
 *   • GIGA → Отчёты / SuperExpert «Отчёты на проверке» (GET /api/giga-admin/reports/review
 *     → clientPaidLocked; ReviewQueueList; the toast; the status hint);
 *   • the expert bot's answer after «Подтвердить и опубликовать».
 * The decision for the owners is ONE batch call per render (F8); a failed
 * decision is UNKNOWN — no note (L-7).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  closed: new Set<string>(),
  fails: false,
  batchCalls: [] as string[][],
}))

vi.mock('@/lib/access/owner-access', async (orig) => {
  const real = await orig<typeof import('@/lib/access/owner-access')>()
  return {
    ...real,
    companiesWithClosedSection: async (ids: string[]) => {
      s.batchCalls.push([...ids])
      return s.fails ? new Set<string>() : new Set(ids.filter((id) => s.closed.has(id)))
    },
  }
})

const head = (id: string, company: string) => ({
  id, company_id: company, company_name: `Компания ${company}`, session_id: null, report_type: 'point_a', version: 1,
  status: 'in_review', title: 'Точка А', data_hash: 'h', created_at: '2026-11-10T10:00:00Z', published_at: null,
})

// GIGA queue API
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: 'super_expert' })) }
})
vi.mock('@/lib/admin/client-scope', async (orig) => ({ ...(await orig<Record<string, unknown>>()), scopedCompanyIds: async () => null }))
vi.mock('@/lib/reports/review-flow', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listInReviewVersions: async () => [head('v1', 'c-free'), head('v2', 'c-pro')],
  listReviews: async () => [],
}))
// Expert cabinet page
vi.mock('@/lib/expert-auth', () => ({ requireExpert: async () => ({ id: 'e1', role: 'expert' }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/reports/expert-list', async (orig) => ({ ...(await orig<Record<string, unknown>>()), listPublishedReportsForExpert: async () => ({ ok: true, items: [] }) }))
vi.mock('@/lib/reports/versions', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listReportVersions: async () => [{ ...head('v1', 'c-free'), findings: 2, recommendations: 1 }, { ...head('v2', 'c-pro'), findings: 1, recommendations: 0 }],
}))
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => React.createElement('a', { href: p.href }, p.children) }))

const { GET: queueGET } = await import('@/app/api/giga-admin/reports/review/route')
const { default: ExpertReportsPage } = await import('@/app/(expert)/expert/reports/page')
const { ReviewQueueList } = await import('@/components/giga-panel/reports/ReviewQueue')
const model = await import('@/components/giga-panel/reports/model')
const { FREE_CLIENT_NOTE } = await import('@/components/expert/ExpertReviewQueue')
const { outcomeText } = await import('@/lib/telegram/bots/expert/review')

beforeEach(() => {
  s.closed = new Set(['c-free'])
  s.fails = false
  s.batchCalls = []
})

describe('/expert/reports (where the expert publishes)', () => {
  it('the note only on the free client\'s card; ONE batch decision for the whole queue', async () => {
    const out = renderToStaticMarkup((await ExpertReportsPage({})) as React.ReactElement)
    expect(out.match(/data-free-client/g)).toHaveLength(1)
    expect(out).toContain(FREE_CLIENT_NOTE)
    expect(s.batchCalls).toEqual([['c-free', 'c-pro']])
  })

  it('a failed decision → no note at all (unknown is not «free tariff»)', async () => {
    s.fails = true
    const out = renderToStaticMarkup((await ExpertReportsPage({})) as React.ReactElement)
    expect(out).not.toContain('data-free-client')
  })
})

describe('GIGA / SuperExpert «Отчёты на проверке»', () => {
  it('the API marks the versions of free clients (one batch), the list shows the note, the texts are true', async () => {
    const body = await (await queueGET(new NextRequest('http://localhost/api/giga-admin/reports/review'))).json()
    expect(body.items.map((i: { id: string; clientPaidLocked?: boolean }) => [i.id, i.clientPaidLocked === true])).toEqual([['v1', true], ['v2', false]])
    expect(s.batchCalls).toHaveLength(1)
    const html = renderToStaticMarkup(React.createElement(ReviewQueueList, { items: body.items, onDecide: () => {} }))
    expect(html.match(/data-free-client/g)).toHaveLength(1)
    expect(html).toContain(model.FREE_CLIENT_REPORT_NOTE)
    expect(model.publishedToast('Версия 1', true)).toContain('Клиент на бесплатном тарифе получил уведомление о готовности')
    expect(model.publishedToast('Версия 1', false)).toBe('Опубликовано клиенту: Версия 1')
    expect(model.reportStatusMeta('published').hint).toContain('на бесплатном тарифе — только уведомление о готовности')
  })

  it('a failed decision → no flags', async () => {
    s.fails = true
    const body = await (await queueGET(new NextRequest('http://localhost/api/giga-admin/reports/review'))).json()
    expect(body.items.some((i: { clientPaidLocked?: boolean }) => i.clientPaidLocked)).toBe(false)
  })
})

describe('the expert bot after «Подтвердить и опубликовать»', () => {
  const res = { ok: true, decision: 'approve', already: false, reviewId: 'r', version: head('v1', 'c-free'), superseded: [], rerun: null } as never
  it('free client → «получил только уведомление о готовности», not «клиент видит»', () => {
    const t = outcomeText(res, 'Компания · Точка А', true)
    expect(t).toContain('Клиент на бесплатном тарифе получил только уведомление о готовности')
    expect(t).not.toContain('Опубликовано клиенту')
  })
  it('paid client → as before', () => {
    expect(outcomeText(res, 'Компания · Точка А')).toContain('Опубликовано клиенту')
  })
})
