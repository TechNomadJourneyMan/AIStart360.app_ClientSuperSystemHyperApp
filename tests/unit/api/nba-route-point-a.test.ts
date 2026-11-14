/**
 * R-035 (BI-46) — GET /api/v1/nba takes the Point A red zone from the OFFICIAL
 * Point A: critical blocks too (critical first), never a block without data,
 * never a v1 recalculation from an incomplete survey.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memoryClient, type Row } from '../data-layer/memory-client'

const h = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => h.client }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))

const block = (score: number, status: string) => ({ score, status, top_issues: [], recommendations: [] })
const v4Blocks = (scores: Record<string, number | null>) => Object.entries(scores).map(([key, score], order) => ({ key, title: key, score, order }))

function client(tables: Record<string, Row[]>) {
  const m = memoryClient(tables)
  h.client = { ...m.client, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }
  return m
}

async function nba() {
  const { GET } = await import('@/app/api/v1/nba/route')
  const res = await GET({} as never)
  return (await res.json()) as { ok: boolean; action: { key: string; title: string; reason: string } | null }
}

describe('GET /api/v1/nba — Point A red zone (R-035)', () => {
  beforeEach(() => { h.client = null })

  it('R-035 golden: finance 12 (critical) + marketing 45 (weak) → «Финансы», not marketing', async () => {
    client({
      diagnostics: [{ id: 'd1', user_id: 'u1', is_current: true, overall_score: 48, stage: 'early', finance_score: block(12, 'critical'), sales_score: block(75, 'strong'), operations_score: block(75, 'strong'), marketing_score: block(45, 'weak'), strategy_score: block(70, 'strong') }],
      companies: [{ id: 'co', user_id: 'u1' }],
      point_a_snapshots: [{ company_id: 'co', created_at: '2026-11-10', engine: 'v4', config_version: 'c|v4', overall: 48, stage: 'early', v4: { assessment: 'full' }, blocks: v4Blocks({ finance: 12, sales: 75, operations: 75, marketing: 45, strategy: 70 }) }],
    })
    const r = await nba()
    expect(r.action?.key).toBe('red_zone')
    expect(r.action?.title).toContain('Финансы')
  })

  it('a block without data (v1 zero in the row) is not a red zone', async () => {
    client({
      diagnostics: [{ id: 'd1', user_id: 'u1', is_current: true, overall_score: 31, stage: 'seed', finance_score: block(0, 'critical'), sales_score: block(80, 'strong'), operations_score: block(80, 'strong'), marketing_score: block(80, 'strong'), strategy_score: block(80, 'strong') }],
      companies: [{ id: 'co', user_id: 'u1' }],
      point_a_snapshots: [{ company_id: 'co', created_at: '2026-11-10', engine: 'v1', config_version: 'c|v4', overall: null, v4: { assessment: 'full' }, blocks: v4Blocks({ finance: null, sales: 80, operations: 80, marketing: 80, strategy: 80 }) }],
    })
    const r = await nba()
    expect(r.action?.key).not.toBe('red_zone')
  })

  it('no Point A yet: no red zone from a v1 recalculation of the incomplete survey', async () => {
    client({
      diagnostics: [],
      companies: [{ id: 'co', user_id: 'u1' }],
      survey_answers: [{ user_id: 'u1', question_key: 's6_main_pain', answer: { value: 'Нет клиентов' } }],
    })
    const r = await nba()
    expect(r.action?.key).not.toBe('red_zone')
  })
})
