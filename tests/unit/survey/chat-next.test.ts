/** The server picks the next chat question from the registry (spec §8.2). */
import { describe, expect, it } from 'vitest'
import { chatQueue, FULL_BLOCK_ORDER, nextChatStep, openChatQuestions } from '@/lib/survey/chat/next'
import { EXPRESS_SCREENS } from '@/lib/survey/questions'

describe('nextChatStep', () => {
  it('starts with the first express question the chat asks (company name comes from the profile)', () => {
    const s = nextChatStep({ answers: {}, scope: 'express' })
    expect(s.kind === 'question' && s.question.key).toBe('s1_industry')
  })

  it('skips answered («не знаю» included) and skipped keys', () => {
    const s = nextChatStep({
      answers: { s1_industry: 'Розница', s1_business_model: { value: null, unknown: true } },
      scope: 'express',
      skipped: new Set(['s1_employee_count']),
    })
    expect(s.kind === 'question' && s.question.key).toBe('s1_current_revenue_month')
  })

  it('express scope ends after the express set; auto keys are never asked', () => {
    const answers: Record<string, unknown> = {}
    for (const sc of EXPRESS_SCREENS) for (const k of sc.keys) answers[k] = 'x'
    expect(nextChatStep({ answers, scope: 'express' })).toEqual({ kind: 'done', scope: 'express' })
    expect(nextChatStep({ answers, scope: 'full' }).kind).not.toBe('done')
    expect(FULL_BLOCK_ORDER.slice(0, 3)).toEqual(['b10', 'b11', 'b5'])
  })

  it('a table-only block yields one form link, then moves on', () => {
    const answers: Record<string, unknown> = {}
    for (const sc of EXPRESS_SCREENS) for (const k of sc.keys) answers[k] = 'x'
    const first = nextChatStep({ answers, scope: 'full' })
    expect(first).toMatchObject({ kind: 'form_link', block: 'b10', keys: ['s8n_metrics_table'], step: 8 })
    const after = nextChatStep({ answers, scope: 'full', formLinksShown: new Set(['b10']) })
    expect(after.kind === 'question' && after.block).toBe('b11')
  })

  it('switch_block puts the asked block first', () => {
    expect(chatQueue('express', 'b11')[0].block).toBe('b11')
    const s = nextChatStep({ answers: {}, scope: 'express', focusBlock: 'b11' })
    expect(s.kind === 'question' && s.question.key).toBe('s9n_revenue_2024')
  })

  it('counts open chat questions', () => {
    expect(openChatQuestions({}, 'express')).toBe(25)
    expect(openChatQuestions({}, 'full')).toBeGreaterThan(100)
  })
})
