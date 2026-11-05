import { describe, it, expect } from 'vitest'
import { CHECK_QUESTION_KEYS, questionsForChecks } from '@/lib/point-a/v4/check-questions'
import { allChecks } from '@/lib/point-a/v4/engine'
import { surveyQuestion } from '@/lib/survey/questions'
import { BLOCK_KEYS } from '@/lib/point-a/v4/config'

describe('the editor window asks the questions of a check', () => {
  it('every scored check of every block has at least one question to ask', () => {
    const checks = allChecks({})
    for (const block of BLOCK_KEYS) {
      for (const c of checks[block].filter((x) => !x.excluded)) {
        expect(questionsForChecks(block, [c.id]).length, `${block}.${c.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('every key of the table is a question of the current questionnaire', () => {
    for (const [block, checks] of Object.entries(CHECK_QUESTION_KEYS)) {
      for (const [id, keys] of Object.entries(checks)) {
        for (const k of keys) expect(surveyQuestion(k), `${block}.${id}: ${k}`).toBeTruthy()
      }
    }
  })

  it('a question shared by two checks is asked once; derived fields are never asked', () => {
    const qs = questionsForChecks('operations', ['dept_kpi', 'management_method'])
    expect(qs.map((q) => q.key)).toEqual(['s4m_control_method', 's4n_staffing_table'])
    expect(questionsForChecks('strategy', ['goal_12m']).map((q) => q.key)).toEqual(['s2n_goal_12m_what', 's1_goal_12m_revenue_month'])
  })

  it('an unknown check asks nothing', () => {
    expect(questionsForChecks('finance', ['nope'])).toEqual([])
  })
})
