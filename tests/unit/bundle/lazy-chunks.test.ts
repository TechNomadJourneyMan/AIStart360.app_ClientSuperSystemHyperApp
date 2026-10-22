/**
 * Code that a page shows only sometimes is downloaded only when it is shown (W4, bundle sizes):
 * the previous Point A pages (setting `point_a_v4` off), the staff widgets of /dashboard and the
 * User 360 tabs. `next/dynamic` splits a chunk only when called from a client module, so the
 * Server Component pages import client wrapper modules — these checks keep a static import from
 * creeping back (which would put the code into every visitor's first load again).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
/** A value import (type-only imports add nothing to the bundle). */
const staticImportOf = (code: string, mod: string) => new RegExp(`^import (?!type )[^\\n]*from '${mod.replace(/[/@.-]/g, '\\$&')}'`, 'm').test(code)

describe('lazy chunks (W4)', () => {
  it('the wrapper modules are client modules built on next/dynamic', () => {
    for (const p of ['components/point-a/legacy/lazy.tsx', 'components/dashboard/staff-widgets-lazy.tsx']) {
      const code = src(p)
      expect(code.trimStart().startsWith("'use client'"), p).toBe(true)
      expect(code).toContain("import dynamic from 'next/dynamic'")
      expect(code).not.toMatch(/^import (?!dynamic)[^\n]*from '\.\.?\/|^import (?!dynamic|type)[^\n]*from '@\/components/m)
    }
  })

  it('/client/point-a and /point-a do not import the previous page statically', () => {
    const client = src('app/client/point-a/page.tsx')
    expect(staticImportOf(client, '@/components/point-a/legacy/ClientPointALegacy')).toBe(false)
    expect(client).toContain("from '@/components/point-a/legacy/lazy'")
    const legacy = src('components/point-a/legacy/PointALegacyPage.tsx')
    for (const m of ['@/components/point-a/v2/KeyMetricsHero', '@/components/point-a/ExecutiveOverview', '@/components/dashboard/GrowthSnapshotHero', '@/components/point-a/FileArea']) {
      expect(staticImportOf(legacy, m), m).toBe(false)
    }
  })

  it('/dashboard loads the staff widgets through the wrapper', () => {
    const page = src('app/(dashboard)/dashboard/page.tsx')
    for (const m of ['@/components/dashboard/WidgetGrid', '@/components/dashboard/GoalsBar', '@/components/dashboard/DashboardKeyMetrics', '@/components/dashboard/CrmActivity']) {
      expect(staticImportOf(page, m), m).toBe(false)
    }
    expect(page).toContain("from '@/components/dashboard/staff-widgets-lazy'")
  })

  it('User 360 loads its tabs when they are opened (only the profile tab is in the first load)', () => {
    const page = src('components/giga-panel/pages/User360Page.tsx')
    expect(page).toContain("import { ProfileTab } from '@/components/giga-panel/user360/ProfileTab'")
    for (const tab of ['SurveyTab', 'PointATab', 'PointBTab', 'ReviewTab', 'TimelineTab']) {
      expect(page).toMatch(new RegExp(`const ${tab} = dynamic\\(`))
      expect(page).not.toMatch(new RegExp(`^import \\{ ${tab} \\}`, 'm'))
    }
  })
})
