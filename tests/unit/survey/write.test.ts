/**
 * lib/survey/write.ts — the one write path of questionnaire answers (spec
 * 2026-10-23 §5.1): keys, envelope, owning step, auto year, author + path.
 */
import { describe, expect, it, vi } from 'vitest'
import { autoYearFor, prepareSurveyWrite, surveyProfanityResponse, writeSurveyRows } from '@/lib/survey/write'
import { authorFor } from '@/lib/survey/attribution'
import { parseSurveySaveBody } from '@/lib/survey/schema'
import { memoryClient } from '../data-layer/memory-client'

const OWNER = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'
const AT = new Date('2026-10-23T09:00:00Z')

describe('prepareSurveyWrite', () => {
  it('keeps questionnaire keys only, stores the envelope, takes the step that owns the key', () => {
    const p = prepareSurveyWrite({
      ownerId: OWNER, companyId: 'co-1', at: AT, bodyStep: 1,
      envelopes: {
        s3_deals_2024: { value: 12 },
        s9n_net_profit: { value: null, unknown: true },
        gri_expert_cash: { value: 'note' },
        ec_gross_margin: { value: 30 },
      },
      existing: [{ question_key: 'ec_gross_margin', step: 4 }],
    })
    expect(p.ignored).toEqual(['gri_expert_cash'])
    expect(p.rows).toEqual([
      { user_id: OWNER, company_id: 'co-1', step: 5, question_key: 's3_deals_2024', answer: { value: 12 }, answered_at: AT.toISOString() },
      { user_id: OWNER, company_id: 'co-1', step: 9, question_key: 's9n_net_profit', answer: { value: null, unknown: true }, answered_at: AT.toISOString() },
      { user_id: OWNER, company_id: 'co-1', step: 4, question_key: 'ec_gross_margin', answer: { value: 30 }, answered_at: AT.toISOString() },
    ])
  })

  it('no company_id in the row when the writer must not touch it (staff edits)', () => {
    const p = prepareSurveyWrite({ ownerId: OWNER, envelopes: { s1_website: { value: 'x.kz' } } })
    expect(p.rows[0]).not.toHaveProperty('company_id')
  })

  it('deletes only questionnaire keys', () => {
    const p = prepareSurveyWrite({ ownerId: OWNER, envelopes: {}, deletes: ['s1_website', 'goal_week_v2'] })
    expect(p.deletes).toEqual(['s1_website'])
    expect(p.ignored).toEqual(['goal_week_v2'])
  })

  it('«год = месяц × 12» for a month written alone; the wizard pair is left as sent', () => {
    const alone = prepareSurveyWrite({ ownerId: OWNER, envelopes: { s1_current_revenue_month: { value: 5_000_000 } } })
    expect(alone.autoAdded).toEqual(['s1_current_revenue_year'])
    expect(alone.rows.find((r) => r.question_key === 's1_current_revenue_year')).toMatchObject({ step: 1, answer: { value: 60_000_000 } })

    const pair = prepareSurveyWrite({ ownerId: OWNER, envelopes: { s1_current_revenue_month: { value: 5_000_000 }, s1_current_revenue_year: { value: 60_000_000 } } })
    expect(pair.autoAdded).toEqual([])
    // «Мои ответы» (month alone) and the wizard (month + year) write the same rows.
    const strip = (rows: typeof pair.rows) => rows.map(({ answered_at: _a, ...r }) => r)
    expect(strip(alone.rows)).toEqual(strip(pair.rows))
  })

  it('auto year: «не знаю» clears the year, «примерно» uses the midpoint, a matching year stays', () => {
    expect(autoYearFor('s1_goal_12m_revenue_month', { value: null, unknown: true }, { value: 12_000_000 })).toEqual({ value: null })
    expect(autoYearFor('s1_goal_12m_revenue_month', { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] }, null)).toEqual({ value: 66_000_000 })
    expect(autoYearFor('s1_goal_12m_revenue_month', { value: 1_000_000 }, { value: 12_000_000 })).toBeUndefined()
    expect(autoYearFor('s1_website', { value: 'x' }, null)).toBeUndefined()
  })

  it('a nested mark is normalised to the stored envelope', () => {
    const p = prepareSurveyWrite({ ownerId: OWNER, envelopes: { s9n_debts_amount: { value: 7, approx: true, range: [5, 9] } } })
    expect(p.rows[0].answer).toEqual({ value: 7, approx: true, range: [5, 9] })
  })
})

describe('surveyProfanityResponse', () => {
  it('400 with the key of the free-text answer; numbers and other keys are not checked', async () => {
    const bad = surveyProfanityResponse({ s6_main_pain: { value: 'всё хуёво' }, s1_employee_count: { value: 5 } })
    expect(bad?.status).toBe(400)
    expect((await bad?.json()).field).toBe('s6_main_pain')
    expect(surveyProfanityResponse({ s6_main_pain: { value: 'всё хорошо' } })).toBeNull()
    expect(surveyProfanityResponse({ gri_expert_note: { value: 'хуёво' } })).toBeNull()
  })
})

describe('writeSurveyRows', () => {
  it('one upsert per author + path; author and path are stamped on every row', async () => {
    const m = memoryClient({ survey_answers: [] })
    const p = prepareSurveyWrite({ ownerId: OWNER, companyId: 'co-1', at: AT, envelopes: { s1_website: { value: 'a.kz' }, s9n_revenue_2024: { value: 1 } } })
    const origins: Record<string, 'document'> = { s9n_revenue_2024: 'document' }
    const res = await writeSurveyRows(m.client, p.rows, (r) => authorFor({ actorId: OWNER, ownerId: OWNER, origin: origins[r.question_key] ?? null, via: 'full' }), { at: AT })
    expect(res.error).toBeNull()
    const rows = m.db.survey_answers
    expect(rows.find((r) => r.question_key === 's1_website')).toMatchObject({ updated_by: OWNER, updated_by_role: 'user', updated_via: 'full' })
    expect(rows.find((r) => r.question_key === 's9n_revenue_2024')).toMatchObject({ updated_by_role: 'ai', updated_via: 'document' })
    expect(res.authors.get('s1_website')).toEqual({ id: OWNER, role: 'user', via: 'full' })
  })

  it('staff writes carry the path «staff»', async () => {
    const m = memoryClient({ survey_answers: [] })
    const p = prepareSurveyWrite({ ownerId: OWNER, envelopes: { s1_website: { value: 'b.kz' } } })
    await writeSurveyRows(m.client, p.rows, () => authorFor({ actorId: EXPERT, ownerId: OWNER, staffRoles: ['expert'], via: 'full' }))
    expect(m.db.survey_answers[0]).toMatchObject({ updated_by: EXPERT, updated_by_role: 'expert', updated_via: 'staff' })
  })

  it('returns the first error and stops', async () => {
    const upsert = vi.fn(async () => ({ error: { code: '23505', message: 'dup' } }))
    const db = { from: () => ({ upsert }) } as never
    const p = prepareSurveyWrite({ ownerId: OWNER, envelopes: { s1_website: { value: 'a' }, s1_social_media: { value: 'b' } } })
    const res = await writeSurveyRows(db, p.rows, (r) => ({ id: OWNER, role: 'user', via: r.question_key === 's1_website' ? 'full' : 'express' }))
    expect(res.error).toEqual({ code: '23505', message: 'dup' })
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('the save body: the path', () => {
  const body = (extra: Record<string, unknown>) => ({ step: 1, answers: { s1_website: { value: 'x' } }, ...extra })
  it('accepts full / express / helper and origins document / chat', () => {
    for (const via of ['full', 'express', 'helper']) expect(parseSurveySaveBody(body({ via })).ok).toBe(true)
    expect(parseSurveySaveBody(body({ origins: { s1_website: 'chat' } })).ok).toBe(true)
  })
  it('the browser can never claim chat / staff / system / document as the path', () => {
    for (const via of ['chat', 'staff', 'system', 'document']) expect(parseSurveySaveBody(body({ via })).ok).toBe(false)
    expect(parseSurveySaveBody(body({ origins: { s1_website: 'staff' } })).ok).toBe(false)
  })
})
