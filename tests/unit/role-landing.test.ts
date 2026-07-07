import { describe, it, expect } from 'vitest'
import { roleLandingPath } from '@/lib/role-landing'

describe('roleLandingPath (FE-06)', () => {
  it('routes staff/owner roles to their home', () => {
    expect(roleLandingPath('super_admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('owner')).toBe('/owner/dashboard')
    expect(roleLandingPath('expert')).toBe('/expert/dashboard')
    expect(roleLandingPath('admin')).toBe('/dashboard')
  })

  it('routes an approved client to Point A and everyone else to the waiting room', () => {
    expect(roleLandingPath('client', 'approved')).toBe('/client/point-a')
    expect(roleLandingPath('client', 'pending_approval')).toBe('/client/waiting-room')
    expect(roleLandingPath('client', 'rejected')).toBe('/client/waiting-room')
    expect(roleLandingPath('client')).toBe('/client/waiting-room')
  })

  it('defaults to /dashboard for an unknown/missing role', () => {
    expect(roleLandingPath(null)).toBe('/dashboard')
    expect(roleLandingPath(undefined)).toBe('/dashboard')
  })
})
