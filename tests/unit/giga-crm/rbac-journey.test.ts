import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, canImpersonate, canManageTarget, grantableRoles, hasPermission,
} from '@/lib/admin/rbac'
import { buildJourney } from '@/lib/admin/journey'
import { maskEmail, maskPhone } from '@/lib/admin/mask'

describe('RBAC matrix', () => {
  it('super_admin has everything; admin lacks only roles and system settings', () => {
    expect(ROLE_PERMISSIONS.super_admin.size).toBe(ALL_PERMISSIONS.length)
    const missing = ALL_PERMISSIONS.filter((p) => !hasPermission('admin', p))
    expect(missing.sort()).toEqual(['roles.manage', 'settings.manage'])
  })

  it('restricts destructive and sensitive operations', () => {
    for (const r of STAFF_ROLES) {
      const top = r === 'super_admin' || r === 'admin'
      expect(hasPermission(r, 'gri.delete')).toBe(top)
      expect(hasPermission(r, 'users.archive')).toBe(top)
      expect(hasPermission(r, 'roles.manage')).toBe(r === 'super_admin')
    }
    expect(hasPermission('analyst', 'users.sensitive')).toBe(false)
    expect(hasPermission('analyst', 'impersonate.view')).toBe(false)
    expect(hasPermission('support', 'impersonate.view')).toBe(true)
    expect(hasPermission('support', 'impersonate.edit')).toBe(false)
    expect(hasPermission('content_manager', 'users.view')).toBe(false)
    expect(hasPermission('content_manager', 'content.publish')).toBe(true)
    expect(hasPermission(null, 'dashboard.view')).toBe(false)
  })

  it('every role can at least open the dashboard', () => {
    for (const r of STAFF_ROLES) expect(hasPermission(r, 'dashboard.view')).toBe(true)
  })

  it('staff cannot manage peers or superiors; super_admin manages all', () => {
    expect(canManageTarget('admin', null)).toBe(true)
    expect(canManageTarget('admin', 'crm_manager')).toBe(true)
    expect(canManageTarget('admin', 'admin')).toBe(false)
    expect(canManageTarget('admin', 'super_admin')).toBe(false)
    expect(canManageTarget('crm_manager', 'support')).toBe(true)
    expect(canManageTarget('support', 'analyst')).toBe(false)
    expect(canManageTarget('super_admin', 'super_admin')).toBe(true)
  })

  it('staff accounts are never impersonated', () => {
    expect(canImpersonate('super_admin', { staffRole: null, profileRole: 'client' })).toBe(true)
    expect(canImpersonate('super_admin', { staffRole: 'support', profileRole: 'client' })).toBe(false)
    expect(canImpersonate('super_admin', { staffRole: null, profileRole: 'admin' })).toBe(false)
    expect(canImpersonate('analyst', { staffRole: null, profileRole: 'client' })).toBe(false)
  })

  it('only super_admin grants roles', () => {
    expect(grantableRoles('super_admin')).toContain('super_admin')
    expect(grantableRoles('admin')).toEqual([])
    expect(grantableRoles('support')).toEqual([])
  })
})

describe('journey', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  it('empty facts → no current stage, next is registration', () => {
    const j = buildJourney({}, now)
    expect(j.current).toBeNull()
    expect(j.next?.key).toBe('registered')
    expect(j.completed).toBe(0)
  })

  it('current = furthest reached stage, next = first gap after it', () => {
    const j = buildJourney({
      registered: '2026-09-01T00:00:00Z',
      approved: '2026-09-02T00:00:00Z',
      survey_started: '2026-09-03T00:00:00Z',
      point_a: '2026-09-10T00:00:00Z',
    }, now)
    expect(j.current?.key).toBe('point_a')
    expect(j.previous?.key).toBe('survey_started')
    expect(j.next?.key).toBe('gri_started')
    expect(j.completed).toBe(4)
    expect(j.daysInStage).toBe(7)
  })

  it('everything done → next is null', () => {
    const at = '2026-09-01T00:00:00Z'
    const j = buildJourney({ registered: at, approved: at, survey_started: at, survey_completed: at, point_a: at, gri_started: at, gri_completed: at, point_b: at, content: at }, now)
    expect(j.next).toBeNull()
    expect(j.completed).toBe(j.total)
  })
})

describe('masking', () => {
  it('hides personal contacts', () => {
    expect(maskEmail('ivan@example.com')).toBe('i***@example.com')
    expect(maskEmail(null)).toBeNull()
    expect(maskPhone('+7 701 123 45 67')).toBe('•••67')
  })
})
