import { describe, it, expect } from 'vitest'
import { calculateGri, type GriAnswers } from '@/lib/gri/logic'

// Answers that drive all SIX measurable blocks to a full 100, so the only thing
// that can move the overall score is how the (unmeasurable) trust block is handled.
function perfectSixBlocks(): GriAnswers {
  return {
    revenue: 10_000_000,
    margin: 50, // businessModel margin half → 50
    cac: 1,
    ltv: 300, // ltv/cac = 300 ≥ 3 → businessModel ratio half → 50  (block = 100)
    runway: 12, // cash → 100
    industry: 'services',
    mainOffer: 'consulting',
    avgCheck: 100_000,
    conversionRate: 15, // product conv → 70
    hasScripts: true, // product scripts → 30  (block = 100)
    hasCrm: true, // operations → 40
    processesDocumented: true, // operations → 60  (block = 100)
    delegationReady: true, // team → 50
    teamSize: 10, // team → 50  (block = 100)
    ownerHoursWeekly: 20, // founder hours → 60
    hasDeputy: true, // founder deputy → 40  (block = 100)
  }
}

describe('calculateGri — honest trust block (no fabricated 50)', () => {
  it('reports trustScore as null when no qualitative trust signals exist', () => {
    const r = calculateGri(perfectSixBlocks())
    expect(r.trustScore).toBeNull()
  })

  it('averages only the measurable blocks, so a perfect 6-block business scores 100 (not diluted to ~93 by a phantom 50)', () => {
    const r = calculateGri(perfectSixBlocks())
    expect(r.blocksUsed).toBe(6)
    expect(r.score).toBe(100)
  })

  it('does not pull a weak business up toward 50 via the trust placeholder', () => {
    // All measurable blocks near-zero except founder (default 40h → 30).
    const weak: GriAnswers = {
      revenue: 0, margin: 0, cac: 0, ltv: 0, runway: 0,
      industry: '', mainOffer: '', avgCheck: 0,
    }
    const r = calculateGri(weak)
    // blocks: businessModel 0, cash 0, product 0, operations 0, team 0, founder 30
    // honest mean over 6 = 5; the old phantom-50 formula would have yielded ~11.
    expect(r.trustScore).toBeNull()
    expect(r.blocksUsed).toBe(6)
    expect(r.score).toBe(5)
  })

  it('leaves the six measurable block scores unchanged (regression guard)', () => {
    const r = calculateGri(perfectSixBlocks())
    expect(r.businessModelScore).toBe(100)
    expect(r.cashScore).toBe(100)
    expect(r.productScore).toBe(100)
    expect(r.operationsScore).toBe(100)
    expect(r.teamScore).toBe(100)
    expect(r.founderScore).toBe(100)
  })
})
