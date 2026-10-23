/**
 * Express flow logic (spec §7.1): pages, «один вопрос на экран» on a phone,
 * «Готово» from screen 5, summary, calcs after screens 5/11/14.
 */
import { describe, expect, it } from 'vitest'
import {
  EXPRESS_QUESTIONS, EXPRESS_SCREEN_CALCS, canFinishExpress, expressCompletedMetadata, expressPages, expressSummary, firstOpenPage, isHardScreen,
} from '@/lib/survey/express'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

describe('express flow', () => {
  it('15 screens, 26 questions, auto keys never shown', () => {
    const pages = expressPages()
    expect(pages).toHaveLength(15)
    expect(EXPRESS_QUESTIONS).toHaveLength(26)
    const shown = pages.flatMap((p) => p.questions.map((q) => q.key))
    expect(shown).not.toContain('s1_current_revenue_year')
    expect(new Set(shown).size).toBe(26)
  })

  it('a phone splits the hard screens one question per page', () => {
    expect(isHardScreen(13)).toBe(true)
    expect(isHardScreen(15)).toBe(true)
    expect(isHardScreen(4)).toBe(false)
    const pages = expressPages({ oneQuestionPerHardScreen: true })
    expect(pages).toHaveLength(15 - 2 + 5 + 3)
    const mgmt = pages.filter((p) => p.screen === 13)
    expect(mgmt.map((p) => p.part)).toEqual([1, 2, 3, 4, 5].map((index) => ({ index, total: 5 })))
    expect(mgmt.every((p) => p.questions.length === 1)).toBe(true)
  })

  it('«Готово» is offered after the 4th screen', () => {
    const pages = expressPages()
    expect(pages.filter(canFinishExpress).map((p) => p.screen)[0]).toBe(5)
    expect(canFinishExpress(pages[3])).toBe(false)
  })

  it('summary: «не знаю» counts as answered and as unknown; yes/no false is an answer', () => {
    const s = expressSummary({ s3_deal_cycle_days: unknownAnswer(), s4_has_org_chart: false, s1_current_revenue_month: approxAnswer(5e6, 6e6), s6_main_pain: '  ' })
    expect(s).toEqual({ total: 26, answered: 3, unknown: 1, skipped: 23 })
    const filled = expressSummary(previewAnswers('filled'))
    expect(filled.skipped).toBe(0)
  })

  it('a returning owner continues at the first open page', () => {
    const pages = expressPages()
    expect(firstOpenPage(pages, {})).toBe(0)
    expect(firstOpenPage(pages, { s1_company_name: 'А', s1_industry: 'Розница', s1_business_model: 'B2B' })).toBe(2)
    expect(firstOpenPage(pages, previewAnswers('filled'))).toBe(14)
  })

  it('metadata of SURVEY_EXPRESS_COMPLETED', () => {
    expect(expressCompletedMetadata({ s3_deal_cycle_days: unknownAnswer() }, 0, 8 * 60000)).toEqual({ answered: 1, unknown: 1, skipped: 25, minutes: 8 })
  })

  it('calcs after screens 5, 11, 14', () => {
    expect(Object.keys(EXPRESS_SCREEN_CALCS).map(Number)).toEqual([5, 11, 14])
  })
})
