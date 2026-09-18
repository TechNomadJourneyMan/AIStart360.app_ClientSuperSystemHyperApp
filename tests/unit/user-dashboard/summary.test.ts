import { describe, expect, it } from 'vitest'
import { PROFILE_SECTIONS, buildUserProfileSummary } from '@/lib/user-dashboard/summary'

describe('buildUserProfileSummary', () => {
  it('every wizard step belongs to exactly one section', () => {
    const steps = PROFILE_SECTIONS.flatMap((s) => s.steps).sort((a, b) => a - b)
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('an empty survey yields an empty, zero-percent profile', () => {
    const s = buildUserProfileSummary({})
    expect(s.isEmpty).toBe(true)
    expect(s.percent).toBe(0)
    expect(s.sections.every((x) => x.answers.length === 0)).toBe(true)
    expect(s.hero.company).toBe('')
  })

  it('groups answers by theme, labels them and skips blanks', () => {
    const s = buildUserProfileSummary({
      s1_company_name: 'ТОО Ромашка',
      s1_industry: 'Ритейл',
      s1_website: '   ',
      s9n_revenue_2024: 120000000,
      s2n_goal_12m_what: 'Удвоить выручку',
    })
    const company = s.sections.find((x) => x.id === 'company')!
    expect(company.answers.map((a) => a.key)).toEqual(expect.arrayContaining(['s1_company_name', 's1_industry']))
    expect(company.answers.find((a) => a.key === 's1_website')).toBeUndefined()
    expect(company.answers[0].label).not.toBe(company.answers[0].key)
    expect(s.sections.find((x) => x.id === 'finance')!.answers).toHaveLength(1)
    expect(s.hero.company).toBe('ТОО Ромашка')
    expect(s.hero.revenue).not.toBe('')
    expect(s.hero.goal12m).toBe('Удвоить выручку')
    expect(s.startedSteps).toBe(3)
    expect(s.percent).toBe(25)
  })

  it('editStep points at the first step of the section that still has gaps', () => {
    const s = buildUserProfileSummary({ s1_company_name: 'X' })
    expect(s.sections.find((x) => x.id === 'market')!.editStep).toBe(3)
    expect(s.sections.find((x) => x.id === 'team')!.editStep).toBe(4)
  })
})
