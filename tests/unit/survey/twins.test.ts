import { describe, expect, it } from 'vitest'
import { twinOffer } from '@/lib/survey/twins'
import { approxAnswer } from '@/lib/survey/answer-value'

describe('twin questions (spec §7.6)', () => {
  it('offers the answered twin for an empty field', () => {
    const o = twinOffer('s10_hours_on_ops', { s4m_hours_on_ops: 6 })
    expect(o).toMatchObject({ key: 's10_hours_on_ops', from: 's4m_hours_on_ops', value: 6, text: '6 ч/день' })
  })
  it('both directions; scale twins', () => {
    expect(twinOffer('s4m_delegation_readiness', { s10_delegation_ready: 7 })?.value).toBe(7)
    expect(twinOffer('s4m_hours_on_ops', { s10_hours_on_ops: approxAnswer(5, 7) })?.text).toMatch(/≈/)
  })
  it('nothing when the field is answered, the twin is empty, or there is no twin', () => {
    expect(twinOffer('s10_hours_on_ops', { s4m_hours_on_ops: 6, s10_hours_on_ops: 4 })).toBeNull()
    expect(twinOffer('s10_hours_on_ops', {})).toBeNull()
    expect(twinOffer('s5_usp', { s4m_hours_on_ops: 6 })).toBeNull()
  })
})
