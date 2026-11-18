import { describe, expect, it } from 'vitest'
import { NOT_PERSISTED_ROOTS, PERSIST_BUSTER, shouldPersistQuery } from '@/lib/query/persist-policy'
import { crmKeys } from '@/hooks/useCrm'
import { GRI_ASSESSMENT_KEY, ONBOARDING_STATUS_KEY } from '@/hooks/useOnboardingStatus'
import { ACCESS_ME_KEY } from '@/hooks/useEntitlements'

const ok = (queryKey: readonly unknown[]) => ({ queryKey, state: { status: 'success' } })

describe('what the root query cache may persist to localStorage', () => {
  it('never the owner CRM: the personal data of their customers, and a queue that changes with every touch', () => {
    for (const key of [crmKeys.today(), crmKeys.clients(), crmKeys.clients('new'), crmKeys.interactions('c1'), crmKeys.reminders('c1')]) {
      expect(shouldPersistQuery(ok(key))).toBe(false)
    }
  })

  it('never the other user data — the literal roots match the hooks\' real query keys', () => {
    for (const key of [['goals'], ['point-a-state'], ONBOARDING_STATUS_KEY, GRI_ASSESSMENT_KEY, ACCESS_ME_KEY]) {
      expect(shouldPersistQuery(ok(key))).toBe(false)
    }
    expect(NOT_PERSISTED_ROOTS.has(crmKeys.all[0])).toBe(true)
  })

  it('other successful queries are persisted; failed or pending ones never', () => {
    expect(shouldPersistQuery(ok(['metrics-catalog']))).toBe(true)
    expect(shouldPersistQuery({ queryKey: ['metrics-catalog'], state: { status: 'error' } })).toBe(false)
    expect(shouldPersistQuery({ queryKey: ['metrics-catalog'], state: { status: 'pending' } })).toBe(false)
  })

  it('the buster moved past v2, so caches persisted while the CRM was still persisted are dropped', () => {
    expect(PERSIST_BUSTER).not.toBe('v2')
  })
})
