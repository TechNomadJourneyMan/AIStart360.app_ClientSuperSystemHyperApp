/**
 * The public share link and the PDF export show Point B from the SAME state as the page (R3, M3:
 * lib/point-b/report.ts — the model + the approved plan only): revenue from the metrics registry,
 * the staff-only AI strategy and drafts never shown, a client with nothing to show handled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CLIENT, COMPANY, EXPERT, OTHER_CLIENT, pointBSeed } from './_pb'

const s = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('./_pb').pointBSeed> | null,
  user: null as { id: string } | null,
  viewer: null as Record<string, unknown> | null,
  pdf: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.db!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.db!.sb.from(t) }),
}))
vi.mock('@/lib/expert-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/expert-auth')>()), requireExpert: async () => s.viewer }))
vi.mock('@/lib/reports/pdf', () => ({
  renderGriPdf: async () => Buffer.from('gri'),
  renderPointAPdf: async () => Buffer.from('a'),
  renderSurveyPdf: async () => Buffer.from('s'),
  renderPointBPdf: async (input: Record<string, unknown>) => { s.pdf.push(input); return Buffer.from('%PDF') },
}))

const { loadPointBView } = await import('@/lib/share/report-data')
const { GET } = await import('@/app/api/export/report/route')

const subject = (userId = CLIENT) => ({ companyId: COMPANY, userId, companyName: 'Ромашка', industry: null, stage: null })
const exportReq = (qs = 'type=point-b') => new NextRequest(`http://t/api/export/report?${qs}`)

beforeEach(() => {
  s.db = pointBSeed()
  s.user = { id: CLIENT }
  s.viewer = null
  s.pdf = []
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
})

describe('share link (R3, M3: the same calculation as the page)', () => {
  it('the share data is the client page state as a report: the model on the registry revenue, not V2', async () => {
    const pb = await loadPointBView(subject())
    expect(pb).not.toBeNull()
    expect(pb!.automatic).toBe(true)
    expect(pb!.gap.baseAnnual).toBe(60_000_000)
    expect(pb!.gap.targetAnnual).toBe(120_000_000)
    // the stale 2024 base is said, never hidden
    expect(pb!.verdict.reason.length).toBeGreaterThan(0)
    // no approved plan → no scenarios, the honest state of the plan instead
    expect(pb!.plan.status).not.toBe('published')
    expect(pb!.plan.scenarios).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a stored AI strategy (a staff draft) and a draft plan never reach the share link', async () => {
    s.db = pointBSeed({ point_b_analysis: [{ diagnostic_id: 'diag-1', is_current: true, ai_status: 'completed', ai_strategy: { strategic_bridge_summary: 'МОСТ-ЧЕРНОВИК' } }] })
    const pb = await loadPointBView(subject())
    expect(JSON.stringify(pb)).not.toContain('МОСТ-ЧЕРНОВИК')
  })

  it('a client with neither a goal nor a revenue base yields null (nothing to share), not a throw', async () => {
    s.db = pointBSeed({ diagnostics: [], metrics: [], point_a_snapshots: [], companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }] })
    expect(await loadPointBView(subject())).toBeNull()
  })
})

describe('PDF export (R3, M3: the same calculation as the page)', () => {
  it('the Point B PDF gets the report of the page state (model numbers), not V2', async () => {
    const res = await GET(exportReq())
    expect(res.status).toBe(200)
    expect(s.pdf).toHaveLength(1)
    const report = s.pdf[0].report as { gap: { baseAnnual: number; targetAnnual: number }; automatic: boolean; plan: { scenarios: unknown[] } }
    expect(report.automatic).toBe(true)
    expect(report.gap).toMatchObject({ baseAnnual: 60_000_000, targetAnnual: 120_000_000 })
    expect(report.plan.scenarios).toEqual([])
    expect(s.pdf[0].goals).toBeUndefined()
    expect((s.pdf[0].meta as { companyName: string }).companyName).toBe('Ромашка')
  })

  it('a client with nothing to show (no goal, no base, no plan) gets no_data (404), not a throw', async () => {
    s.db = pointBSeed({ diagnostics: [], metrics: [], point_a_snapshots: [], companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }] })
    const res = await GET(exportReq())
    expect(res.status).toBe(404)
    expect(s.pdf).toHaveLength(0)
  })

  it('an expert exporting a client who is not assigned to them gets 403; an assigned one passes', async () => {
    s.user = { id: EXPERT }
    s.viewer = { id: EXPERT, role: 'expert', email: null }
    s.db = pointBSeed({
      companies: [{ id: COMPANY, user_id: OTHER_CLIENT, name: 'Чужая', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }],
      user_assignments: [],
    })
    // the company is found by the caller's client only through the staff REST path; emulate it
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: COMPANY, user_id: OTHER_CLIENT, name: 'Чужая', industry: null, stage: null }]), { status: 200 })))
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.local'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
    const denied = await GET(exportReq(`type=point-b&companyId=${COMPANY}`))
    expect(denied.status).toBe(403)
    // Refused already while resolving the company (SR-03: an expert reaches only assigned clients' companies).
    expect(['forbidden', 'Клиент вам не назначен']).toContain((await denied.json()).error)
    expect(s.pdf).toHaveLength(0)

    s.db!.db.user_assignments.push({ user_id: OTHER_CLIENT, assignee_id: EXPERT })
    const allowed = await GET(exportReq(`type=point-b&companyId=${COMPANY}`))
    expect(allowed.status).not.toBe(403) // reaches the report (no diagnostic for this user in the fixture → 404 no_data)
  })
})
