import { describe, expect, it } from 'vitest'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { SURVEY_FREE_TEXT_KEYS, SURVEY_NAME_KEYS, surveyModerationFields } from '@/lib/moderation/survey-fields'

describe('survey free-text keys for the content filter', () => {
  it('every listed key exists in the wizard (no typos / retired keys)', () => {
    for (const k of SURVEY_FREE_TEXT_KEYS) expect(SURVEY_KEY_STEP, k).toHaveProperty(k)
    for (const k of SURVEY_NAME_KEYS) expect(SURVEY_FREE_TEXT_KEYS.has(k), k).toBe(true)
  })

  it('numeric and choice keys are not moderated', () => {
    for (const k of ['s1_employee_count', 's1_goal_12m_revenue_year', 's1_industry', 's1_business_model', 's1_regions', 's3n_price_segment', 's4_has_org_chart', 's12_crm_tool', 's5n_funnel_lead_to_call']) {
      expect(SURVEY_FREE_TEXT_KEYS.has(k), k).toBe(false)
    }
  })

  it('builds fields with labels and kinds; skips numbers, choices and empty values', () => {
    const fields = surveyModerationFields({
      s1_company_name: { value: 'ТОО Ромашка' },
      s1_employee_count: { value: 12 },
      s1_industry: { value: 'Ритейл' },
      s2n_what_blocks_growth: { value: 'Нет продавцов' },
      s6n_journey_table: { value: [{ stage: 'Звонок', note: 'долго' }] },
      s10_why_opened: { value: null },
      ec_shop_slogan: { value: 'Лучшие цены' },
      ec_items_count: { value: 40 },
    })
    expect(fields.map((f) => [f.field, f.kind])).toEqual([
      ['s1_company_name', 'name'],
      ['s2n_what_blocks_growth', 'text'],
      ['s6n_journey_table', 'text'],
      ['ec_shop_slogan', 'text'],
    ])
    expect(fields[0].label).toBe('Название компании')
  })
})
