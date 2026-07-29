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

  // A self-registered "employee" is created as pending_approval — the role in
  // the profile must not open the internal portal before the decision.
  it('holds an unapproved staff member in the waiting room', () => {
    expect(roleLandingPath('owner', 'pending_approval')).toBe('/client/waiting-room')
    expect(roleLandingPath('expert', 'requires_clarification')).toBe('/client/waiting-room')
    expect(roleLandingPath('admin', 'rejected')).toBe('/client/waiting-room')
  })

  it('routes approved staff to their portal', () => {
    expect(roleLandingPath('owner', 'approved')).toBe('/owner/dashboard')
    expect(roleLandingPath('expert', 'approved')).toBe('/expert/dashboard')
    expect(roleLandingPath('admin', 'approved')).toBe('/dashboard')
  })

  // super_admin owns the approval flow itself — it can never gate them out.
  it('never holds back super_admin', () => {
    expect(roleLandingPath('super_admin', 'pending_approval')).toBe('/admin-giga-panel')
    expect(roleLandingPath('super_admin', 'rejected')).toBe('/admin-giga-panel')
  })

  // A missing status means the profile row could not be read, which is not a
  // rejection — a failed read must not lock staff out of their own portal.
  it('treats an unknown staff status as a failed read, not a block', () => {
    expect(roleLandingPath('owner', null)).toBe('/owner/dashboard')
    expect(roleLandingPath('expert', undefined)).toBe('/expert/dashboard')
  })

  it('defaults to /dashboard for an unknown/missing role', () => {
    expect(roleLandingPath(null)).toBe('/dashboard')
    expect(roleLandingPath(undefined)).toBe('/dashboard')
  })
})
