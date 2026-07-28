import { describe, it, expect } from 'vitest'
import {
  CLIENT_DASHBOARD_PATH,
  CLIENT_WAITING_ROOM_PATH,
  clientLandingPath,
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

  it('defaults to /dashboard for an unknown/missing role', () => {
    expect(roleLandingPath(null)).toBe('/dashboard')
    expect(roleLandingPath(undefined)).toBe('/dashboard')
  })
})
