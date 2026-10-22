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
    diagnostics: [{ user_id: USER, is_current: true, overall_score: 40, health_index: 41, stage: 'start', calculated_at: '2026-09-04T00:00:00Z' }],
    gri_assessments: [],
    documents: [{ id: 'doc-1', user_id: USER }],
    companies: withCompany ? [{ id: 'company-1', user_id: USER }] : [],
    point_a_snapshots: [{ company_id: 'company-1', overall: 61, stage: 'growth', created_at: '2026-10-10T00:00:00Z' }],
  }
  s.net = roundTrips(memoryDb(s.tables))
}

const dataOf = async () => ((await ClientHomePage({})) as { props: { data: Record<string, unknown> } }).props.data

describe('/client/home — round trips (W4)', () => {
  beforeEach(() => seed())

  it('two round trips; Point A comes from the v4 snapshot', async () => {
    const data = await dataOf()
    expect(s.net!.waves()).toBe(2)
    expect(data.diagnostics).toEqual({ overallScore: 61, stage: 'growth', calculatedAt: '2026-10-10T00:00:00Z' })
    expect(data.documentsCount).toBe(1)
    expect(data.fullName).toBe('Клиент')
  })

  it('no company: the v1 diagnostics row is the fallback, no snapshot read', async () => {
    seed(false)
    const data = await dataOf()
    expect(data.diagnostics).toEqual({ overallScore: 40, stage: 'start', calculatedAt: '2026-09-04T00:00:00Z' })
    expect(s.net!.reads.point_a_snapshots ?? 0).toBe(0)
  })
})
