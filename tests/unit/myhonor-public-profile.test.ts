import { describe, expect, it } from 'vitest'

import profile from '@/lib/demo/myhonor-public-profile.json'

describe('myhonor public demo profile', () => {
  it('contains traceable public facts and an explicitly hypothetical goal', () => {
    expect(profile.companyName).toBe('HONOR GROUP')
    expect(profile.website).toBe('https://myhonor.shop')
    expect(profile.sourceUrls).toEqual(expect.arrayContaining([
      'https://myhonor.shop/',
      'https://myhonor.shop/catalog',
    ]))
    expect(profile.testGoal.toLowerCase()).toContain('тестовая гипотеза')
  })

  it('does not seed private financial or conversion metrics', () => {
    const keys = profile.surveyAnswers.map((answer) => answer.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toEqual(expect.arrayContaining([
      'ec_revenue_2024',
      'ec_gross_margin',
      'ec_aov',
      'ec_cr_visit_to_cart',
      'ec_cr_cart_to_pay',
      'ec_returns_pct',
      'ec_inventory_turnover',
      's1_current_revenue_year',
      's1_goal_12m_revenue_year',
    ]))
  })
})
