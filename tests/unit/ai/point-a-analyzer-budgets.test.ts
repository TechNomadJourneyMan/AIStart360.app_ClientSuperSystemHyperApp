/**
 * Point A's four structured calls: output budgets that fit a Russian JSON
 * answer (the old 1200–2000 tokens cut it mid-sentence), tiers unchanged.
 */
import { describe, expect, it, vi } from 'vitest'

const structured = vi.hoisted(() => ({ generate: vi.fn(async () => null) }))
vi.mock('@/lib/ai/structured', () => ({ generateObjectViaOpenRouter: structured.generate }))
vi.mock('@/lib/ai/openrouter', () => ({
  OPENROUTER_MODELS: { sonnet: 'anthropic/claude-sonnet-4.5', haiku: 'anthropic/claude-haiku-4.5' },
  hasOpenRouterKey: () => true,
}))

import { analyzePointA } from '@/lib/ai/point-a-analyzer'
import type { PointA } from '@/types/onboarding'

const block = { score: 50 }
const pointA = {
  overall_score: 50, health_index: 50, stage: 'growth',
  blocks: { finance: block, sales: block, operations: block, marketing: block, strategy: block },
  risks: [], data_gaps: [],
} as unknown as PointA

describe('analyzePointA budgets', () => {
  it('summary 2500, priorities 3000, both block calls 4000; complexities unchanged', async () => {
    expect(await analyzePointA({}, pointA, null)).toBeNull()
    const calls = (structured.generate.mock.calls as unknown as Array<[{ label: string; maxTokens: number; complexity: string }]>)
      .map(([o]) => [o.label, o.maxTokens, o.complexity])
    expect(calls).toEqual([
      ['point-a:summary', 2500, 'high'],
      ['point-a:priorities', 3000, 'high'],
      ['point-a:blocksA', 4000, 'medium'],
      ['point-a:blocksB', 4000, 'medium'],
    ])
  })
})
