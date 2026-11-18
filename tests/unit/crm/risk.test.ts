import { describe, it, expect } from 'vitest'
import { scoreClientRisk } from '@/lib/crm/risk'

const NOW = Date.parse('2026-07-09T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

describe('scoreClientRisk (deterministic CRM risk)', () => {
  it('is low-risk for a recently contacted customer', () => {
    const r = scoreClientRisk(
      { lastContactAt: daysAgo(1), avgCheck: 100_000, status: 'customer', now: NOW },
      100_000,
    )
    expect(r.churnLevel).toBe('low')
    expect(r.action).toBe('monitor')
    expect(r.riskScore).toBeLessThan(40)
  })

  it('is high-risk and calls when contact is very stale', () => {
    const r = scoreClientRisk(
      { lastContactAt: daysAgo(45), avgCheck: 100_000, status: 'in_progress', now: NOW },
      100_000,
    )
    expect(r.churnLevel).toBe('high')
    expect(r.action).toBe('call')
    expect(r.comment).toMatch(/Нет контакта/)
  })

  it('treats a never-contacted lead as medium risk needing a call', () => {
    const r = scoreClientRisk(
      { lastContactAt: null, avgCheck: null, status: 'new', now: NOW },
      0,
    )
    expect(r.daysSince).toBeNull()
    expect(r.action).toBe('call')
    expect(r.comment).toBe('Нет ни одного касания')
    expect(r.churnLevel).toBe('medium')
  })

  it('forces a lost client to max risk and win-back call', () => {
    const r = scoreClientRisk(
      { lastContactAt: daysAgo(2), avgCheck: 50_000, status: 'lost', now: NOW },
      100_000,
    )
    expect(r.riskScore).toBe(95)
    expect(r.churnLevel).toBe('high')
    expect(r.action).toBe('call')
    expect(r.comment).toBe('Клиент потерян — вернуть')
  })

  it('computes checkVsAvgPct as % deviation of the check from the base average', () => {
    const r = scoreClientRisk(
      { lastContactAt: daysAgo(1), avgCheck: 150_000, status: 'customer', now: NOW },
      100_000,
    )
    expect(r.checkVsAvgPct).toBe(50)
  })

  // M2: an unknown check (or no base average) is unknown — it used to be «0 %» on screen.
  it('an unknown check or base average gives checkVsAvgPct null, never 0', () => {
    expect(scoreClientRisk({ lastContactAt: daysAgo(1), avgCheck: null, status: 'customer', now: NOW }, 100_000).checkVsAvgPct).toBeNull()
    expect(scoreClientRisk({ lastContactAt: daysAgo(1), avgCheck: 50_000, status: 'customer', now: NOW }, 0).checkVsAvgPct).toBeNull()
  })

  // M2: no invented series — the old result carried a fake 5-point «order history» (health × 0.6…1.0).
  it('returns no invented order history / volume trend, and clamps the score to 0..100', () => {
    const r = scoreClientRisk({ lastContactAt: daysAgo(365), avgCheck: 10, status: 'sleeping', now: NOW }, 1_000_000)
    expect(Object.keys(r).sort()).toEqual(['action', 'checkVsAvgPct', 'churnLevel', 'comment', 'daysSince', 'riskScore'])
    expect(r.riskScore).toBeGreaterThanOrEqual(0)
    expect(r.riskScore).toBeLessThanOrEqual(100)
  })
})
