import { describe, it, expect } from 'vitest'
import { SECTION_FIELD_MAP, getSectionByStep } from '@/lib/assistant/sections'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'

describe('assistant sections are attached to the step whose form writes their fields', () => {
  it('every current-wizard field sits in a section with the same step', () => {
    const wrong: string[] = []
    for (const sec of SECTION_FIELD_MAP) {
      for (const f of [...sec.required, ...sec.recommended]) {
        const owner = SURVEY_KEY_STEP[f.key]
        if (owner !== undefined && owner !== sec.step) wrong.push(`${sec.id}:${f.key} (section step ${sec.step}, form step ${owner})`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('the wizard hints for step 7 are marketing, for step 9 finance', () => {
    expect(getSectionByStep(7)?.id).toBe('marketing')
    expect(getSectionByStep(9)?.id).toBe('finance')
    expect(getSectionByStep(5)?.label).toBe('Работа с базой')
  })
})
