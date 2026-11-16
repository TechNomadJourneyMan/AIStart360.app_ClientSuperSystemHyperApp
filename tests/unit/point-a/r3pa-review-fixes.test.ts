/**
 * Ревью R3-PA — the remaining fixes, by behaviour:
 *   H1  the page: «готовится» older than 15 min shows «не завершился — Повторить»,
 *       the polling slows down and stops being fast; the snapshot marks
 *       «готовится» only when the call can go (a trusted origin exists);
 *   L2  hypotheses after the move to a paid plan (catchUpPaidAi → catchUpHypotheses);
 *   L3  the PDF / share label of a partial / failed-retry analysis says so;
 *   L4  the failure code and the model are stripped for a client;
 *   L5  the score path needs one block on facts.
 */
import { describe, expect, it, vi } from 'vitest'
import { aiAnalysisNote, aiAnalysisView, aiFailureText, aiViewForViewer } from '@/lib/point-a/ai-review'
import { pollIntervalOf } from '@/hooks/usePointAState'
import { pointAScorePath } from '@/lib/point-a/v4/score-path'
import { buildPointASnapshot, catchUpHypotheses, type SnapshotDeps } from '@/lib/point-a/snapshot'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { memoryClient } from '../data-layer/memory-client'
import { CURRENT_TYPICAL } from './fixtures/answer-sets'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const AI = { executive_summary: 'Резюме', strategic_priorities: [], growth_roadmap: [], blocks: {}, industry_context: 'к' }

describe('H1 — «готовится» is not for ever', () => {
  it('older than 15 min → failed / stale with «Повторить» text; fresh → processing with its start', () => {
    const stale = aiAnalysisView({ id: 'd', ai_status: 'processing', ai_started_at: ago(20), ai_analysis: null }, { now: NOW })!
    expect(stale).toMatchObject({ status: 'failed', errorCode: 'stale', startedAt: null })
    expect(aiFailureText(stale)).toBe('Разбор ИИ не завершился.')
    const kept = aiAnalysisView({ id: 'd', ai_status: 'processing', ai_started_at: ago(20), ai_analysis: AI }, { now: NOW })!
    expect(aiFailureText(kept)).toContain('предыдущий вариант')
    // a new row («готовится» since its insertion) without ai_started_at — by calculated_at
    expect(aiAnalysisView({ id: 'd', ai_status: 'processing', calculated_at: ago(30) }, { now: NOW })?.status).toBe('failed')
    const fresh = aiAnalysisView({ id: 'd', ai_status: 'processing', ai_started_at: ago(2) }, { now: NOW })!
    expect(fresh).toMatchObject({ status: 'processing', startedAt: ago(2) })
  })

  it('the page polls every 10 s at first, every 30 s after 3 min, and back to 60 s once the server says it failed', () => {
    const state = (ai: unknown) => ({ recalculation: 'idle', aiAnalysis: ai }) as never
    expect(pollIntervalOf(state({ status: 'processing', startedAt: ago(1) }), NOW)).toBe(10_000)
    expect(pollIntervalOf(state({ status: 'processing', startedAt: ago(5) }), NOW)).toBe(30_000)
    expect(pollIntervalOf(state({ status: 'failed' }), NOW)).toBe(60_000)
  })

  it('the snapshot marks «готовится» only when the analysis call can go (a trusted origin)', async () => {
    const prev = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'k'
    try {
      const run = async (baseUrl: string | null) => {
        const m = memoryClient({ companies: [{ id: 'co', user_id: 'owner', industry: 'Услуги' }], point_a_snapshots: [], diagnostics: [] })
        const store = vi.fn(async () => ({ ok: true as const, diag: { id: 'diag-1' } }))
        const deps: SnapshotDeps = {
          service: () => m.client,
          materialize: async () => ({ values: resolveAllMetrics({ companyId: 'co', userId: 'owner', surveyAnswers: CURRENT_TYPICAL, documents: [], now: new Date('2026-10-12') }), surveyAnswers: CURRENT_TYPICAL }),
          useV4: async () => false,
          store: store as unknown as SnapshotDeps['store'],
          lock: async () => ({ release: async () => undefined }),
          afterWrite: () => undefined,
          paidAi: async () => ['/api/v1/diagnostics/ai-analyze'],
          baseUrl: () => baseUrl,
        }
        await buildPointASnapshot('co', { trigger: 'event' }, deps)
        return (store.mock.calls[0] as unknown as [unknown, { aiStatus: string }])[1].aiStatus
      }
      expect(await run('https://app.test')).toBe('processing')
      expect(await run(null)).toBe('none')
    } finally {
      process.env.OPENROUTER_API_KEY = prev
    }
  })
})

describe('L2 — hypotheses after the move to a paid plan', () => {
  const block = { key: 'marketing', title: 'Маркетинг', weight: 0.2, informational: false, status: 'insufficient_data', score: null, coverage: 0.2, checks: [], inputsHash: 'x' }
  function sb(snapshot: Record<string, unknown> | null) {
    return memoryClient({ companies: [{ id: 'co', user_id: 'owner', industry: 'Услуги' }], point_a_snapshots: snapshot ? [{ company_id: 'co', created_at: '2026-11-15T00:00:00Z', ...snapshot }] : [] }).client
  }

  it('the latest full snapshot with a block that needs a hypothesis → asked for; preliminary / none → not', async () => {
    const add = vi.fn(async () => undefined)
    expect(await catchUpHypotheses('owner', { service: () => sb({ id: 's1', blocks: [block], v4: { assessment: 'full' } }), add })).toBe(true)
    expect(add).toHaveBeenCalledWith('s1', [block], 'Услуги', 'owner')
    expect(await catchUpHypotheses('owner', { service: () => sb({ id: 's2', blocks: [block], v4: { assessment: 'preliminary' } }), add })).toBe(false)
    expect(await catchUpHypotheses('owner', { service: () => sb(null), add })).toBe(false)
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('catchUpPaidAi asks for them when Точка А opens', async () => {
    vi.resetModules()
    vi.doMock('@/lib/access/decision', async () => ({
      ...(await vi.importActual<Record<string, unknown>>('@/lib/access/decision')),
      resolveFeature: async () => ({ allowed: true, reason: 'entitled', ent: {}, gatesEnabled: true }),
    }))
    vi.doMock('@/lib/point-a/official', async () => ({ ...(await vi.importActual<Record<string, unknown>>('@/lib/point-a/official')), getOfficialPointA: async () => ({ state: 'scored' }) }))
    const { catchUpPaidAi } = await import('@/lib/point-a/diagnostic-row')
    const hypotheses = vi.fn(async () => undefined)
    const fake = { from: () => { const b: Record<string, unknown> = {}; const self = () => b; Object.assign(b, { select: self, eq: self, maybeSingle: async () => ({ data: { id: 'd-1', ai_status: 'completed' }, error: null }) }); return b } }
    await catchUpPaidAi('owner', { sb: fake as never, baseUrl: 'https://app.test', fire: () => undefined, hypotheses })
    await vi.waitFor(() => expect(hypotheses).toHaveBeenCalledWith('owner'))
    vi.doUnmock('@/lib/access/decision')
    vi.doUnmock('@/lib/point-a/official')
  })
})

describe('L3 / L4 — labels and what a client gets', () => {
  it('a partial analysis and an earlier one after a failed retry are labelled so in the PDF / share line', () => {
    const partial = aiAnalysisView({ id: 'd', ai_status: 'failed', ai_analysis: { ...AI, partial: ['blocksB'] } })
    expect(aiAnalysisNote(partial)).toMatch(/^Черновик ИИ — эксперт проверит\..*Часть разбора не получилась: разбор маркетинга и стратегии/)
    const earlier = aiAnalysisView({ id: 'd', ai_status: 'failed', ai_analysis: AI })
    expect(aiAnalysisNote(earlier)).toContain('показан предыдущий вариант')
    expect(aiAnalysisNote(aiAnalysisView({ id: 'd', ai_status: 'completed', ai_analysis: AI }))).not.toContain('не получилась')
  })

  it('the failure code and the model are for staff only', () => {
    const v = aiAnalysisView({ id: 'd', ai_status: 'failed', ai_analysis: null, ai_error: 'summary:schema', ai_model: 'qwen3-8' })
    expect(aiViewForViewer(v, false)).toMatchObject({ errorCode: null, model: null, status: 'failed' })
    expect(aiViewForViewer(v, true)).toMatchObject({ errorCode: 'summary:schema', model: 'qwen3-8' })
    expect(aiViewForViewer(null, false)).toBeNull()
    // «не завершился» is not a provider code — the client keeps it (the text depends on it)
    expect(aiViewForViewer(aiAnalysisView({ id: 'd', ai_status: 'failed', ai_error: 'stale' }), false)?.errorCode).toBe('stale')
  })
})

describe('L5 — the score path needs one block on facts', () => {
  const b = (key: string, weight: number, score: number | null, basis?: 'facts' | 'inferred') => ({
    key, weight, score, basis, checks: Array.from({ length: 5 }, (_, i) => ({ id: `${key}${i}`, max: 10, answered: score !== null && i < 3 })),
  })

  it('enough weight only from confirmed hypotheses → NOT enough: one block must be filled with facts', () => {
    const path = pointAScorePath([b('finance', 0.5, 60, 'inferred'), b('sales', 0.3, 50, 'inferred'), b('marketing', 0.2, null)], { surveySent: true })
    expect(path.dataEnough).toBe(false)
    expect(path.toFill.map((x) => x.key)).toEqual(['marketing'])
    expect(pointAScorePath([b('finance', 0.5, 60), b('sales', 0.3, 50, 'inferred'), b('marketing', 0.2, null)], { surveySent: true }).dataEnough).toBe(true)
  })
})
