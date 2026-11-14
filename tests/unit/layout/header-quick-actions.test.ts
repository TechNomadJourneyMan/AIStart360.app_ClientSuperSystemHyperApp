// Header quick actions (components/layout/Header.tsx): «Инсайты» / «Отчёты» are
// staff sections (middleware ADMIN_PATHS, lib/navigation STAFF_ROLES) — shown
// only to roles that can open them; nothing is removed for staff.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/documents/DocumentUploadDialog', () => ({ DocumentUploadDialog: () => null }))
const { visibleQuickActionGroups } = await import('@/components/layout/Header')

const hrefs = (role: Parameters<typeof visibleQuickActionGroups>[0]) => visibleQuickActionGroups(role).flatMap((g) => g.items.map((i) => i.href))

describe('Header quick actions by role', () => {
  it('a client does not see staff sections', () => {
    const h = hrefs('client')
    expect(h).not.toContain('/insights')
    expect(h).not.toContain('/reports')
    expect(h).toContain('/point-a#files')
    expect(h).toContain('/metrics')
  })

  it('admin and super_admin keep them', () => {
    for (const role of ['admin', 'super_admin'] as const) {
      expect(hrefs(role)).toEqual(expect.arrayContaining(['/insights', '/reports']))
    }
  })
})
