import { describe, it, expect } from 'vitest'
import { computeRiskFlags, type RegistrationCandidate } from '@/lib/registration/risk'

function candidate(over: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return { email: 'founder@gmail.com', name: 'Иван Петров', organization: 'ООО Ромашка', emailConfirmed: true, ...over }
}

describe('computeRiskFlags', () => {
  it('recommends auto-approval for a clean, confirmed candidate', () => {
    const r = computeRiskFlags(candidate())
    expect(r.score).toBe(0)
    expect(r.flags).toHaveLength(0)
    expect(r.recommend).toBe('auto_approve')
  })

  it('flags a disposable email domain', () => {
    const r = computeRiskFlags(candidate({ email: 'x@mailinator.com' }))
    expect(r.flags).toContain('disposable_email')
    expect(r.score).toBeGreaterThanOrEqual(25)
  })

  it('sends IP-burst registrations to manual review', () => {
    const r = computeRiskFlags(candidate({ ipRegistrationsLast24h: 3 }))
    expect(r.flags).toContain('ip_burst')
    expect(r.recommend).toBe('manual_review')
  })

  it('sends a previously-rejected email to manual review', () => {
    const r = computeRiskFlags(candidate({ previouslyRejected: true }))
    expect(r.flags).toContain('previously_rejected')
    expect(r.recommend).toBe('manual_review')
  })

  it('forces manual review when the email is explicitly unconfirmed (no auto-approve without verify)', () => {
    const r = computeRiskFlags(candidate({ emailConfirmed: false }))
    expect(r.recommend).toBe('manual_review')
  })

  it('accumulates soft signals over the threshold → manual review', () => {
    const r = computeRiskFlags(candidate({ email: 'x@tempmail.com', formFillMs: 1200 }))
    expect(r.flags).toEqual(expect.arrayContaining(['disposable_email', 'too_fast']))
    expect(r.score).toBeGreaterThanOrEqual(30)
    expect(r.recommend).toBe('manual_review')
  })

  it('flags obvious spam terms in name/org', () => {
    const r = computeRiskFlags(candidate({ name: 'FREE CRYPTO casino', organization: 'viagra loans' }))
    expect(r.flags).toContain('spam_terms')
  })
})
