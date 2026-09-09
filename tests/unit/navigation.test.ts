import { describe, it, expect } from 'vitest'
import type { UserRole } from '@/types'
import {
  getNavForRole,
  getAllowedHrefsForRole,
  getMobileDrawerSectionsForRole,
  getMobileBottomTabsForRole,
  getPrimaryNavForRole,
  getVerticalNavItem,
  hasPermission,
  isActiveNavPath,
  isMobileMoreRouteActive,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from '@/lib/navigation'
import type { VerticalId } from '@/lib/verticals'

const ALL_ROLES: UserRole[] = ['client', 'expert', 'owner', 'admin', 'super_admin']

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

  it('admin and super_admin see the staff pages', () => {
    for (const role of ['admin', 'super_admin'] as UserRole[]) {
      const hrefs = getNavForRole(role).map((i) => i.href)
      expect(hrefs).toContain('/admin')
      expect(hrefs).toContain('/clients')
    }
  })

  it('primary nav for a client includes Точка А / Метрики', () => {
    const hrefs = getPrimaryNavForRole('client').map((i) => i.href)
    expect(hrefs).toContain('/point-a')
    expect(hrefs).toContain('/metrics')
    expect(hrefs).not.toContain('/store')
  })

  it('maps every business vertical to the correct specialized slot', () => {
    const matrix: Array<{
      vertical: VerticalId
      expected: { label: string; href: string; icon: string } | null
    }> = [
      { vertical: 'generic', expected: null },
      {
        vertical: 'medical',
        expected: {
          label: 'Клиника',
          href: '/clinic',
          icon: 'medical_services',
        },
      },
      {
        vertical: 'ecommerce',
        expected: { label: 'Магазин', href: '/store', icon: 'storefront' },
      },
    ]

    for (const { vertical, expected } of matrix) {
      const item = getVerticalNavItem(vertical)
      if (!expected) {
        expect(item).toBeNull()
      } else {
        expect(item).toMatchObject(expected)
      }
    }
  })

  it('keeps desktop and mobile specialized navigation exactly in sync', () => {
    for (const vertical of ['medical', 'ecommerce'] as VerticalId[]) {
      const desktopItem = getVerticalNavItem(vertical)
      expect(desktopItem).not.toBeNull()

      const desktop = getPrimaryNavForRole('client', vertical)
      const mobile = getMobileDrawerSectionsForRole('client', vertical)
        .flatMap((section) => section.items)
      const href = desktopItem!.href

      expect(desktop.filter((item) => item.href === href)).toHaveLength(1)
      expect(mobile.filter((item) => item.href === href)).toHaveLength(1)
      expect(mobile.find((item) => item.href === href)).toMatchObject({
        label: desktopItem!.label,
        href,
        icon: desktopItem!.icon,
      })
    }
  })

  it('shows no duplicate business slot for generic companies', () => {
    const desktop = getPrimaryNavForRole('client', 'generic')
    const mobile = getMobileDrawerSectionsForRole('client', 'generic')
      .flatMap((section) => section.items)

    expect(desktop.filter((item) => item.href === '/dashboard')).toHaveLength(1)
    expect(mobile.filter((item) => item.href === '/dashboard')).toHaveLength(1)
    expect(desktop.map((item) => item.href)).not.toContain('/store')
    expect(desktop.map((item) => item.href)).not.toContain('/clinic')
  })

  it('shows a specialized slot only to shared-cabinet roles', () => {
    for (const role of ['client', 'admin', 'super_admin'] as UserRole[]) {
      expect(getPrimaryNavForRole(role, 'ecommerce').map((item) => item.href)).toContain('/store')
      expect(getAllowedHrefsForRole(role, 'ecommerce')).toContain('/store')
      expect(getAllowedHrefsForRole(role, 'medical')).toContain('/clinic')
    }
    for (const role of ['expert', 'owner'] as UserRole[]) {
      expect(getPrimaryNavForRole(role, 'ecommerce').map((item) => item.href)).not.toContain('/store')
      expect(getPrimaryNavForRole(role, 'medical').map((item) => item.href))
        .not.toContain('/clinic')
    }
  })

  it('never leaks a different vertical into allowed navigation', () => {
    expect(getAllowedHrefsForRole('client', 'generic')).not.toContain('/store')
    expect(getAllowedHrefsForRole('client', 'generic')).not.toContain('/clinic')
    expect(getAllowedHrefsForRole('client', 'medical')).not.toContain('/store')
    expect(getAllowedHrefsForRole('client', 'ecommerce')).not.toContain('/clinic')
  })

  it('marks «Ещё» active only for drawer-only destinations', () => {
    const tabs = getMobileBottomTabsForRole('client', 'ecommerce')
    const sections = getMobileDrawerSectionsForRole('client', 'ecommerce')

    expect(isMobileMoreRouteActive('/dashboard', tabs, sections)).toBe(false)
    expect(isMobileMoreRouteActive('/pulse', tabs, sections)).toBe(false)
    expect(isMobileMoreRouteActive('/metrics', tabs, sections)).toBe(false)
    expect(isMobileMoreRouteActive('/store', tabs, sections)).toBe(true)
    expect(isMobileMoreRouteActive('/store/imports', tabs, sections)).toBe(true)
  })

  it('matches active navigation by whole path segment', () => {
    expect(isActiveNavPath('/store', '/store')).toBe(true)
    expect(isActiveNavPath('/store/inventory', '/store')).toBe(true)
    expect(isActiveNavPath('/storefront', '/store')).toBe(false)
    expect(isActiveNavPath('/clinic/patients', '/clinic')).toBe(true)
    expect(isActiveNavPath('/clinical', '/clinic')).toBe(false)
  })

  it('permissions: wildcards, scoping and denials work per role', () => {
    expect(hasPermission('super_admin', 'anything.at.all')).toBe(true)
    expect(hasPermission('owner', 'anything.at.all')).toBe(true)
    expect(hasPermission('admin', 'clients.read')).toBe(true)   // clients.* wildcard
    expect(hasPermission('admin', 'billing.write')).toBe(true)  // billing.* wildcard
    expect(hasPermission('expert', 'clients.read')).toBe(true)
    expect(hasPermission('expert', 'team.write')).toBe(false)
    expect(hasPermission('client', 'clients.read')).toBe(false)
    expect(hasPermission('client', 'own.gri')).toBe(true)
  })
})
