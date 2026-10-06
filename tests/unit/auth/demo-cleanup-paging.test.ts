/**
 * Demo-account cleanup with more than one page of auth users (#55). GoTrue's
 * listUsers is offset-paginated: deleting during the walk shifts later users
 * into pages already read. Every expired demo account must still be removed,
 * and failed deletions are logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type U = { id: string; email: string; created_at: string; app_metadata: Record<string, unknown> }
const db = vi.hoisted(() => ({ users: [] as U[], failIds: new Set<string>() }))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        // Offset pagination over the live list, like GoTrue.
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) =>
          ({ data: { users: db.users.slice((page - 1) * perPage, page * perPage) }, error: null }),
        deleteUser: async (id: string) => {
          if (db.failIds.has(id)) return { error: { status: 500, message: 'boom' } }
          db.users = db.users.filter((u) => u.id !== id)
          return { error: null }
        },
      },
    },
  }),
}))
vi.mock('@/lib/inngest', () => ({ inngest: { createFunction: () => ({}) } }))

const { cleanupDemoAccounts } = await import('@/lib/functions/demo-cleanup')

const old = '2026-10-01T00:00:00Z'
const demo = (i: number): U => ({ id: `demo-${i}`, email: `demo-u${i}@aistart360.app`, created_at: old, app_metadata: { demo: true } })
const real = (i: number): U => ({ id: `real-${i}`, email: `user${i}@corp.kz`, created_at: old, app_metadata: {} })

beforeEach(() => {
  db.failIds = new Set()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('cleanupDemoAccounts paging', () => {
  it('removes expired demo accounts on every page, including those that would shift into a read page', async () => {
    // Page 1: 10 demo + 990 real; page 2: 10 demo + 5 real.
    db.users = [
      ...Array.from({ length: 10 }, (_, i) => demo(i)),
      ...Array.from({ length: 990 }, (_, i) => real(i)),
      ...Array.from({ length: 10 }, (_, i) => demo(100 + i)),
      ...Array.from({ length: 5 }, (_, i) => real(1000 + i)),
    ]
    const res = await cleanupDemoAccounts(new Date('2026-10-06T00:00:00Z'))
    expect(res).toEqual({ scanned: 1015, deleted: 20, failed: 0 })
    expect(db.users.some((u) => u.id.startsWith('demo-'))).toBe(false)
    expect(db.users).toHaveLength(995)
  })

  it('logs a failed deletion with the user id', async () => {
    db.users = [demo(1), demo(2)]
    db.failIds.add('demo-2')
    expect(await cleanupDemoAccounts(new Date('2026-10-06T00:00:00Z'))).toEqual({ scanned: 2, deleted: 1, failed: 1 })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('demo-cleanup'), 'demo-2', 500, 'boom')
  })
})
