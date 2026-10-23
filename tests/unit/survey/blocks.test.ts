/**
 * Deepening blocks (spec §7.4, §7.5): progress, recommended three, next block.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK_TIE_ORDER, SURVEY_BLOCK_V4, blockProgress, blockProgressText, blocksCompletedBy, nextBlock, recommendedBlocks } from '@/lib/survey/blocks'
import { SURVEY_BLOCKS, SURVEY_BLOCK_IDS, surveyBlock } from '@/lib/survey/questions'
import { unknownAnswer } from '@/lib/survey/answer-value'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const b11 = surveyBlock('b11')!

describe('block progress', () => {
  it('«Заполнено 6 из 21 · ~5 мин осталось»; «не знаю» and «нет» count', () => {
    const answers: Record<string, unknown> = { s9n_revenue_2024: 1, s9n_net_profit: unknownAnswer(), s9n_change_vs_2023: '+10%', s9n_revenue_sources: 'x', s9n_seasonality: 'y', s9n_dividend_policy: 'z' }
    const p = blockProgress(b11, answers)
    expect(p).toMatchObject({ filled: 6, total: 21, complete: false })
    expect(blockProgressText(p)).toBe(`Заполнено 6 из 21 · ~${p.minutesLeft} мин осталось`)
    expect(blockProgress(surveyBlock('b15')!, { s12_it_support: false }).filled).toBe(1)
  })
  it('a filled block is complete', () => {
    const p = blockProgress(b11, previewAnswers('filled'))
    expect(p.complete).toBe(true)
    expect(blockProgressText(p)).toMatch(/Заполнено полностью/)
  })
})

describe('recommended blocks', () => {
  it('without a snapshot: Б10, Б11, Б5', () => {
    expect(recommendedBlocks({}).map((r) => r.block.id)).toEqual(['b10', 'b11', 'b5'])
  })
  it('by the v4 blocks still without data: weight × gain / minutes', () => {
    const snapshot = {
      blocks: [
        { key: 'finance', weight: 0.25, status: 'ok', coverage: 0.6 },
        { key: 'sales', weight: 0.2, status: 'ok', coverage: 0.5 },
        { key: 'team', weight: 0.1, status: 'insufficient_data', coverage: 0.2 },
        { key: 'product', weight: 0.08, status: 'insufficient_data', coverage: 0 },
        { key: 'operations', weight: 0.15, status: 'ok', coverage: 1 },
      ],
      uploadChecklist: [{ block: 'team', gain: 6 }],
    }
    const rec = recommendedBlocks({}, snapshot)
    // product: b4 (2 min) beats b3 (8 min); team: b13 (5 min) / b12 (6 min).
    expect(rec.map((r) => r.block.id)).toEqual(['b4', 'b6', 'b3'])
    expect(rec[0].improves).toEqual(['product'])
  })
  it('finished blocks are never recommended', () => {
    const filled = previewAnswers('filled')
    // The fixture leaves only the file questions (b1, b7) open.
    expect(recommendedBlocks(filled).map((r) => r.block.id).sort()).toEqual(['b1', 'b7'])
    for (const r of recommendedBlocks(filled)) expect(blockProgress(r.block, filled).complete).toBe(false)
  })
  it('tie order covers all 15 blocks once; every block has a v4 link entry', () => {
    expect([...BLOCK_TIE_ORDER].sort()).toEqual([...SURVEY_BLOCK_IDS].sort())
    expect(Object.keys(SURVEY_BLOCK_V4).sort()).toEqual([...SURVEY_BLOCK_IDS].sort())
  })
})

describe('next block and completion', () => {
  it('next unfinished block, wrapping', () => {
    expect(nextBlock('b1', {})?.id).toBe('b2')
    expect(nextBlock('b15', {})?.id).toBe('b1')
  })
  it('blocksCompletedBy: the write that answers the last key of a block', () => {
    const b14 = SURVEY_BLOCKS.find((b) => b.id === 'b14')!
    const after = { [b14.keys[0]]: [{ name: 'Банк', role: 'кредитор', influence: 'высокое' }] }
    expect(blocksCompletedBy({}, after, b14.keys)).toEqual(['b14'])
    expect(blocksCompletedBy(after, after, b14.keys)).toEqual([])
  })
})
