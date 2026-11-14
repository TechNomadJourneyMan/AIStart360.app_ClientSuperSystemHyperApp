/**
 * R-036: one GRI scale (0–10), one formatter, one set of zones.
 */
import { describe, expect, it } from 'vitest'
import {
  GRI_ATTENTION_BELOW,
  GRI_ZONES,
  formatGri,
  formatGriDelta,
  griColor,
  griFromPercent,
  griNeedsAttention,
  griPercentOfScale,
  griTone,
  griZone,
  meanGri,
  toGri,
} from '@/lib/format/gri'

describe('toGri — the 0–10 scale, «нет данных» instead of 0', () => {
  it('keeps values in (0, 10]', () => {
    expect(toGri(6.43)).toBe(6.43)
    expect(toGri('7.5')).toBe(7.5)
    expect(toGri('7,5')).toBe(7.5)
    expect(toGri(10)).toBe(10)
  })
  it('0, negatives, > 10 and garbage are null — never rescaled silently', () => {
    for (const v of [0, -1, 10.01, 62, NaN, null, undefined, '', 'abc', {}]) expect(toGri(v)).toBeNull()
  })
})

describe('formatGri', () => {
  it('one decimal, a dot, optional « / 10»', () => {
    expect(formatGri(6.43)).toBe('6.4')
    expect(formatGri(7.4)).toBe('7.4')
    expect(formatGri(6.25)).toBe('6.3')
    expect(formatGri(8)).toBe('8.0')
    expect(formatGri(6.2, { scale: true })).toBe('6.2 / 10')
  })
  it('«нет данных» instead of 0 / null, or the given empty text', () => {
    expect(formatGri(0)).toBe('нет данных')
    expect(formatGri(null)).toBe('нет данных')
    expect(formatGri(undefined, { empty: '—' })).toBe('—')
    // A 0–100 value is not a GRI: it is not shown as «62.0».
    expect(formatGri(62)).toBe('нет данных')
  })
  it('allowZero — only for converted 0–100 instruments', () => {
    expect(formatGri(0, { allowZero: true, scale: true })).toBe('0.0 / 10')
  })
})

describe('griFromPercent — explicit 0–100 → 0–10 conversion', () => {
  it('62/100 → 6.2', () => {
    expect(griFromPercent(62)).toBe(6.2)
    expect(formatGri(griFromPercent(62), { scale: true })).toBe('6.2 / 10')
    expect(griFromPercent(100)).toBe(10)
    expect(griFromPercent(0)).toBe(0)
  })
  it('out of range / garbage → null', () => {
    expect(griFromPercent(101)).toBeNull()
    expect(griFromPercent(-1)).toBeNull()
    expect(griFromPercent(null)).toBeNull()
  })
})

describe('GRI_ZONES — one threshold set', () => {
  it('is ascending and starts at 0', () => {
    expect(GRI_ZONES[0].min).toBe(0)
    for (let i = 1; i < GRI_ZONES.length; i++) expect(GRI_ZONES[i].min).toBeGreaterThan(GRI_ZONES[i - 1].min)
  })
  it('< 4 critical, 4–6 developing, 6–8 strong, ≥ 8 excellent', () => {
    expect(griZone(3.99)?.key).toBe('critical')
    expect(griZone(4)?.key).toBe('developing')
    expect(griZone(5.99)?.key).toBe('developing')
    expect(griZone(6)?.key).toBe('strong')
    expect(griZone(7.99)?.key).toBe('strong')
    expect(griZone(8)?.key).toBe('excellent')
    expect(griZone(10)?.key).toBe('excellent')
    expect(griZone(0)).toBeNull()
  })
  it('tones, colours and «требует внимания» follow the zones', () => {
    expect(griTone(3)).toBe('red')
    expect(griTone(5)).toBe('amber')
    expect(griTone(7)).toBe('green')
    expect(griTone(null)).toBeNull()
    expect(griColor(9)).toBe('#6effc0')
    expect(griColor(null, 'x')).toBe('x')
    expect(GRI_ATTENTION_BELOW).toBe(GRI_ZONES[1].min)
    expect(griNeedsAttention(3.9)).toBe(true)
    expect(griNeedsAttention(4)).toBe(false)
    expect(griNeedsAttention(null)).toBe(false)
    // The old expert filter «GRI < 40» would flag every client on the 0–10 scale.
    expect(griNeedsAttention(7.4)).toBe(false)
  })
})

describe('helpers', () => {
  it('formatGriDelta', () => {
    expect(formatGriDelta(0.34)).toBe('+0.3')
    expect(formatGriDelta(-0.25)).toBe('−0.2')
    expect(formatGriDelta(0.01)).toBe('0.0')
    expect(formatGriDelta(null, { empty: '—' })).toBe('—')
  })
  it('griPercentOfScale and meanGri skip «нет данных»', () => {
    expect(griPercentOfScale(6.2)).toBe(62)
    expect(griPercentOfScale(null)).toBe(0)
    expect(meanGri([6, 8, 0, null, 62])).toBe(7)
    expect(meanGri([0, null])).toBeNull()
  })
})
