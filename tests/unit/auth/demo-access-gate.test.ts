/**
 * Demo access follows the registration policy, and the daily cleanup only
 * removes old accounts carrying the server-side demo marker.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  mode: 'approval' as string,
  users: [] as Array<{ id: string; email: string; created_at: string; app_metadata: Record<string, unknown> }>,
  deleted: [] as string[],
  created: 0,
}))

vi.mock('@/lib/rate-limit', () => ({ isRateLimited: async () => false }))
vi.mock('@/lib/settings/system-settings', () => ({ getRegistrationMode: async () => state.mode }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { createUser: async () => { state.created++; return { data: null, error: { message: 'stop here' } } } } },
  }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: state.users }, error: null }),
        deleteUser: async (id: string) => { state.deleted.push(id); return { error: null } },
      },
    },
  }),
}))
vi.mock('@/lib/inngest', () => ({ inngest: { createFunction: () => ({}) } }))

const { POST } = await import('@/app/api/auth/demo-access/route')
const { cleanupDemoAccounts } = await import('@/lib/functions/demo-cleanup')

beforeEach(() => {
  state.mode = 'approval'
  state.users = []
  state.deleted = []
  state.created = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  delete process.env.DEMO_ACCESS_ENABLED
})

describe('demo access gate', () => {
  it('is closed in invite-only mode and when switched off', async () => {
    state.mode = 'invite'
    expect((await POST(new Request('http://x/api/auth/demo-access', { method: 'POST' }))).status).toBe(403)
    state.mode = 'approval'
    process.env.DEMO_ACCESS_ENABLED = 'false'
    expect((await POST(new Request('http://x/api/auth/demo-access', { method: 'POST' }))).status).toBe(403)
    expect(state.created).toBe(0)
  })

  it('does not leak provider error text', async () => {
    const res = await POST(new Request('http://x/api/auth/demo-access', { method: 'POST' }))
    expect(state.created).toBe(1)
    expect(JSON.stringify(await res.json())).not.toContain('stop here')
  })
})

describe('demo account cleanup', () => {
  it('deletes only old accounts with the trusted marker and the demo address', async () => {
    const now = new Date('2026-10-06T12:00:00Z')
    const old = '2026-10-05T10:00:00Z'
    state.users = [
      { id: 'a', email: 'demo-abc123@aistart360.app', created_at: old, app_metadata: { demo: true } },
      { id: 'b', email: 'demo-fresh1@aistart360.app', created_at: '2026-10-06T11:00:00Z', app_metadata: { demo: true } },
      { id: 'c', email: 'owner@client.kz', created_at: old, app_metadata: { demo: true } },
      { id: 'd', email: 'demo-nomark@aistart360.app', created_at: old, app_metadata: {} },
    ]
    expect(await cleanupDemoAccounts(now)).toEqual({ scanned: 4, deleted: 1, failed: 0 })
    expect(state.deleted).toEqual(['a'])
  })
})
