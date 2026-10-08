import { describe, it, expect } from 'vitest'
import type { UserRole } from '@/types'
import {
  getNavForRole,
  getPrimaryNavForRole,
  hasPermission,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from '@/lib/navigation'

const ALL_ROLES: UserRole[] = ['client', 'expert', 'admin', 'super_admin']

describe('navigation (FE-01/02 canonical lowercase roles)', () => {
  it('every canonical role has a label and a permission entry (no crash on lookup)', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy()
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true)
      expect(() => hasPermission(role, 'clients.read')).not.toThrow()
      expect(Array.isArray(getNavForRole(role))).toBe(true)
    }
  })

  it('a client sees their own dashboard items but NOT staff-only pages', () => {
    const hrefs = getNavForRole('client').map((i) => i.href)
    expect(hrefs).toContain('/dashboard')
    expect(hrefs).toContain('/gri')
    expect(hrefs).not.toContain('/clients')
    expect(hrefs).not.toContain('/admin')
    expect(hrefs).not.toContain('/users')
    expect(hrefs).not.toContain('/team')
  })

  it('admin and super_admin see the staff pages; user management links go to the GIGA panel', () => {
    for (const role of ['admin', 'super_admin'] as UserRole[]) {
      const hrefs = getNavForRole(role, { panelAccess: true }).map((i) => i.href)
      expect(hrefs).toContain('/admin-giga-panel/users')
      expect(hrefs).toContain('/admin-giga-panel/requests')
      expect(hrefs).toContain('/clients')
      // The removed legacy screens are not linked any more.
      expect(hrefs).not.toContain('/admin')
      expect(hrefs).not.toContain('/users')
    }
  })

  it('GIGA links need panel access: a legacy admin without a staff role does not get dead links', () => {
    const legacy = getNavForRole('admin', { panelAccess: false }).map((i) => i.href)
    expect(legacy).not.toContain('/admin-giga-panel/users')
    expect(legacy).not.toContain('/admin-giga-panel/requests')
    expect(getNavForRole('admin').map((i) => i.href)).not.toContain('/admin-giga-panel/users')
    expect(getNavForRole('super_admin').map((i) => i.href)).toContain('/admin-giga-panel/users')
  })

  it("'owner' is no longer a role (removed 2026-09-24): no label, no permission entry", () => {
    // Legacy owner rows are normalised to 'client' before reaching navigation
    // (stores/auth.store.ts normalizeRole, middleware, lib/role-landing.ts).
    expect(Object.keys(ROLE_LABELS)).not.toContain('owner')
    expect(Object.keys(ROLE_PERMISSIONS)).not.toContain('owner')
  })

  it('primary nav for a client includes Точка А / Метрики', () => {
    const hrefs = getPrimaryNavForRole('client').map((i) => i.href)
    expect(hrefs).toContain('/point-a')
    expect(hrefs).toContain('/metrics')
  })

  it('permissions: wildcards, scoping and denials work per role', () => {
    expect(hasPermission('super_admin', 'anything.at.all')).toBe(true)
    expect(hasPermission('admin', 'clients.read')).toBe(true)   // clients.* wildcard
    expect(hasPermission('admin', 'billing.write')).toBe(true)  // billing.* wildcard
    expect(hasPermission('expert', 'clients.read')).toBe(true)
    expect(hasPermission('expert', 'team.write')).toBe(false)
    expect(hasPermission('client', 'clients.read')).toBe(false)
    expect(hasPermission('client', 'own.gri')).toBe(true)
  })
})
