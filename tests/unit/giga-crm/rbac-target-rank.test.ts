/**
 * R-048 (RBAC part): the rank of a TARGET also counts experts (profiles.role
 * 'expert') and legacy staff profile roles, not only staff_roles; experts and
 * staff are never impersonated.
 */
import { describe, expect, it } from 'vitest'
import { canImpersonate, canManageTarget, targetRoleOf } from '@/lib/admin/rbac'

describe('R-048: target rank sees experts and legacy staff profiles', () => {
  it('R-048: maps profile roles to a target rank when there is no staff_roles row', () => {
    expect(targetRoleOf({ staffRole: null, profileRole: 'expert' })).toBe('expert')
    expect(targetRoleOf({ staffRole: null, profileRole: 'admin' })).toBe('admin')
    expect(targetRoleOf({ staffRole: null, profileRole: 'super_admin' })).toBe('super_admin')
    expect(targetRoleOf({ staffRole: null, profileRole: 'manager' })).toBe('crm_manager')
    expect(targetRoleOf({ staffRole: null, profileRole: 'analyst' })).toBe('analyst')
    expect(targetRoleOf({ staffRole: null, profileRole: 'client' })).toBeNull()
    expect(targetRoleOf({ staffRole: null, profileRole: 'owner' })).toBeNull()
    expect(targetRoleOf({ staffRole: 'support', profileRole: 'expert' })).toBe('expert')
    expect(targetRoleOf({ staffRole: 'admin', profileRole: 'expert' })).toBe('admin')
  })

  it('R-048: an expert is manageable by admin / super_admin only, not by super_expert, crm_manager or support', () => {
    const expert = { staffRole: null, profileRole: 'expert' }
    expect(canManageTarget('super_admin', expert)).toBe(true)
    expect(canManageTarget('admin', expert)).toBe(true)
    expect(canManageTarget('super_expert', expert)).toBe(false)
    expect(canManageTarget('crm_manager', expert)).toBe(false)
    expect(canManageTarget('support', expert)).toBe(false)
  })

  it('R-048: a legacy admin profile without staff_roles is protected like an admin', () => {
    const legacyAdmin = { staffRole: null, profileRole: 'admin' }
    expect(canManageTarget('crm_manager', legacyAdmin)).toBe(false)
    expect(canManageTarget('admin', legacyAdmin)).toBe(false)
    expect(canManageTarget('super_admin', legacyAdmin)).toBe(true)
  })

  it('R-048: clients stay manageable; the old StaffRole argument still works', () => {
    expect(canManageTarget('crm_manager', { staffRole: null, profileRole: 'client' })).toBe(true)
    expect(canManageTarget('admin', 'crm_manager')).toBe(true)
    expect(canManageTarget('admin', null)).toBe(true)
    expect(canManageTarget('admin', 'expert')).toBe(true)
    expect(canManageTarget('super_expert', 'expert')).toBe(false)
  })

  it('R-048: canImpersonate refuses experts, legacy staff profiles and unknown profiles', () => {
    for (const profileRole of ['expert', 'admin', 'super_admin', 'manager', 'analyst', null]) {
      expect(canImpersonate('super_admin', { staffRole: null, profileRole }), String(profileRole)).toBe(false)
    }
    expect(canImpersonate('super_admin', { staffRole: null, profileRole: 'client' })).toBe(true)
    expect(canImpersonate('super_admin', { staffRole: null, profileRole: 'owner' })).toBe(true)
    expect(canImpersonate('super_admin', { staffRole: 'support', profileRole: 'client' })).toBe(false)
  })
})
