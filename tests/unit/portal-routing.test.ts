import { describe, expect, it } from 'vitest'
import {
  normalizePortalRole,
  ownerRouteForLegacyClientPath,
  portalHomeFor,
} from '@/lib/portal-routing'

describe('portal routing', () => {
  it('keeps pending entrepreneur applicants in the waiting room', () => {
    expect(portalHomeFor('client', 'pending_approval')).toBe('/client/waiting-room')
    expect(portalHomeFor('client', 'rejected')).toBe('/client/waiting-room')
  })

  it('routes approved owners to the canonical owner panel', () => {
    expect(portalHomeFor('owner', 'approved')).toBe('/owner/dashboard')
  })

  it('normalizes legacy employee roles to expert', () => {
    expect(normalizePortalRole('manager')).toBe('expert')
    expect(normalizePortalRole('analyst')).toBe('expert')
  })

  it('maps old client URLs to their owner equivalents after approval', () => {
    expect(ownerRouteForLegacyClientPath('/client/onboarding/documents')).toBe('/owner/documents')
    expect(ownerRouteForLegacyClientPath('/client/onboarding')).toBe('/owner/onboarding')
    expect(ownerRouteForLegacyClientPath('/client/point-a')).toBe('/owner/point-a')
    expect(ownerRouteForLegacyClientPath('/client/dashboard')).toBe('/owner/dashboard')
  })
})
