/**
 * The diagnostics.ai_analysis collision fix (migration 091) in the routes:
 *   • POST /api/v1/point-a/narrative writes only ai_narrative (service role,
 *     own row), serves a stored narrative — also a legacy one left in
 *     ai_analysis — and never returns an AI analysis as a narrative;
 *   • POST /api/v1/diagnostics/ai-analyze merges into ai_analysis (keeps gri /
 *     pulse), refuses a diagnostic of another user before any paid call;
 *   • POST /api/v1/diagnostics/retry-ai keeps the last analysis;
 *   • GET  /api/v1/diagnostics/ai-status never returns a narrative as analysis.
 * Supabase is an in-memory double that applies eq() filters and updates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
interface Call { table: string; op: 'select' | 'update'; payload?: Row; filters: Array<[string, unknown]> }

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ client: string; table: string; op: string; payload?: Row; filters: Array<[string, unknown]> }>,
  user: null as { id: string } | null,
  saveError: null as { message: string; code?: string } | null,
  /** Table whose reads fail (select only). */
  readError: null as { table: string; error: { message: string; code?: string } } | null,
  /** Service-role update of ai_analysis fails. */
  analysisSaveError: null as { message: string; code?: string } | null,
}))

function fakeClient(name: string) {
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from(table: string) {
      const q: Call = { table, op: 'select', filters: [] }
      const rows = () => (h.tables[table] ?? []).filter((r) => q.filters.every(([c, v]) => typeof v === 'string' && v.startsWith('like:') ? true : r[c] === v))
      const run = async (single: boolean) => {
        h.calls.push({ client: name, ...q })
        if (q.op === 'update') {
          if (h.saveError && name === 'service' && 'ai_narrative' in (q.payload ?? {})) return { data: null, error: h.saveError }
          if (h.analysisSaveError && name === 'service' && 'ai_analysis' in (q.payload ?? {})) return { data: null, error: h.analysisSaveError }
          for (const r of rows()) Object.assign(r, q.payload)
          return { data: null, error: null }
        }
        if (h.readError?.table === table) return { data: null, error: h.readError.error }
        const found = rows()
        return single ? { data: found[0] ?? null, error: null } : { data: found, error: null }
      }
      const b = {
        select: () => b,
        update: (p: Row) => { q.op = 'update'; q.payload = p; return b },
        eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b },
        like: (c: string, v: string) => { q.filters.push([c, `like:${v}`]); return b },
        maybeSingle: () => run(true),
        single: () => run(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(false).then(res, rej),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient('session') }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient('session') }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient('service') }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/internal-auth', () => ({ hasValidInternalToken: () => true, internalFetchHeaders: () => ({}), internalBaseUrl: () => 'http://localhost' }))

const narrativeMock = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/lib/point-a/narrative', () => ({ generateNarrative: (...a: unknown[]) => narrativeMock.generate(...a) }))
const analyzerMock = vi.hoisted(() => ({ analyze: vi.fn() }))
vi.mock('@/lib/ai/point-a-analyzer', () => ({ analyzePointA: (...a: unknown[]) => analyzerMock.analyze(...a) }))

const narrativeRoute = await import('@/app/api/v1/point-a/narrative/route')
const analyzeRoute = await import('@/app/api/v1/diagnostics/ai-analyze/route')
const retryRoute = await import('@/app/api/v1/diagnostics/retry-ai/route')
const statusRoute = await import('@/app/api/v1/diagnostics/ai-status/route')

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const DIAG = '33333333-3333-4333-8333-333333333333'

const ANALYSIS = {
  executive_summary: 'Новый анализ',
  blocks: { sales: { diagnosis: 'Нет CRM', benchmark_comparison: '', key_risk: '', top_recommendation: 'CRM' } },
  strategic_priorities: [], growth_roadmap: [], industry_context: '', model_used: 'm', generated_at: '2026-10-06T00:00:00.000Z',
}
const NARRATIVE = {
  executive_summary: 'Кратко', strengths_text: 'С', weaknesses_text: 'Сл', risks_text: 'Р', opportunities_text: 'В',
  next_steps: ['1', '2', '3'], model_used: 'm', generated_at: '2026-10-06T00:00:00.000Z',
}

function diag(extra: Row = {}): Row {
  return {
    id: DIAG, user_id: USER, is_current: true, overall_score: 47, health_index: 38, stage: 'early',
    finance_score: null, sales_score: null, operations_score: null, marketing_score: null, strategy_score: null,
    risks: [], insights: [], quick_wins: [], data_gaps: [], ai_status: 'none', ai_analysis: null, ai_narrative: null, ...extra,
  }
}

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  h.calls = []
  h.user = { id: USER }
  h.saveError = null
  h.readError = null
  h.analysisSaveError = null
  h.tables = {
    diagnostics: [diag()],
    companies: [{ id: 'co', user_id: USER, name: 'ТОО', industry: 'Розница', stage: 'early' }],
    survey_answers: [{ user_id: USER, question_key: 's2_revenue_2025', answer: { value: 95_000_000 } }],
    profiles: [],
  }
  narrativeMock.generate.mockReset()
  analyzerMock.analyze.mockReset()
})

const updates = () => h.calls.filter((c) => c.op === 'update')

describe('POST /api/v1/point-a/narrative', () => {
  it('401 without a session', async () => {
    h.user = null
    const res = await narrativeRoute.POST(post('/api/v1/point-a/narrative', {}))
    expect(res.status).toBe(401)
  })

  it('serves the stored narrative without generating', async () => {
    h.tables.diagnostics = [diag({ ai_narrative: NARRATIVE })]
    const res = await narrativeRoute.POST(post('/api/v1/point-a/narrative', {}))
    expect(await res.json()).toMatchObject({ ok: true, cached: true, data: NARRATIVE })
    expect(narrativeMock.generate).not.toHaveBeenCalled()
  })

  it('keeps a narrative written into ai_analysis before 091 readable', async () => {
    h.tables.diagnostics = [diag({ ai_analysis: NARRATIVE, ai_status: 'completed' })]
    const res = await narrativeRoute.POST(post('/api/v1/point-a/narrative', {}))
    expect(await res.json()).toMatchObject({ ok: true, cached: true, data: NARRATIVE })
  })

  it('never serves an AI analysis as the narrative; stores the new one only in ai_narrative of the own row', async () => {
    h.tables.diagnostics = [diag({ ai_analysis: { ...ANALYSIS, gri: { overall: 6 } }, ai_status: 'completed' })]
    narrativeMock.generate.mockResolvedValue(NARRATIVE)
    const res = await narrativeRoute.POST(post('/api/v1/point-a/narrative', {}))
    expect(await res.json()).toMatchObject({ ok: true, persisted: true, data: NARRATIVE })
    expect(narrativeMock.generate).toHaveBeenCalledTimes(1)
    expect(updates()).toEqual([{ client: 'service', table: 'diagnostics', op: 'update', payload: { ai_narrative: NARRATIVE }, filters: [['id', DIAG], ['user_id', USER]] }])
    const row = h.tables.diagnostics[0]
    expect(row.ai_analysis).toEqual({ ...ANALYSIS, gri: { overall: 6 } })
    expect(row.ai_status).toBe('completed')
    expect(row.ai_narrative).toEqual(NARRATIVE)
  })

  it('reports a failed save instead of hiding it, and a failed generation as 503', async () => {
    narrativeMock.generate.mockResolvedValue(NARRATIVE)
    h.saveError = { message: 'column "ai_narrative" does not exist', code: '42703' }
    const res = await narrativeRoute.POST(post('/api/v1/point-a/narrative', {}))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, persisted: false })
    expect(body.warning).toContain('не сохранено')
    expect(JSON.stringify(body)).not.toContain('does not exist')

    narrativeMock.generate.mockResolvedValue(null)
    const failed = await narrativeRoute.POST(post('/api/v1/point-a/narrative', { regenerate: true }))
    expect(failed.status).toBe(503)
    expect(h.tables.diagnostics[0].ai_status).toBe('none')
  })
})

describe('POST /api/v1/diagnostics/ai-analyze', () => {
  it('merges into ai_analysis, keeping gri / pulse, and never touches the narrative', async () => {
    h.tables.diagnostics = [diag({
      ai_analysis: { executive_summary: 'старый', blocks: {}, gri: { overall: 6.4 }, pulse: { avgCheck: 12000 } },
      ai_narrative: NARRATIVE,
    })]
    analyzerMock.analyze.mockResolvedValue(ANALYSIS)
    const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
    expect(await res.json()).toMatchObject({ ok: true, ai_status: 'completed' })
    const row = h.tables.diagnostics[0]
    expect(row.ai_analysis).toEqual({ ...ANALYSIS, gri: { overall: 6.4 }, pulse: { avgCheck: 12000 } })
    expect(row.ai_status).toBe('completed')
    expect(row.ai_narrative).toEqual(NARRATIVE)
    for (const u of updates()) {
      expect(u.client).toBe('service')
      expect(u.filters).toEqual([['id', DIAG], ['user_id', USER]])
      expect(u.payload).not.toHaveProperty('ai_narrative')
    }
  })

  it('replaces a legacy narrative in ai_analysis with a real analysis', async () => {
    h.tables.diagnostics = [diag({ ai_analysis: NARRATIVE, ai_status: 'completed' })]
    analyzerMock.analyze.mockResolvedValue(ANALYSIS)
    await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
    expect(h.tables.diagnostics[0].ai_analysis).toEqual(ANALYSIS)
  })

  it('refuses a diagnostic that does not belong to user_id before any model call', async () => {
    const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: OTHER }))
    expect(res.status).toBe(404)
    expect(analyzerMock.analyze).not.toHaveBeenCalled()
    expect(updates()).toEqual([])
  })

  it('a failed save is written as ai_status failed, not left «processing»', async () => {
    analyzerMock.analyze.mockResolvedValue(ANALYSIS)
    h.analysisSaveError = { message: 'value too long', code: '22001' }
    const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
    expect(res.status).toBe(500)
    expect(h.tables.diagnostics[0].ai_status).toBe('failed')
  })

  it('an exception after the body was read still marks the verified diagnostic failed', async () => {
    analyzerMock.analyze.mockRejectedValue(new Error('provider exploded'))
    const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
    expect(res.status).toBe(500)
    expect(h.tables.diagnostics[0].ai_status).toBe('failed')
  })

  it('an exception before the ownership check never touches any row', async () => {
    const bad = new NextRequest('http://localhost/api/v1/diagnostics/ai-analyze', { method: 'POST', body: 'not json' })
    const res = await analyzeRoute.POST(bad)
    expect(res.status).toBe(500)
    expect(updates()).toEqual([])
  })

  it('a failed survey / company / expert-notes read stops before the model call and marks failed', async () => {
    for (const table of ['survey_answers', 'companies']) {
      h.tables.diagnostics = [diag()]
      h.readError = { table, error: { message: 'statement timeout', code: '57014' } }
      const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
      expect(res.status, table).toBe(500)
      expect(h.tables.diagnostics[0].ai_status, table).toBe('failed')
    }
    expect(analyzerMock.analyze).not.toHaveBeenCalled()
  })

  it('no survey answers → 422 and failed, no paid call on empty input', async () => {
    h.tables.survey_answers = []
    const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
    expect(res.status).toBe(422)
    expect(h.tables.diagnostics[0].ai_status).toBe('failed')
    expect(analyzerMock.analyze).not.toHaveBeenCalled()
  })

  it('a failed analysis marks the status and keeps the stored analysis', async () => {
    h.tables.diagnostics = [diag({ ai_analysis: ANALYSIS, ai_status: 'completed' })]
    analyzerMock.analyze.mockResolvedValue(null)
    const res = await analyzeRoute.POST(post('/api/v1/diagnostics/ai-analyze', { diagnostic_id: DIAG, user_id: USER }))
    expect(await res.json()).toMatchObject({ ok: false, ai_status: 'failed' })
    expect(h.tables.diagnostics[0]).toMatchObject({ ai_status: 'failed', ai_analysis: ANALYSIS })
  })
})

describe('POST /api/v1/diagnostics/retry-ai', () => {
  it('marks processing without wiping the last analysis', async () => {
    h.tables.diagnostics = [diag({ ai_analysis: { ...ANALYSIS, gri: { overall: 6 } }, ai_status: 'failed' })]
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    const res = await retryRoute.POST(post('/api/v1/diagnostics/retry-ai', { diagnostic_id: DIAG }))
    expect(await res.json()).toMatchObject({ ok: true, ai_status: 'processing' })
    expect(updates()).toEqual([{ client: 'service', table: 'diagnostics', op: 'update', payload: { ai_status: 'processing' }, filters: [['id', DIAG], ['user_id', USER]] }])
    expect(h.tables.diagnostics[0].ai_analysis).toEqual({ ...ANALYSIS, gri: { overall: 6 } })
    vi.unstubAllGlobals()
  })
})

describe('GET /api/v1/diagnostics/ai-status', () => {
  const get = () => statusRoute.GET(new NextRequest(`http://localhost/api/v1/diagnostics/ai-status?diagnostic_id=${DIAG}`))

  it('returns the analysis, but not a narrative left in ai_analysis', async () => {
    h.tables.diagnostics = [diag({ ai_analysis: ANALYSIS, ai_status: 'completed' })]
    expect((await (await get()).json()).data).toEqual({ ai_status: 'completed', ai_analysis: ANALYSIS })
    h.tables.diagnostics = [diag({ ai_analysis: NARRATIVE, ai_status: 'completed' })]
    expect((await (await get()).json()).data).toEqual({ ai_status: 'completed', ai_analysis: null })
  })
})
