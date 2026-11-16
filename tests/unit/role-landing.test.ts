import { describe, it, expect } from 'vitest'
import type { UserRole } from '@/types'
import { CABINET_ENTRY_PATH, postLoginPath, roleLandingPath } from '@/lib/role-landing'

// 'owner' left the UserRole type (removed 2026-09-24); legacy rows still carry it.
const LEGACY_OWNER = 'owner' as unknown as UserRole

describe('roleLandingPath (FE-06)', () => {
  it('routes staff roles to their home', () => {
    expect(roleLandingPath('super_admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('expert')).toBe('/expert/dashboard')
    expect(roleLandingPath('admin')).toBe('/dashboard')
  })

  it('routes an approved client to Point A and everyone else to the waiting room', () => {
    expect(roleLandingPath('client', 'approved')).toBe('/client/home')
    expect(roleLandingPath('client', 'pending_approval')).toBe('/client/waiting-room')
    expect(roleLandingPath('client', 'rejected')).toBe('/client/waiting-room')
    expect(roleLandingPath('client')).toBe('/client/waiting-room')
  })

  it('treats the legacy owner role as a client (the owner cabinet was removed)', () => {
    expect(roleLandingPath(LEGACY_OWNER, 'approved')).toBe('/client/home')
    expect(roleLandingPath(LEGACY_OWNER, 'pending_approval')).toBe('/client/waiting-room')
  })

  it('sends staff to their panel whatever profiles.role says', () => {
    // super_admin granted only through staff_roles: profiles.role is 'client'.
    expect(roleLandingPath('client', 'approved', 'super_admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('client', 'approved', 'support')).toBe('/admin-giga-panel')
    expect(roleLandingPath('admin', 'approved', 'admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('client', 'approved', 'super_expert')).toBe('/super-expert')
    expect(roleLandingPath('client', 'approved', null)).toBe('/client/home')
  })

  it('R-029: an unknown / missing role is a client (as middleware normalizeRole) — never the old /dashboard', () => {
    expect(roleLandingPath(null, 'approved')).toBe('/client/home')
    expect(roleLandingPath(undefined)).toBe('/client/waiting-room')
    expect(roleLandingPath('unknown' as unknown as UserRole, 'approved')).toBe('/client/home')
    // legacy manager / analyst rows are experts (middleware normalizeRole)
    expect(roleLandingPath('manager' as unknown as UserRole, 'approved')).toBe('/expert/dashboard')
    expect(roleLandingPath('analyst' as unknown as UserRole)).toBe('/expert/dashboard')
  })

  it('R-002: a legacy super_admin profile looked up WITHOUT a staff_roles row lands as a client (the panel would bounce it: loop)', () => {
    expect(roleLandingPath('super_admin', 'approved', null)).toBe('/client/home')
    expect(roleLandingPath('super_admin', 'pending_approval', null)).toBe('/client/waiting-room')
    // with the row — the panel; not looked up (undefined) — the panel decides, as before
    expect(roleLandingPath('super_admin', 'approved', 'super_admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('super_admin', 'approved')).toBe('/admin-giga-panel')
  })

  it('R-029: the cabinet entry of the role-blind entries (e-mail link, invitation, 404) is the role-landing hub /login', () => {
    expect(CABINET_ENTRY_PATH).toBe('/login')
  })
})

describe('postLoginPath', () => {
  it('honours a safe same-origin ?from= even when the role is known', () => {
    expect(postLoginPath({ role: 'super_admin', from: '/admin-giga-panel/users?q=a' })).toBe('/admin-giga-panel/users?q=a')
    expect(postLoginPath({ role: 'client', status: 'approved', from: '/metrics' })).toBe('/metrics')
  })

  it('falls back to the role landing without from, or for unsafe / auth-page targets', () => {
    expect(postLoginPath({ role: 'super_admin' })).toBe('/admin-giga-panel')
    expect(postLoginPath({ role: 'client', status: 'approved', staffRole: 'super_admin', from: null })).toBe('/admin-giga-panel')
    // the sign-in form passes the looked-up staff role (null = no row)
    expect(postLoginPath({ role: 'super_admin', status: 'approved', staffRole: null })).toBe('/client/home')
    for (const from of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/', '/login', '/login?from=/x', '/giga-login', '/register']) {
      expect(postLoginPath({ role: 'client', status: 'approved', from }), from).toBe('/client/home')
    }
  })
})
