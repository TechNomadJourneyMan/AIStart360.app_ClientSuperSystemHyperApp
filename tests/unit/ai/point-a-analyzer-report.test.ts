/**
 * R3-PA (П1а): the 4-part AI analysis of Point A tells what happened to each
 * part (diagnostics.ai_error / ai_model / ai_generated_at) and keeps a PARTIAL
 * analysis when 3 of the 4 parts came — before, one broken part threw the
 * whole paid analysis away and nothing said why (11-05: 12 paid calls,
 * ok=true, nothing stored, no reason anywhere). Tiers unchanged (blocks — light).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredDiagnostics } from '@/lib/ai/structured'

type Opts = { label: string; complexity: string; onDiagnostics?: (d: StructuredDiagnostics) => void }
const s = vi.hoisted(() => ({ answer: {} as Record<string, unknown>, fail: {} as Record<string, string> }))

vi.mock('@/lib/ai/structured', () => ({
  generateObjectViaOpenRouter: vi.fn(async (o: Opts) => {
    const part = o.label.replace('point-a:', '')
    const model = o.complexity === 'high' ? 'anthropic/claude-haiku-4.5' : 'qwen3-8'
    if (s.fail[part]) {
      o.onDiagnostics?.({ ok: false, failure: s.fail[part], model, attempts: 2 })
      return null
    }
    o.onDiagnostics?.({ ok: true, failure: null, model, attempts: 1 })
    return s.answer[part]
  }),
}))
vi.mock('@/lib/ai/openrouter', () => ({ hasOpenRouterKey: () => true }))

const { analyzePointA } = await import('@/lib/ai/point-a-analyzer')
const { aiErrorOf, aiModelOf } = await import('@/lib/point-a/ai-review')
import type { PointA } from '@/types/onboarding'
import type { PointAAnalysisReport } from '@/lib/point-a/ai-review'

const block = { diagnosis: 'd', benchmark_comparison: 'b', key_risk: 'r', top_recommendation: 't' }
const roadmap = [{ horizon: '30_days', actions: ['a', 'b'] }, { horizon: '90_days', actions: ['c', 'd'] }, { horizon: '180_days', actions: ['e', 'f'] }]
const pointA = { overall_score: 60, health_index: 50, stage: 'growth', blocks: { finance: { score: 60 }, sales: { score: 60 }, operations: { score: 60 }, marketing: { score: 60 }, strategy: { score: 60 } }, risks: [], data_gaps: [] } as unknown as PointA

beforeEach(() => {
  s.fail = {}
  s.answer = {
    summary: { executive_summary: 'Резюме', industry_context: 'Контекст' },
    priorities: { strategic_priorities: [{ title: 'П1', rationale: 'r', expected_impact: 'e' }, { title: 'П2', rationale: 'r', expected_impact: 'e' }] },
    blocksA: { finance: block, sales: block, operations: block },
    blocksB: { marketing: block, strategy: block, growth_roadmap: roadmap },
  }
})

async function run() {
  let report: PointAAnalysisReport | null = null
  const result = await analyzePointA({}, pointA, null, null, 'ru', [], (r) => { report = r })
  return { result, report: report as PointAAnalysisReport | null }
}

describe('analyzePointA — report and partial result', () => {
  it('all 4 parts: a complete analysis, the real models in model_used, no error', async () => {
    const { result, report } = await run()
    expect(result?.partial).toBeUndefined()
    expect(Object.keys(result!.blocks)).toEqual(['finance', 'sales', 'operations', 'marketing', 'strategy'])
    expect(result!.model_used).toBe('anthropic/claude-haiku-4.5 + qwen3-8')
    expect(aiErrorOf(report!)).toBeNull()
    expect(aiModelOf(report!)).toBe('anthropic/claude-haiku-4.5 + qwen3-8')
  })

  it('3 of 4 (blocksB cut): the partial analysis is kept with `partial`, the reason is reported', async () => {
    s.fail = { blocksB: 'cut' }
    const { result, report } = await run()
    expect(result?.partial).toEqual(['blocksB'])
    expect(result!.executive_summary).toBe('Резюме')
    expect(result!.strategic_priorities).toHaveLength(2)
    expect(Object.keys(result!.blocks)).toEqual(['finance', 'sales', 'operations'])
    expect(result!.growth_roadmap).toEqual([])
    expect(aiErrorOf(report!)).toBe('blocksB:cut')
  })

  it('2 of 4: no analysis (nothing invented), both reasons reported', async () => {
    s.fail = { summary: 'schema', blocksA: 'http_502' }
    const { result, report } = await run()
    expect(result).toBeNull()
    expect(aiErrorOf(report!)).toBe('summary:schema; blocksA:http_502')
    expect(report!.finishedAt >= report!.startedAt).toBe(true)
  })

  it('the tiers stay: summary / priorities high, the blocks medium (light, Qwen)', async () => {
    const { generateObjectViaOpenRouter } = await import('@/lib/ai/structured')
    const calls = (generateObjectViaOpenRouter as unknown as { mock: { calls: Array<[Opts]> } }).mock.calls.slice(-4).map(([o]) => [o.label, o.complexity])
    expect(calls).toEqual([['point-a:summary', 'high'], ['point-a:priorities', 'high'], ['point-a:blocksA', 'medium'], ['point-a:blocksB', 'medium']])
  })
})
