/**
 * /client/home reads in two round trips (W4): every user-keyed read at once, the Point A snapshot right
 * after the company row (not after the slowest read). The card data is what it was.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb, roundTrips } from '../_round-trips'

const USER = 'cccccccc-0000-4000-8000-000000000001'
const s = vi.hoisted(() => ({ net: null as null | ReturnType<typeof import('../_round-trips').roundTrips>, tables: {} as Record<string, Array<Record<string, unknown>>> }))

vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`) } }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => s.net!.sb }))
vi.mock('@/lib/request-user', () => ({ getRequestUser: async () => ({ id: USER, email: 'c@example.com' }) }))
vi.mock('@/lib/platform/sections', () => ({ visibleSectionsFor: async () => ({ sections: [], hiddenPaths: [] }) }))
vi.mock('@/lib/cms/server', () => ({ visiblePagesFor: async () => [] }))
vi.mock('@/components/user-dashboard/UserHome', () => ({ default: () => null }))

const { default: ClientHomePage } = await import('@/app/client/home/page')

function seed(withCompany = true) {
  s.tables = {
    profiles: [{ id: USER, full_name: 'Клиент', email: 'c@example.com', status: 'approved', created_at: '2026-09-01T00:00:00Z' }],
    survey_answers: [{ user_id: USER, question_key: 's1_company_name', answer: { value: 'Ромашка' }, answered_at: '2026-09-03T00:00:00Z' }],
    diagnostics: [{ user_id: USER, is_current: true, overall_score: 40, health_index: 41, stage: 'early', calculated_at: '2026-09-04T00:00:00Z' }],
    gri_assessments: [],
    documents: [{ id: 'doc-1', user_id: USER }],
    companies: withCompany ? [{ id: 'company-1', user_id: USER }] : [],
    // A v4 snapshot (point_a_v4 on) whose blocks carry ≥ 60 % of the weight with finance (R-032).
    point_a_snapshots: [{ company_id: 'company-1', engine: 'v4', config_version: 'default@1/r2|v4', overall: 61, stage: 'growth', created_at: '2026-10-10T00:00:00Z', v4: { assessment: 'full' },
      blocks: [{ key: 'finance', score: 61, weight: 0.7 }, { key: 'sales', score: 61, weight: 0.3 }] }],
  }
  s.net = roundTrips(memoryDb(s.tables))
}

type El = { type?: unknown; props: { data?: Record<string, unknown>; report?: Record<string, unknown>; children?: unknown } }
/** The page's root is <UserHome/>, or a fragment of the «Ваш отчёт готов» card (R-025) + <UserHome/>. */
const elementsOf = (root: El): El[] => {
  const kids = root.props?.children
  if (root.props?.data) return [root]
  const list = (Array.isArray(kids) ? kids : [kids]).filter(Boolean) as El[]
  return list.flatMap((k) => [k, ...elementsOf(k)])
}
const render = async () => elementsOf((await ClientHomePage({})) as El)
const dataOf = async () => (await render()).find((e) => e.props.data)!.props.data!
const reportOf = async () => (await render()).find((e) => e.props.report)?.props.report ?? null

describe('/client/home — round trips (W4)', () => {
  beforeEach(() => seed())

  it('two round trips; Point A comes from the v4 snapshot', async () => {
    const data = await dataOf()
    expect(s.net!.waves()).toBe(2)
    expect(data.diagnostics).toEqual({ overallScore: 61, stage: 'growth', calculatedAt: '2026-10-10T00:00:00Z', primary: false, preliminary: false })
    expect(data.documentsCount).toBe(1)
    expect(data.fullName).toBe('Клиент')
  })

  it('I2 (R-032/R-033): a full v4 snapshot WITHOUT an official score → no number, the hint says when it appears', async () => {
    s.tables.point_a_snapshots = [{ company_id: 'company-1', engine: 'v4', config_version: 'default@1/r1|v4', overall: 100, stage: 'scale', created_at: '2026-11-02T00:00:00Z', v4: { assessment: 'full' },
      blocks: [{ key: 'finance', score: null, weight: 0.25 }, { key: 'sales', score: null, weight: 0.2 }, { key: 'operations', score: 100, weight: 0.15 }, { key: 'marketing', score: null, weight: 0.12 }] }]
    const data = await dataOf()
    expect(data.diagnostics).toMatchObject({ overallScore: null, stage: null, preliminary: false, primary: false })
  })

  it('a preliminary snapshot (before the full questionnaire) has no score', async () => {
    s.tables.point_a_snapshots = [{ company_id: 'company-1', overall: null, stage: null, created_at: '2026-11-02T00:00:00Z', v4: { assessment: 'preliminary' } }]
    const data = await dataOf()
    expect(data.diagnostics).toMatchObject({ overallScore: null, stage: null, preliminary: true })
  })

  it('no company: the v1 diagnostics row is the fallback, no snapshot read', async () => {
    seed(false)
    const data = await dataOf()
    expect(data.diagnostics).toEqual({ overallScore: 40, stage: 'early', calculatedAt: '2026-09-04T00:00:00Z' })
    expect(s.net!.reads.point_a_snapshots ?? 0).toBe(0)
  })

  // R-025 «Ваш отчёт готов»: read in the same wave as the snapshot; only a published version shows.
  it('R-025: a published report version → the «Ваш отчёт готов» card, still two round trips', async () => {
    s.tables.report_versions = [
      { id: 'rv-1', company_id: 'company-1', version: 1, title: 'Точка А: Ромашка', status: 'published', published_at: '2026-10-11T10:00:00Z', created_at: '2026-10-10T10:00:00Z' },
      { id: 'rv-2', company_id: 'company-1', version: 2, title: 'Точка А: Ромашка', status: 'published', published_at: '2026-10-20T10:00:00Z', created_at: '2026-10-19T10:00:00Z' },
      { id: 'rv-3', company_id: 'company-1', version: 3, title: 'Черновик', status: 'draft', published_at: null, created_at: '2026-10-25T10:00:00Z' },
    ]
    const report = await reportOf()
    expect(s.net!.waves()).toBe(2)
    expect(report).toMatchObject({ id: 'rv-2', version: 2 })
  })

  it('R-025: no published version (only a draft) → no card', async () => {
    s.tables.report_versions = [{ id: 'rv-3', company_id: 'company-1', version: 1, title: 'Черновик', status: 'draft', published_at: null, created_at: '2026-10-25T10:00:00Z' }]
    expect(await reportOf()).toBeNull()
    expect((await render()).length).toBe(1)
  })

  it('R-025: no company → no report read, no card', async () => {
    seed(false)
    expect(await reportOf()).toBeNull()
    expect(s.net!.reads.report_versions ?? 0).toBe(0)
  })
})
