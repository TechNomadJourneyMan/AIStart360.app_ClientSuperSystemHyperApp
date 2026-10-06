/**
 * The staff dashboard header shows the current quarter computed from the date
 * in the business time zone (Asia/Almaty) — not a hard-coded «Q1 2026».
 */
import { describe, expect, it } from 'vitest'
import { BUSINESS_TIME_ZONE, quarterLabel, quarterOf } from '@/lib/format/period'

describe('quarterLabel', () => {
  it.each([
    ['2026-01-15T12:00:00Z', 'I квартал 2026'],
    ['2026-03-31T12:00:00Z', 'I квартал 2026'],
    ['2026-04-01T12:00:00Z', 'II квартал 2026'],
    ['2026-06-30T12:00:00Z', 'II квартал 2026'],
    ['2026-07-01T12:00:00Z', 'III квартал 2026'],
    ['2026-09-30T12:00:00Z', 'III квартал 2026'],
    ['2026-10-06T09:00:00Z', 'IV квартал 2026'],
    ['2026-12-31T12:00:00Z', 'IV квартал 2026'],
  ])('%s → %s', (iso, label) => {
    expect(quarterLabel(new Date(iso))).toBe(label)
  })

  it('uses the Almaty calendar date, not UTC', () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in Almaty (UTC+5).
    expect(quarterLabel(new Date('2026-12-31T20:00:00Z'))).toBe('I квартал 2027')
    expect(quarterLabel(new Date('2026-12-31T20:00:00Z'), 'UTC')).toBe('IV квартал 2026')
    // 30 Sep 21:00 UTC = 1 Oct 02:00 Almaty.
    expect(quarterOf(new Date('2026-09-30T21:00:00Z'))).toEqual({ year: 2026, quarter: 4 })
  })

  it('defaults to Asia/Almaty and rejects an invalid date', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Almaty')
    expect(() => quarterOf(new Date('nope'))).toThrow(RangeError)
  })

  it('without an argument labels the current date', () => {
    expect(quarterLabel()).toBe(quarterLabel(new Date()))
    expect(quarterLabel()).toMatch(/^(I|II|III|IV) квартал \d{4}$/)
  })
})
