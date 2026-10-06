/**
 * Expert portal «Отчёты»: real published report versions (report_versions)
 * read through the caller's session (RLS), only for a viewer that passed
 * requireExpert(); only status 'published' — never drafts / ready / superseded;
 * no rows → empty list (the page shows «Отчёты появятся после публикации»).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listPublishedReportsForExpert, REPORT_TYPE_LABELS } from '@/lib/reports/expert-list'

const s = {
  reports: [] as Array<Record<string, unknown>>,
  companies: [] as Array<Record<string, unknown>>,
  reportsError: null as { message: string } | null,
  companiesError: null as { message: string } | null,
  calls: [] as Array<{ table: string; filters: Array<[string, string, unknown]> }>,
}

/** Like RLS for platform staff: returns every row it is given, whatever the filters ask. */
function client(): SupabaseClient {
  return {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, string, unknown]> }
      s.calls.push(call)
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return b },
        in: async (c: string, v: unknown) => {
          call.filters.push(['in', c, v])
          return s.companiesError ? { data: null, error: s.companiesError } : { data: s.companies, error: null }
        },
        order: () => b,
        limit: async () => (s.reportsError ? { data: null, error: s.reportsError } : { data: s.reports, error: null }),
      }
      return b
    },
  } as unknown as SupabaseClient
}

const viewer = { id: 'expert-1', role: 'expert', email: 'e@example.com' }

const row = (over: Record<string, unknown>) => ({
  id: 'r1', company_id: 'co-1', report_type: 'point_a', version: 1, status: 'published',
  title: 'Отчёт Точки А', confidence: '0.82', published_at: '2026-10-01T10:00:00Z', ...over,
})

beforeEach(() => {
  s.reports = []
  s.companies = []
  s.reportsError = null
  s.companiesError = null
  s.calls = []
})

describe('listPublishedReportsForExpert', () => {
  it('without an expert viewer nothing is read', async () => {
    const res = await listPublishedReportsForExpert(client(), null)
    expect(res).toEqual({ ok: false, reason: 'forbidden' })
    expect(s.calls).toEqual([])
  })

  it('asks for published versions and drops anything else RLS lets staff see', async () => {
    s.reports = [
      row({ id: 'r1', version: 3 }),
      row({ id: 'r2', status: 'ready', version: 4 }),
      row({ id: 'r3', status: 'draft' }),
      row({ id: 'r4', status: 'superseded', version: 2 }),
      row({ id: 'r5', company_id: 'co-2', report_type: 'gri', confidence: null, published_at: null }),
      row({ id: 'r6', report_type: 'unknown_type' }),
    ]
    s.companies = [{ id: 'co-1', name: 'ТОО Ромашка' }, { id: 'co-2', name: '  ' }]
    const res = await listPublishedReportsForExpert(client(), viewer)

    expect(s.calls[0]).toEqual({ table: 'report_versions', filters: [['eq', 'status', 'published']] })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.map((r) => r.id)).toEqual(['r1', 'r5'])
    expect(res.items[0]).toEqual({
      id: 'r1', company_id: 'co-1', company_name: 'ТОО Ромашка', report_type: 'point_a', version: 3,
      title: 'Отчёт Точки А', confidence: 0.82, published_at: '2026-10-01T10:00:00Z',
    })
    expect(res.items[1]).toMatchObject({ company_name: null, confidence: null, published_at: null })
    // Company names are looked up only for the published rows.
    expect(s.calls[1]).toEqual({ table: 'companies', filters: [['in', 'id', ['co-1', 'co-2']]] })
  })

  it('no published versions → empty list, no company lookup', async () => {
    s.reports = [row({ status: 'ready' })]
    const res = await listPublishedReportsForExpert(client(), viewer)
    expect(res).toEqual({ ok: true, items: [] })
    expect(s.calls.map((c) => c.table)).toEqual(['report_versions'])
  })

  it('a database error is reported, not shown as an empty list', async () => {
    s.reportsError = { message: 'boom' }
    expect(await listPublishedReportsForExpert(client(), viewer)).toEqual({ ok: false, reason: 'db' })
  })

  it('a failed company lookup keeps the reports (company shown as «—»)', async () => {
    s.reports = [row({})]
    s.companiesError = { message: 'boom' }
    const res = await listPublishedReportsForExpert(client(), viewer)
    expect(res.ok && res.items.map((r) => [r.id, r.company_name])).toEqual([['r1', null]])
  })

  it('has a Russian label for every report type', () => {
    expect(REPORT_TYPE_LABELS).toEqual({ point_a: 'Точка А', full: 'Полная диагностика', gri: 'GRI', point_b: 'Точка Б' })
  })
})
