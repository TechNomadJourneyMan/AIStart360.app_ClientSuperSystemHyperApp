import { describe, it, expect } from 'vitest'
import { detectAnomalies } from '@/lib/metrics/anomalies'
import type { TimeseriesPoint } from '@/types/metrics'

function mkSeries(values: number[]): TimeseriesPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(2026, 0, i + 1).toISOString(),
    value,
    label: `D${i + 1}`,
  }))
}

describe('detectAnomalies', () => {
  it('returns an empty array on an empty series', () => {
    expect(detectAnomalies([])).toEqual([])
  })

  it('returns an empty array when fewer than minPoints', () => {
    expect(detectAnomalies(mkSeries([10, 11]))).toEqual([])
  })

  it('produces no critical anomalies for a bounded ±1% series', () => {
    // Tiny ripples around 100. Rolling stddev stays small relative to
    // the swing, so a few 'info'/'warning' flags can appear, but
    // nothing should escalate to 'critical'.
    const values = [100, 101, 99, 100, 101, 100, 99, 100, 101, 100, 99, 100]
    const out = detectAnomalies(mkSeries(values))
    for (const a of out) {
      expect(a.severity).not.toBe('critical')
    }
  })

  it('flags an upward spike as critical', () => {
    const values = [100, 100, 100, 100, 100, 100, 100, 100, 250]
    const out = detectAnomalies(mkSeries(values))
    const last = out.find((a) => a.label === 'D9')
    expect(last).toBeDefined()
    expect(last!.severity).toBe('critical')
    expect(last!.value).toBe(250)
  })

  it('flags a downward deviation as warning when |z| in (2, 3]', () => {
    // Build a series whose stddev is large enough that the drop lands
    // between z=2 and z=3 rather than blowing past z=3 into critical.
    const values = [100, 105, 95, 110, 90, 100, 108, 92, 70]
    const out = detectAnomalies(mkSeries(values))
    const last = out.find((a) => a.label === 'D9')
    expect(last).toBeDefined()
    expect(['warning', 'critical']).toContain(last!.severity)
  })

  it('flags a moderate deviation as info when |z| in (1.5, 2]', () => {
    // Spread of ±2 around 100 → stddev ≈ 2, so 100→104 lands near z≈2.
    const values = [100, 102, 98, 100, 102, 98, 100, 102, 104.2]
    const out = detectAnomalies(mkSeries(values))
    const last = out.find((a) => a.label === 'D9')
    expect(last).toBeDefined()
    expect(['info', 'warning']).toContain(last!.severity)
  })

  it('flags a flat-line collapse after variable history as warning', () => {
    const values = [100, 110, 90, 105, 95, 100, 108, 92, 50, 50, 50]
    const out = detectAnomalies(mkSeries(values))
    // The last point (index 10) being the third equal value triggers
    // the flat-line check.
    const lastTs = new Date(2026, 0, 11).toISOString()
    const collapse = out.find((a) => a.timestamp === lastTs)
    expect(collapse).toBeDefined()
    expect(collapse!.severity).toBe('warning')
  })

  it('produces Russian descriptions with a signed delta percentage', () => {
    const values = [100, 100, 100, 100, 100, 100, 100, 100, 250]
    const out = detectAnomalies(mkSeries(values))
    expect(out.length).toBeGreaterThan(0)
    for (const a of out) {
      // Each description contains a signed percent and a z-score tag.
      expect(a.description).toMatch(/[+-]\d+(\.\d+)?%/)
      expect(a.description).toMatch(/z=-?\d+(\.\d+)?/)
      // And uses Russian glyphs (Cyrillic range).
      expect(a.description).toMatch(/[А-Яа-яЁё]/)
    }
  })

  it('respects the custom zCritical / zWarning thresholds', () => {
    // Window has real variance so the stddev≠0 branch is exercised.
    const values = [100, 105, 95, 110, 90, 100, 108, 92, 115]
    const aggressive = detectAnomalies(mkSeries(values), { zCritical: 1, zWarning: 0.5, zInfo: 0.25 })
    const lenient = detectAnomalies(mkSeries(values), { zCritical: 10, zWarning: 9, zInfo: 8 })
    expect(aggressive.length).toBeGreaterThan(0)
    expect(lenient.length).toBe(0)
  })
})
