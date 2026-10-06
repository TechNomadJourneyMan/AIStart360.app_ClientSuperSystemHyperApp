import { describe, it, expect } from 'vitest'
import { postLoginPath, roleLandingPath } from '@/lib/role-landing'

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
    expect(roleLandingPath('owner', 'approved')).toBe('/client/home')
    expect(roleLandingPath('owner', 'pending_approval')).toBe('/client/waiting-room')
  })

  it('sends staff to their panel whatever profiles.role says', () => {
    // super_admin granted only through staff_roles: profiles.role is 'client'.
    expect(roleLandingPath('client', 'approved', 'super_admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('client', 'approved', 'support')).toBe('/admin-giga-panel')
    expect(roleLandingPath('admin', 'approved', 'admin')).toBe('/admin-giga-panel')
    expect(roleLandingPath('client', 'approved', 'super_expert')).toBe('/super-expert')
    expect(roleLandingPath('client', 'approved', null)).toBe('/client/home')
  })

  it('defaults to /dashboard for an unknown/missing role', () => {
    expect(roleLandingPath(null)).toBe('/dashboard')
    expect(roleLandingPath(undefined)).toBe('/dashboard')
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
    for (const from of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/', '/login', '/login?from=/x', '/giga-login', '/register']) {
      expect(postLoginPath({ role: 'client', status: 'approved', from }), from).toBe('/client/home')
    }
  })
})
