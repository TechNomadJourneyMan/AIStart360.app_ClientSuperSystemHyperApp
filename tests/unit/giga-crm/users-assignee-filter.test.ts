import { describe, expect, it } from 'vitest'
import { NO_ASSIGNEE, assigneeParam } from '@/lib/admin/list-users'

const ME = '11111111-2222-4333-8444-555555555555'

describe('«Ответственный» filter — shared by the users list and the CSV export', () => {
  it('maps me / none / a uuid / empty and refuses junk', () => {
    expect(assigneeParam('me', ME)).toBe(ME)
    expect(assigneeParam('none', ME)).toBe(NO_ASSIGNEE)
    expect(assigneeParam(ME, 'x')).toBe(ME)
    expect(assigneeParam('', ME)).toBeNull()
    expect(assigneeParam(null, ME)).toBeNull()
    expect(assigneeParam("1' or 1=1", ME)).toBeUndefined()
    expect(assigneeParam('me', 'not-a-uuid')).toBeUndefined()
  })

  it('the export button sends the assignee filter like the list does', async () => {
    const src = (await import('node:fs')).readFileSync('components/giga-panel/pages/UsersPage.tsx', 'utf8')
    const exportBlock = src.slice(src.indexOf('const exportCsv'), src.indexOf('const canRemind'))
    expect(exportBlock).toContain("'assignee'")
    const route = (await import('node:fs')).readFileSync('app/api/giga-admin/users/export/route.ts', 'utf8')
    expect(route).toContain('assigneeParam(')
  })
})
