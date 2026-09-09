import { describe, it, expect } from 'vitest'
import {
  CLIENT_DASHBOARD_PATH,
  CLIENT_WAITING_ROOM_PATH,
  clientLandingPath,
  postLoginPath,
  roleLandingPath,
} from '@/lib/role-landing'

describe('roleLandingPath (FE-06)', () => {
  it('routes staff/owner roles to their home', () => {
    expect(roleLandingPath('super_admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('owner')).toBe('/owner/dashboard')
    expect(roleLandingPath('expert')).toBe('/expert/dashboard')
    expect(roleLandingPath('admin')).toBe('/dashboard')
  })

  it('routes an approved client to the canonical dashboard and everyone else to the waiting room', () => {
    expect(roleLandingPath('client', 'approved')).toBe(CLIENT_DASHBOARD_PATH)
    expect(roleLandingPath('client', 'pending_approval')).toBe(CLIENT_WAITING_ROOM_PATH)
    expect(roleLandingPath('client', 'rejected')).toBe(CLIENT_WAITING_ROOM_PATH)
    expect(roleLandingPath('client')).toBe(CLIENT_WAITING_ROOM_PATH)
  })

  it('uses the same client completion rule outside authentication screens', () => {
    expect(clientLandingPath('approved')).toBe('/dashboard')
    expect(clientLandingPath('pending_approval')).toBe('/client/waiting-room')
    expect(clientLandingPath(null)).toBe('/client/waiting-room')
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

describe('postLoginPath', () => {
  it.each(['client', 'admin', 'super_admin'] as const)(
    'returns an approved %s to the requested Store',
    (role) => {
      expect(postLoginPath(role, 'approved', '/store')).toBe('/store')
    },
  )

  it.each(['client', 'admin', 'super_admin'] as const)(
    'returns an approved %s to the requested Store Journey projection',
    (role) => {
      expect(postLoginPath(role, 'approved', '/client/journey/store')).toBe('/client/journey/store')
    },
  )

  it.each(['client', 'admin', 'super_admin'] as const)(
    'returns an approved %s to the requested Clinic cabinet',
    (role) => {
      expect(postLoginPath(role, 'approved', '/clinic')).toBe('/clinic')
    },
  )

  it('keeps owner and expert on their canonical portals', () => {
    expect(postLoginPath('owner', 'approved', '/store')).toBe('/owner/dashboard')
    expect(postLoginPath('expert', 'approved', '/store')).toBe('/expert/dashboard')
    expect(postLoginPath('owner', 'approved', '/client/journey/store')).toBe('/owner/dashboard')
    expect(postLoginPath('expert', 'approved', '/client/journey/store')).toBe('/expert/dashboard')
    expect(postLoginPath('owner', 'approved', '/clinic')).toBe('/owner/dashboard')
    expect(postLoginPath('expert', 'approved', '/clinic')).toBe('/expert/dashboard')
  })

  it.each(['client', 'admin', 'owner', 'expert'] as const)(
    'does not send a pending %s to Store',
    (role) => {
      expect(postLoginPath(role, 'pending_approval', '/store')).toBe('/client/waiting-room')
    },
  )

  it('keeps a pending super admin on its existing role landing', () => {
    expect(postLoginPath('super_admin', 'pending_approval', '/store')).toBe('/admin-giga-panel')
  })

  it('does not let other or unsafe return targets override role landing', () => {
    expect(postLoginPath('client', 'approved', '/settings')).toBe('/dashboard')
    expect(postLoginPath('client', 'approved', 'https://evil.example/store')).toBe('/dashboard')
    expect(postLoginPath('client', 'approved', '//evil.example/store')).toBe('/dashboard')
    expect(postLoginPath(null, 'approved', '/store')).toBe('/dashboard')
  })
})
