/**
 * «Первичная Точка А» after the express flow (spec 2026-10-23 §7.2, §16 Ф2):
 * the express answers of the «filled» fixture close 15/15 of the minimum and
 * give a v4 overall over ≥ 3 blocks; «не знаю» leaves a block honestly
 * «данных не хватает»; the label is «Первичная» while a block has no data.
 */
import { describe, expect, it } from 'vitest'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { PRIMARY_POINT_A_LABEL, blocksWithoutScore, isPrimaryPointA, pointAStatus } from '@/lib/point-a/v4/primary'
import { EXPRESS_SCREENS } from '@/lib/survey/questions'
import { pointAMinimum } from '@/lib/survey/progress'
import { unknownAnswer } from '@/lib/survey/answer-value'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const blocks = effectiveBlocks(DEFAULT_TEMPLATE)
const EXPRESS_KEYS = EXPRESS_SCREENS.flatMap((s) => s.keys)
/** As the snapshot reads survey_answers: `answer.value` (unknown → null, approx → its value). */
const stored = (answers: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v && typeof v === 'object' && 'unknown' in v ? null : v && typeof v === 'object' && 'approx' in v ? (v as unknown as { value: number }).value : v]))
const expressOnly = (): Record<string, unknown> => {
  const filled = previewAnswers('filled')
  return Object.fromEntries(EXPRESS_KEYS.filter((k) => k in filled).map((k) => [k, filled[k]]))
}

describe('primary Point A after the express flow', () => {
  it('the express answers close 15 of 15 checks of the minimum', () => {
    const m = pointAMinimum(expressOnly())
    expect(m.answered).toBe(m.total)
    expect(m.total).toBe(15)
  })

  it('v4 gives an overall over at least 3 blocks; the rest stay without data → «Первичная»', () => {
    const v4 = calculatePointAV4({ answers: stored(expressOnly()), blocks })
    const scored = v4.blocks.filter((b) => b.score !== null)
    expect(v4.overall).not.toBeNull()
    expect(scored.length).toBeGreaterThanOrEqual(3)
    expect(v4.blocks.find((b) => b.key === 'product')?.status).toBe('insufficient_data')
    expect(isPrimaryPointA(v4.blocks)).toBe(true)
    expect(pointAStatus(v4)).toMatchObject({ kind: 'primary' })
    expect(PRIMARY_POINT_A_LABEL).toBe('Первичная · по быстрым данным')
  })

  it('«не знаю» margin and debts → finance honestly without data', () => {
    const answers = { ...expressOnly(), s9n_net_margin: unknownAnswer(), s9n_debts_amount: unknownAnswer() }
    const v4 = calculatePointAV4({ answers: stored(answers), blocks })
    expect(v4.blocks.find((b) => b.key === 'finance')?.status).toBe('insufficient_data')
    expect(v4.blocks.find((b) => b.key === 'finance')?.score).toBeNull()
    expect(blocksWithoutScore(v4.blocks)).toContain('finance')
  })

  it('everything «не знаю» / empty → «данных мало», never a number', () => {
    const v4 = calculatePointAV4({ answers: { s1_company_name: 'А' }, blocks })
    expect(pointAStatus(v4)).toEqual({ kind: 'too_little', scored: [] })
    expect(pointAStatus(null)).toEqual({ kind: 'none' })
  })

  it('all weighed blocks scored → full; informational blocks do not count', () => {
    const b = (key: string, score: number | null, informational = false) => ({ key, score, status: score === null ? 'insufficient_data' : 'ok', informational })
    expect(pointAStatus({ overall: 70, blocks: [b('finance', 70), b('product', null, true)] })).toEqual({ kind: 'full', overall: 70 })
    expect(isPrimaryPointA([b('finance', 70), b('team', null)])).toBe(true)
  })
})
