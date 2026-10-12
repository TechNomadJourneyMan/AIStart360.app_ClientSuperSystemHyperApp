import { describe, it, expect } from 'vitest'
import { overviewSummary } from '@/lib/point-a/v4/summary'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { CURRENT_TYPICAL } from '../point-a/fixtures/answer-sets'

describe('overviewSummary', () => {
  it('no score: says what to do', () => {
    const r = calculatePointAV4({ answers: {}, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
    expect(overviewSummary(r).headline).toMatch(/^Данных пока недостаточно/)
  })
  it('a score: the number, the stage, the strongest / weakest block and blocks without data', () => {
    const r = calculatePointAV4({ answers: CURRENT_TYPICAL, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
    const o = overviewSummary(r)
    expect(o.headline).toContain(`Общий балл ${r.overall} из 100`)
    expect(o.headline).toMatch(/Без оценки из-за нехватки данных: .*«Продажи»/)
    expect(o.risks.length).toBeGreaterThan(0)
    expect(o.risks.every((x) => typeof x.text === 'string' && x.text.length > 0)).toBe(true)
  })
})
