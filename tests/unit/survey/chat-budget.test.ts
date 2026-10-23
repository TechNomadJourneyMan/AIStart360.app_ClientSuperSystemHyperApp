/**
 * Questionnaire helper budget (PO 2026-10-23, spec §18.3 item 2): free — $0.5
 * per client; PRO — unlimited until the full questionnaire is submitted, then
 * the daily PRO limit; and every model call is recorded in ai_usage with
 * feature 'survey_assistant'.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkSurveyAssistantBudget, SURVEY_CAP_MESSAGE, SURVEY_DAILY_MESSAGE, sumCost, type SurveyBudgetDeps } from '@/lib/survey/chat/budget'
import { AiBudgetExceededError } from '@/lib/ai/budget'
import { __setAiUsageSink, AI_FEATURES, type AiUsageRow } from '@/lib/ai/usage'
import { openRouterSurveyLlm } from '@/lib/survey/chat/model'

const USER = '11111111-2222-4333-8444-555555555555'

function deps(p: Partial<SurveyBudgetDeps> & { spent?: number; daily?: boolean }): SurveyBudgetDeps & { dailyCalls: number } {
  const out = {
    dailyCalls: 0,
    readTier: async () => 'free' as const,
    fullSubmitted: async () => false,
    readCapUsd: async () => 0.5,
    readSpentUsd: async () => p.spent ?? 0,
    assertDaily: async () => {
      out.dailyCalls += 1
      if (p.daily) throw new AiBudgetExceededError('survey_assistant', 'pro', 5, 5)
    },
    ...p,
  }
  return out
}

describe('checkSurveyAssistantBudget', () => {
  it('free: under the $0.5 cap → allowed; at the cap → a clear message', async () => {
    expect(await checkSurveyAssistantBudget(USER, deps({ spent: 0.49 }))).toMatchObject({ exhausted: false })
    expect(await checkSurveyAssistantBudget(USER, deps({ spent: 0.5 }))).toMatchObject({ exhausted: true, reason: 'cap', message: SURVEY_CAP_MESSAGE })
  })

  it('free: the daily limit still applies', async () => {
    expect(await checkSurveyAssistantBudget(USER, deps({ spent: 0.1, daily: true }))).toMatchObject({ exhausted: true, reason: 'daily', message: SURVEY_DAILY_MESSAGE })
  })

  it('PRO before the full questionnaire is submitted: no cap and no daily limit', async () => {
    const d = deps({ readTier: async () => 'pro', spent: 50, daily: true })
    expect(await checkSurveyAssistantBudget(USER, d)).toMatchObject({ exhausted: false, unlimited: true })
    expect(d.dailyCalls).toBe(0)
  })

  it('PRO after the submit: the normal daily PRO limit', async () => {
    const d = deps({ readTier: async () => 'pro', fullSubmitted: async () => true, daily: true })
    expect(await checkSurveyAssistantBudget(USER, d)).toMatchObject({ exhausted: true, reason: 'daily' })
    const ok = deps({ readTier: async () => 'pro', fullSubmitted: async () => true, spent: 50 })
    expect(await checkSurveyAssistantBudget(USER, ok)).toMatchObject({ exhausted: false, unlimited: false })
  })

  it('staff: daily limit only', async () => {
    expect(await checkSurveyAssistantBudget(USER, deps({ readTier: async () => 'staff', spent: 10 }))).toMatchObject({ exhausted: false })
  })

  it('a broken meter is fail-open', async () => {
    const d = deps({ readSpentUsd: async () => { throw new Error('db down') } })
    expect(await checkSurveyAssistantBudget(USER, d)).toMatchObject({ exhausted: false })
    expect(await checkSurveyAssistantBudget(USER, deps({ readTier: async () => { throw new Error('x') } }))).toMatchObject({ exhausted: false })
  })

  it('sums ai_usage costs', () => {
    expect(sumCost([{ cost_usd: 0.1 }, { cost_usd: '0.2' }, { cost_usd: null }])).toBeCloseTo(0.3, 6)
  })
})

describe('ai_usage accounting', () => {
  const originalKey = process.env.OPENROUTER_API_KEY
  afterEach(() => {
    __setAiUsageSink(null)
    vi.unstubAllGlobals()
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalKey
  })

  it('the feature is in the closed dictionary', () => {
    expect(AI_FEATURES.survey_assistant).toBeTruthy()
  })

  it('a chat turn is recorded with feature survey_assistant and the client (no network: fetch is stubbed)', async () => {
    const rows: AiUsageRow[] = []
    __setAiUsageSink(async (r) => { rows.push(r) })
    process.env.OPENROUTER_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      choices: [{ message: { content: '{"intent":"skip"}' } }],
      usage: { prompt_tokens: 2500, completion_tokens: 250 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await openRouterSurveyLlm(USER)({ system: 's', user: 'u', tier: 'light' })
    expect(out).toBe('{"intent":"skip"}')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ feature: 'survey_assistant', user_id: USER, prompt_tokens: 2500, completion_tokens: 250, ok: true })
    // Haiku 4.5: $1 / $5 per 1M → 2500 in + 250 out ≈ $0.00375 per turn
    expect(rows[0].cost_usd).toBeCloseTo(0.00375, 6)
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.response_format?.type).toBe('json_schema')
  })
})
