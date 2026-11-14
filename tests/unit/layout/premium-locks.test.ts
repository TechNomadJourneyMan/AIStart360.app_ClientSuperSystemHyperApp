// R-030: the old menus (components/layout/Sidebar.tsx, MobileNav.tsx) lock
// «Pro» sections only while the access gates are on, and then by the real right
// (hooks/useEntitlements.ts → isSectionLocked).
import { describe, expect, it } from 'vitest'
import { isSectionLocked, premiumSectionOf, type AccessMe } from '@/hooks/useEntitlements'

const access = (over: Partial<AccessMe> = {}): AccessMe => ({
  gatesEnabled: true, tier: 'free', pdf_export: false, ai_chat: false, benchmarks: false, point_b: false, griRunsUsed: 0, canRunFullGri: false, ...over,
})

describe('R-030 isSectionLocked', () => {
  it('gates off (the default; the hook reports tier «free») → no locks at all', () => {
    const off = access({ gatesEnabled: false, tier: 'free' })
    for (const href of ['/metrics', '/market', '/point-b', '/point-b/plan']) expect(isSectionLocked(href, 'client', off)).toBe(false)
  })

  it('gates on: Точка Б follows the point_b entitlement', () => {
    expect(isSectionLocked('/point-b', 'client', access({ point_b: false }))).toBe(true)
    expect(isSectionLocked('/point-b/plan', 'client', access({ point_b: false }))).toBe(true)
    expect(isSectionLocked('/point-b', 'client', access({ point_b: true }))).toBe(false)
  })

  it('gates on: Метрики / Рынок follow the tier', () => {
    expect(isSectionLocked('/metrics', 'client', access({ tier: 'free' }))).toBe(true)
    expect(isSectionLocked('/market', 'client', access({ tier: 'pro' }))).toBe(false)
  })

  it('staff are never locked; other sections are never locked', () => {
    expect(isSectionLocked('/point-b', 'admin', access())).toBe(false)
    expect(isSectionLocked('/point-b', 'super_admin', access())).toBe(false)
    expect(isSectionLocked('/dashboard', 'client', access())).toBe(false)
    expect(isSectionLocked('/marketing', 'client', access())).toBe(false)
  })

  it('premiumSectionOf maps deep paths to the section root', () => {
    expect(premiumSectionOf('/market/x')).toBe('/market')
    expect(premiumSectionOf('/marketplace')).toBeNull()
  })
})

describe('R-030 menus: closing the lock window does not navigate', () => {
  it('Sidebar no longer bounces to /dashboard nor navigates to the locked section', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('components/layout/Sidebar.tsx', 'utf8')
    expect(src).not.toMatch(/router\.push\('\/dashboard'\)/)
    expect(src).not.toMatch(/router\.push\(lockedKey\)/)
    expect(src).toContain('isSectionLocked(href, role, access)')
    expect(readFileSync('components/layout/MobileNav.tsx', 'utf8')).toContain('isSectionLocked(href, role, access)')
  })
})
