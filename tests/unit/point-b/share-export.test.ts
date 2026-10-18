/**
 * The public share link and the PDF export compute Point B from the same loader
 * as the page: revenue from the metrics registry (not the dead `metrics.revenue`
 * key), the stale 2024 base flagged, a client without Point A handled.
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

describe('share link', () => {
  it('share report data computes Point B from the loader (revenue from registry metrics, not metrics.revenue)', async () => {
    const pb = await loadPointBView(subject())
    expect(pb).not.toBeNull()
    expect(pb!.goals.current_revenue_year).toBe(60_000_000)
    expect(pb!.gap.find((g) => g.horizon === '12m')!.data_complete).toBe(true)
    expect(pb!.data_quality.base).toMatchObject({ period: '2024', stale: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('overlays a completed AI strategy', async () => {
    s.db = pointBSeed({ point_b_analysis: [{ diagnostic_id: 'diag-1', is_current: true, ai_status: 'completed', ai_strategy: { strategic_bridge_summary: 'мост' } }] })
    const pb = await loadPointBView(subject())
    expect(pb!.ai_status).toBe('completed')
    expect(pb!.ai_strategy).toEqual({ strategic_bridge_summary: 'мост' })
  })

  it('a client without a diagnostic yields pointB null and no throw', async () => {
    s.db = pointBSeed({ diagnostics: [] })
    expect(await loadPointBView(subject())).toBeNull()
  })
})

describe('PDF export', () => {
  it('export report passes a stale base note into the Point B section data', async () => {
    const res = await GET(exportReq())
    expect(res.status).toBe(200)
    expect(s.pdf).toHaveLength(1)
    expect(s.pdf[0].baseNote).toBe('Период выручки: 2024 · данные устарели')
    expect((s.pdf[0].goals as { current_revenue_year: number }).current_revenue_year).toBe(60_000_000)
  })

  it('a fresh base carries no note', async () => {
    s.db = pointBSeed({
      metrics: [{ company_id: COMPANY, metric_key: 'biz.finansy.vyruchka_god', metric_value: 80_000_000, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' }],
      point_a_snapshots: [],
    })
    await GET(exportReq())
    expect(s.pdf[0].baseNote).toBeNull()
  })

  it('a client without a diagnostic gets no_data (404), not a throw', async () => {
    s.db = pointBSeed({ diagnostics: [] })
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
    expect((await denied.json()).error).toBe('Клиент вам не назначен')
    expect(s.pdf).toHaveLength(0)

    s.db!.db.user_assignments.push({ user_id: OTHER_CLIENT, assignee_id: EXPERT })
    const allowed = await GET(exportReq(`type=point-b&companyId=${COMPANY}`))
    expect(allowed.status).not.toBe(403) // reaches the report (no diagnostic for this user in the fixture → 404 no_data)
  })
})
