import { describe, it, expect, vi } from 'vitest'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { blocksNeedingHypothesis, carryOverHypotheses, generateHypotheses, hypothesisConfidence, hypothesisPrompt, MAX_HYPOTHESIS_CONFIDENCE } from '@/lib/point-a/v4/hypotheses'
import { CURRENT_TYPICAL } from '../point-a/fixtures/answer-sets'

const blocks = () => calculatePointAV4({ answers: CURRENT_TYPICAL, blocks: effectiveBlocks(DEFAULT_TEMPLATE) }).blocks

describe('AI hypotheses of blocks without data', () => {
  it('only blocks without a score that have something to go on', () => {
    const need = blocksNeedingHypothesis(blocks())
    expect(need.every((b) => b.status === 'insufficient_data' && b.coverage > 0)).toBe(true)
    expect(need.map((b) => b.key)).toContain('sales') // coverage 0.29
    expect(need.map((b) => b.key)).not.toContain('marketing') // nothing at all
  })

  it('confidence never exceeds 0.4', () => {
    expect(hypothesisConfidence(0.39)).toBeLessThanOrEqual(MAX_HYPOTHESIS_CONFIDENCE)
    expect(hypothesisConfidence(0.05)).toBeGreaterThan(0)
  })

  it('the prompt carries what is known and unknown, no invented numbers', () => {
    const sales = blocks().find((b) => b.key === 'sales')!
    const { user } = hypothesisPrompt(sales, { industry: 'Услуги', otherBlocks: [{ title: 'Финансы', score: 47 }] })
    expect(user).toContain('Блок: «Продажи»')
    expect(user).toContain('Неизвестно')
    expect(user).toContain('Финансы: 47')
  })

  it('generates, clamps and attaches; a failed call leaves the block as is', async () => {
    const generate = vi.fn(async ({ user }: { user: string }) => (user.includes('Продажи') ? { score: 140, rationale: 'Есть CRM, но нет данных по воронке.' } : null))
    const r = await generateHypotheses(blocks(), { industry: null, userId: 'u' }, { generate, now: () => new Date('2026-10-12T00:00:00Z') })
    const sales = r.blocks.find((b) => b.key === 'sales')!
    expect(sales.hypothesis).toMatchObject({ score: 100, rationale: 'Есть CRM, но нет данных по воронке.', generatedAt: '2026-10-12T00:00:00.000Z' })
    expect(sales.hypothesis!.confidence).toBeLessThanOrEqual(0.4)
    expect(sales.score).toBeNull() // never a FACT, never in the overall
    expect(r.generated).toBe(1)
  })

  it('a hypothesis is carried over while the block inputs stay the same', () => {
    const prev = blocks().map((b) => (b.key === 'sales' ? { ...b, hypothesis: { score: 40, confidence: 0.3, rationale: 'x', generatedAt: 't' } } : b))
    const next = carryOverHypotheses(blocks(), prev)
    expect(next.find((b) => b.key === 'sales')!.hypothesis?.score).toBe(40)
    const changed = carryOverHypotheses(blocks().map((b) => (b.key === 'sales' ? { ...b, inputsHash: 'other' } : b)), prev)
    expect(changed.find((b) => b.key === 'sales')!.hypothesis).toBeUndefined()
  })
})
