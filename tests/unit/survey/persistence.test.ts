import { beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({ sync: vi.fn() }))

vi.mock('@/lib/google-sheets/survey-sync', () => ({
  syncSurveyAnswersToGoogleSheet: sheets.sync,
}))

import {
  isValidSurveyStep,
  parseSurveyAnswers,
  saveSurveyAnswers,
  surveyStepForQuestionKey,
  unwrapStoredSurveyAnswer,
} from '@/lib/survey/persistence'

function supabaseWithUpsert(error: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error })
  const from = vi.fn().mockReturnValue({ upsert })
  return { client: { from } as never, from, upsert }
}

describe('survey persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    sheets.sync.mockResolvedValue({ status: 'synced', synced: 1 })
  })

  it('validates the stable wrapped answer contract and step bounds', () => {
    expect(parseSurveyAnswers({ revenue: { value: 42 } })).toEqual({
      revenue: { value: 42 },
    })
    expect(parseSurveyAnswers({ revenue: 42 })).toBeNull()
    expect(parseSurveyAnswers({})).toBeNull()
    expect(parseSurveyAnswers([])).toBeNull()
    expect(isValidSurveyStep(0)).toBe(true)
    expect(isValidSurveyStep(12)).toBe(true)
    expect(isValidSurveyStep(13)).toBe(false)
    expect(isValidSurveyStep(1.5)).toBe(false)
    expect(surveyStepForQuestionKey('s2n_revenue_2024', 8)).toBe(2)
    expect(surveyStepForQuestionKey('expert_comment', 0)).toBe(0)
  })

  it('unwraps both canonical and legacy/imported DB values for prefill', () => {
    expect(unwrapStoredSurveyAnswer({ value: ['B2B', 'B2C'] })).toEqual([
      'B2B',
      'B2C',
    ])
    expect(unwrapStoredSurveyAnswer('legacy value')).toBe('legacy value')
  })

  it('upserts Supabase before projecting the exact saved rows to Sheets', async () => {
    const sb = supabaseWithUpsert()
    const result = await saveSurveyAnswers(sb.client, {
      userId: 'user-1',
      companyId: 'company-1',
      step: 2,
      answers: { revenue: { value: 84000000 } },
    })

    expect(result).toEqual({
      ok: true,
      saved: 1,
      sheetSync: { status: 'synced', synced: 1 },
    })
    expect(sb.from).toHaveBeenCalledWith('survey_answers')
    expect(sb.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 'user-1',
          company_id: 'company-1',
          step: 2,
          question_key: 'revenue',
          answer: { value: 84000000 },
          answered_at: expect.any(String),
        }),
      ],
      { onConflict: 'user_id,question_key' },
    )
    expect(sheets.sync).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        step: 2,
        questionKey: 'revenue',
        answer: { value: 84000000 },
        answeredAt: expect.any(String),
      }),
    ])
  })

  it('derives each row step from mixed survey keys instead of the current UI step', async () => {
    const sb = supabaseWithUpsert()
    sheets.sync.mockResolvedValue({ status: 'synced', synced: 4 })

    const result = await saveSurveyAnswers(sb.client, {
      userId: 'user-1',
      companyId: null,
      step: 12,
      answers: {
        s1_company_name: { value: 'Example' },
        s2n_revenue_2024: { value: 84_000_000 },
        s10_strategy: { value: 'Growth' },
        unprefixed_expert_note: { value: 'Fallback' },
      },
    })

    expect(result).toMatchObject({ ok: true, saved: 4 })
    expect(sb.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ question_key: 's1_company_name', step: 1 }),
        expect.objectContaining({ question_key: 's2n_revenue_2024', step: 2 }),
        expect.objectContaining({ question_key: 's10_strategy', step: 10 }),
        expect.objectContaining({
          question_key: 'unprefixed_expert_note',
          step: 12,
        }),
      ],
      { onConflict: 'user_id,question_key' },
    )
    expect(sheets.sync).toHaveBeenCalledWith([
      expect.objectContaining({ questionKey: 's1_company_name', step: 1 }),
      expect.objectContaining({ questionKey: 's2n_revenue_2024', step: 2 }),
      expect.objectContaining({ questionKey: 's10_strategy', step: 10 }),
      expect.objectContaining({
        questionKey: 'unprefixed_expert_note',
        step: 12,
      }),
    ])
  })

  it('keeps unprefixed expert answers at step zero', async () => {
    const sb = supabaseWithUpsert()

    await saveSurveyAnswers(sb.client, {
      userId: 'expert-1',
      companyId: null,
      step: 0,
      answers: { expert_score: { value: 5 } },
    })

    expect(sb.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ question_key: 'expert_score', step: 0 })],
      { onConflict: 'user_id,question_key' },
    )
  })

  it('does not call Sheets after a failed database upsert', async () => {
    const dbError = { message: 'database unavailable' }
    const sb = supabaseWithUpsert(dbError)

    await expect(
      saveSurveyAnswers(sb.client, {
        userId: 'user-1',
        companyId: null,
        step: 1,
        answers: { name: { value: 'Example' } },
      }),
    ).resolves.toEqual({ ok: false, error: dbError })
    expect(sheets.sync).not.toHaveBeenCalled()
  })

  it('preserves DB success and reports a non-retriable Sheet projection failure', async () => {
    const sb = supabaseWithUpsert()
    sheets.sync.mockRejectedValue(new Error('Google unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await saveSurveyAnswers(sb.client, {
      userId: 'user-1',
      companyId: null,
      step: 1,
      answers: { name: { value: 'Example' } },
    })

    expect(result).toEqual({
      ok: true,
      saved: 1,
      sheetSync: { status: 'failed', reason: 'sync_error' },
    })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
