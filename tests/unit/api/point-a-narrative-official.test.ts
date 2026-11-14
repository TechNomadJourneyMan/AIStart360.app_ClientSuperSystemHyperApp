/**
 * R-033 (BI-02) — POST /api/v1/point-a/narrative reads the OFFICIAL Point A:
 * no AI summary of a score that does not exist, and a block without data is
 * «нет данных» in the prompt — never «0/100 (критично)».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { memoryClient, type Row } from '../data-layer/memory-client'

const h = vi.hoisted(() => ({ client: null as unknown, generate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.client }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => null }))
vi.mock('@/lib/ai/usage', () => ({ recordAiCacheHit: () => undefined }))
vi.mock('@/lib/point-a/narrative', () => ({ generateNarrative: (...a: unknown[]) => h.generate(...a) }))

const USER = 'u1'
const v1 = (score: number, status: string) => ({ score, status, top_issues: [], recommendations: [] })
const ROW = {
  id: 'd1', user_id: USER, is_current: true, overall_score: 31, health_index: 25, stage: 'seed',
  finance_score: v1(0, 'critical'), sales_score: v1(55, 'average'), operations_score: v1(62, 'average'), marketing_score: v1(0, 'critical'), strategy_score: v1(0, 'critical'),
  risks: [], insights: [], quick_wins: [], data_gaps: [], ai_narrative: null, ai_analysis: null,
}
const blocks = (s: Record<string, number | null>) => Object.entries(s).map(([key, score], order) => ({ key, title: key, score, order }))

function setup(tables: Record<string, Row[]>) {
  const m = memoryClient(tables)
  h.client = { ...m.client, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }
}
const post = () => new NextRequest('http://localhost/api/v1/point-a/narrative', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })

describe('POST /api/v1/point-a/narrative — official Point A (R-033)', () => {
  beforeEach(() => h.generate.mockReset())

  it('R-033 golden: v4 has no overall (v1 «31» in the row) → 409, no paid generation', async () => {
    setup({
      diagnostics: [ROW], companies: [{ id: 'co', user_id: USER, name: 'ТОО' }],
      point_a_snapshots: [{ company_id: 'co', created_at: '2026-11-10', engine: 'v1', config_version: 'c|v4', overall: null, v4: { assessment: 'full' }, blocks: blocks({ finance: null, sales: 55, operations: 62, marketing: null, strategy: null }) }],
    })
    const { POST } = await import('@/app/api/v1/point-a/narrative/route')
    const res = await POST(post())
    expect(res.status).toBe(409)
    expect(h.generate).not.toHaveBeenCalled()
  })

  it('scored: the v4 overall, and blocks without data passed as «нет данных»', async () => {
    setup({
      diagnostics: [{ ...ROW, overall_score: 60, stage: 'early' }], companies: [{ id: 'co', user_id: USER, name: 'ТОО' }],
      point_a_snapshots: [{ company_id: 'co', created_at: '2026-11-10', engine: 'v4', config_version: 'c|v4', overall: 60, stage: 'early', v4: { assessment: 'full', health_index: 52 }, blocks: blocks({ finance: null, sales: 55, operations: 62, marketing: 70, strategy: 50 }) }],
    })
    h.generate.mockResolvedValue({ executive_summary: 'x', strengths_text: 'x', weaknesses_text: 'x', risks_text: 'x', opportunities_text: 'x', next_steps: ['1', '2', '3'], model_used: 'm', generated_at: 'now' })
    const { POST } = await import('@/app/api/v1/point-a/narrative/route')
    const res = await POST(post())
    expect(res.status).toBe(200)
    const input = h.generate.mock.calls[0][0] as { pointA: { overall_score: number; health_index: number }; blocksWithoutData: string[] }
    expect(input.pointA.overall_score).toBe(60)
    expect(input.pointA.health_index).toBe(52)
    expect(input.blocksWithoutData).toEqual(['finance'])
  })
})
