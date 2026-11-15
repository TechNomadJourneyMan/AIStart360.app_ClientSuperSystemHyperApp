/**
 * R3-PA (П1а, migration 150): POST /api/v1/diagnostics/ai-analyze is
 * diagnosable — every outcome writes why (ai_error: part + kind), which model
 * answered (ai_model) and when (ai_generated_at); a failed analysis answers
 * 502, never 200 «успех» (the fan-out did not log it); 3 of 4 parts → the
 * partial analysis is stored with ai_status 'failed' and no cache hash; the
 * expert's review of a cached analysis is carried to the new row. Before
 * migration 150 (PGRST204) the route still writes the status.
 * Also the fan-out: a call that never answered writes «fanout:<reason>».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PointAAnalysisReport } from '@/lib/point-a/ai-review'

type Row = Record<string, unknown>
const COLS_150 = ['ai_error', 'ai_model', 'ai_generated_at', 'ai_reviewed_at', 'ai_reviewed_by', 'ai_reviewed_by_name', 'ai_expert_edits']

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  updates: [] as Array<{ table: string; payload: Row }>,
  pre150: false,
}))

function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from(table: string) {
      let op: 'select' | 'update' = 'select'
      let payload: Row = {}
      let cols = '*'
      const filters: Array<(r: Row) => boolean> = []
      const rows = () => (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      const run = async (single: boolean) => {
        if (op === 'update') {
          if (h.pre150 && table === 'diagnostics' && Object.keys(payload).some((k) => COLS_150.includes(k))) {
            return { data: null, error: { code: 'PGRST204', message: "Could not find the 'ai_error' column" } }
          }
          h.updates.push({ table, payload })
          for (const r of rows()) Object.assign(r, payload)
          return { data: null, error: null }
        }
        if (h.pre150 && table === 'diagnostics' && COLS_150.some((c) => cols.includes(c))) return { data: null, error: { code: '42703', message: 'column does not exist' } }
        const found = rows()
        return single ? { data: found[0] ?? null, error: null } : { data: found, error: null }
      }
      const b: Record<string, unknown> = {
        select: (c?: string) => { cols = c ?? '*'; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        not: (c: string, _o: string, v: unknown) => { filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return b },
        like: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => run(true),
        single: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient() }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/internal-auth', () => ({ hasValidInternalToken: () => true, internalFetchHeaders: () => ({}), internalBaseUrl: () => 'http://localhost' }))
const analyzer = vi.hoisted(() => ({ analyze: vi.fn() }))
vi.mock('@/lib/ai/point-a-analyzer', () => ({ analyzePointA: (...a: unknown[]) => analyzer.analyze(...a) }))

const { POST } = await import('@/app/api/v1/diagnostics/ai-analyze/route')
const { pointAAnalysisInputHash } = await import('@/lib/point-a/analysis-cache')
const { AiBudgetExceededError } = await import('@/lib/ai/budget')

const USER = '11111111-1111-4111-8111-111111111111'
const DIAG = '33333333-3333-4333-8333-333333333333'
const OLD = '44444444-4444-4444-8444-444444444444'
const block = { diagnosis: 'd', benchmark_comparison: 'b', key_risk: 'r', top_recommendation: 't' }
const FULL = {
  executive_summary: 'Резюме', industry_context: 'Контекст',
  strategic_priorities: [{ title: 'П1', rationale: 'r', expected_impact: 'e' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['a', 'b'] }],
  blocks: { finance: block, sales: block, operations: block, marketing: block, strategy: block },
  model_used: 'anthropic/claude-haiku-4.5 + qwen3-8', generated_at: '2026-11-15T10:00:00.000Z',
}

function report(fail: Record<string, string> = {}): PointAAnalysisReport {
  const part = (p: string, model: string) => (fail[p] ? { ok: false, failure: fail[p], model } : { ok: true, failure: null, model })
  return {
    parts: { summary: part('summary', 'anthropic/claude-haiku-4.5'), priorities: part('priorities', 'anthropic/claude-haiku-4.5'), blocksA: part('blocksA', 'qwen3-8'), blocksB: part('blocksB', 'qwen3-8') },
    startedAt: '2026-11-15T10:00:00.000Z', finishedAt: '2026-11-15T10:00:42.000Z',
  }
}
/** The analyzer stand-in: reports, then answers. */
function answer(result: unknown, rep: PointAAnalysisReport) {
  analyzer.analyze.mockImplementation(async (...a: unknown[]) => { (a[6] as (r: PointAAnalysisReport) => void)?.(rep); return result })
}

function diag(extra: Row = {}): Row {
  return {
    id: DIAG, user_id: USER, is_current: true, overall_score: 47, health_index: 38, stage: 'early', calculated_at: '2026-11-15T09:00:00Z',
    finance_score: null, sales_score: null, operations_score: null, marketing_score: null, strategy_score: null,
    risks: [], insights: [], quick_wins: [], data_gaps: [], ai_status: 'processing', ai_analysis: null, ai_narrative: null, ...extra,
  }
}
const post = () => POST(new NextRequest('http://localhost/api/v1/diagnostics/ai-analyze', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diagnostic_id: DIAG, user_id: USER }),
}))
const row = () => h.tables.diagnostics.find((r) => r.id === DIAG)!

beforeEach(() => {
  h.updates = []
  h.pre150 = false
  h.tables = {
    diagnostics: [diag()],
    companies: [{ id: 'co', user_id: USER, name: 'ТОО', industry: 'Розница', stage: 'early' }],
    survey_answers: [{ user_id: USER, question_key: 's2_revenue_2025', answer: { value: 95_000_000 } }],
    point_a_snapshots: [],
  }
  analyzer.analyze.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('ai-analyze — the outcome is written and told (R3-PA)', () => {
  it('a failed analysis → 502 (not 200), ai_error names the parts, the model and the time are written', async () => {
    answer(null, report({ summary: 'schema', blocksA: 'http_502' }))
    const res = await post()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false, ai_status: 'failed', ai_error: 'summary:schema; blocksA:http_502' })
    expect(row()).toMatchObject({
      ai_status: 'failed', ai_error: 'summary:schema; blocksA:http_502',
      ai_model: 'anthropic/claude-haiku-4.5 + qwen3-8', ai_generated_at: '2026-11-15T10:00:42.000Z',
    })
  })

  it('3 of 4 parts → the partial analysis is stored (failed + partial + reason), never as the cached one; 502', async () => {
    const partial = { ...FULL, growth_roadmap: [], blocks: { finance: block, sales: block, operations: block }, partial: ['blocksB'] }
    answer(partial, report({ blocksB: 'cut' }))
    const res = await post()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false, partial: ['blocksB'], ai_error: 'blocksB:cut' })
    expect(row()).toMatchObject({ ai_status: 'failed', ai_error: 'blocksB:cut', ai_model: 'anthropic/claude-haiku-4.5 + qwen3-8' })
    expect((row().ai_analysis as Row).partial).toEqual(['blocksB'])
    expect(row().narrative_input_hash).toBeUndefined()
  })

  it('a complete analysis → 200, ai_error cleared, model and time written, the cache hash set; the partial marker is dropped', async () => {
    h.tables.diagnostics = [diag({ ai_status: 'failed', ai_error: 'blocksB:cut', ai_analysis: { ...FULL, partial: ['blocksB'] } })]
    answer(FULL, report())
    const res = await post()
    expect(res.status).toBe(200)
    expect(row()).toMatchObject({ ai_status: 'completed', ai_error: null, ai_model: 'anthropic/claude-haiku-4.5 + qwen3-8', ai_generated_at: '2026-11-15T10:00:42.000Z' })
    expect(row().narrative_input_hash).toEqual(expect.any(String))
    expect(row().ai_analysis).not.toHaveProperty('partial')
  })

  it('the AI budget spent → «budget» in ai_error', async () => {
    analyzer.analyze.mockRejectedValue(new AiBudgetExceededError('point_a_analysis', 'pro', 1, 1))
    const res = await post()
    expect(res.status).toBe(429)
    expect(row()).toMatchObject({ ai_status: 'failed', ai_error: 'budget' })
  })

  it('before migration 150 the status is still written (no diagnosis columns)', async () => {
    h.pre150 = true
    answer(FULL, report())
    expect((await post()).status).toBe(200)
    expect(row()).toMatchObject({ ai_status: 'completed' })
    expect(row()).not.toHaveProperty('ai_model')

    h.tables.diagnostics = [diag()]
    answer(null, report({ summary: 'timeout' }))
    expect((await post()).status).toBe(502)
    expect(row()).toMatchObject({ ai_status: 'failed' })
    expect(row()).not.toHaveProperty('ai_error')
  })

  it('a cached analysis (same input) carries the expert\'s review to the new row — the same AI text stays checked', async () => {
    // The previous row with the same input, checked by an expert.
    const answers = { s2_revenue_2025: 95_000_000 }
    const company = { id: 'co', user_id: USER, name: 'ТОО', industry: 'Розница', stage: 'early' }
    const { officialPointA, pointAFromOfficial } = await import('@/lib/point-a/official')
    const scored = pointAFromOfficial(officialPointA(diag() as Record<string, unknown>, null))!
    const hash = pointAAnalysisInputHash({
      answers, pointA: scored.blocksWithoutData.length ? { ...scored.pointA, blocksWithoutData: scored.blocksWithoutData } : scored.pointA,
      company, expertNotes: {}, locale: 'ru',
    })
    h.tables.diagnostics.push({
      id: OLD, user_id: USER, is_current: false, ai_status: 'completed', ai_analysis: FULL, narrative_input_hash: hash, ai_model: 'anthropic/claude-haiku-4.5 + qwen3-8',
      ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by: 'e-1', ai_reviewed_by_name: 'Алия', ai_expert_edits: { executive_summary: 'Текст эксперта' },
    })
    const res = await post()
    expect(await res.json()).toMatchObject({ ok: true, cached: true })
    expect(analyzer.analyze).not.toHaveBeenCalled()
    expect(row()).toMatchObject({
      ai_status: 'completed', ai_error: null, ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by_name: 'Алия',
      ai_expert_edits: { executive_summary: 'Текст эксперта' }, ai_model: 'anthropic/claude-haiku-4.5 + qwen3-8',
    })
  })
})

describe('the fan-out writes why a call never answered (R3-PA)', () => {
  it('a timeout of the analysis call → ai_status failed + ai_error «fanout:TimeoutError» on the row still processing', async () => {
    const { fireAiFanOut } = await import('@/lib/point-a/diagnostic-row')
    const works: Promise<unknown>[] = []
    const fetchImpl = (async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e }) as unknown as typeof fetch
    process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret-0123456789abcdef'
    fireAiFanOut({ baseUrl: 'https://app.test', diagnosticId: DIAG, userId: USER, locale: 'ru', paths: ['/api/v1/diagnostics/ai-analyze'] }, { fetchImpl, track: (w) => { works.push(w) }, log: () => undefined })
    await Promise.all(works)
    delete process.env.INTERNAL_TOKEN_SECRET
    expect(row()).toMatchObject({ ai_status: 'failed', ai_error: 'fanout:TimeoutError' })
  })
})
