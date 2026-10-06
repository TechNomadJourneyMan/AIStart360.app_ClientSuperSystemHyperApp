/**
 * POST /api/v1/admin/clients — admin-side client creation.
 *   • the company is a plain INSERT (an upsert ON CONFLICT (user_id) always
 *     failed: the only unique index on companies.user_id is partial);
 *   • when a step after the auth user fails, the auth user is deleted again
 *     (no orphan approved account; the email can be retried) and a
 *     `client.create.failed` audit entry follows the write-ahead one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ops: [] as string[],
  companyError: null as { message: string } | null,
  deleteUserError: null as { message: string } | null,
  audit: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
}))

function serviceClient() {
  return {
    auth: {
      admin: {
        createUser: async () => { h.ops.push('auth.createUser'); return { data: { user: { id: 'new-user' } }, error: null } },
        deleteUser: async (id: string) => { h.ops.push(`auth.deleteUser:${id}`); return { data: null, error: h.deleteUserError } },
      },
    },
    from(table: string) {
      return {
        upsert: async (_row: unknown, opts?: { onConflict?: string }) => {
          h.ops.push(`${table}.upsert:${opts?.onConflict ?? ''}`)
          // PostgREST on companies: ON CONFLICT (user_id) has no matching (non-partial) unique index.
          if (table === 'companies') return { error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } }
          return { error: null }
        },
        insert: async () => {
          h.ops.push(`${table}.insert`)
          return { error: table === 'companies' ? h.companyError : null }
        },
      }
    },
  }
}

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => serviceClient() }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/supabase-admin-guard', () => ({
  requireSupabaseAdmin: async () => ({ user: { id: 'admin-1', email: 'a@x' }, role: 'admin' }),
}))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string; metadata?: Record<string, unknown> }) => { h.audit.push(entry); return true },
}))

const { POST } = await import('@/app/api/v1/admin/clients/route')

const create = () => POST(new Request('http://localhost/api/v1/admin/clients', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'new@client.kz', password: 'long-enough-pass', companyName: 'ТОО Новый', industry: 'Розница' }),
}))

beforeEach(() => {
  h.ops = []
  h.companyError = null
  h.deleteUserError = null
  h.audit = []
})

describe('POST /api/v1/admin/clients', () => {
  it('creates auth user, approved profile and the company (plain insert)', async () => {
    const res = await create()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, userId: 'new-user' })
    expect(h.ops).toEqual(['auth.createUser', 'profiles.upsert:id', 'companies.insert'])
    expect(h.audit.map((a) => a.action)).toEqual(['client.create'])
  })

  it('a failed company insert deletes the auth user again and records the failure', async () => {
    h.companyError = { message: 'insert failed' }
    const res = await create()
    expect(res.status).toBe(500)
    expect(h.ops).toEqual(['auth.createUser', 'profiles.upsert:id', 'companies.insert', 'auth.deleteUser:new-user'])
    expect(h.audit.map((a) => a.action)).toEqual(['client.create', 'client.create.failed'])
    expect(h.audit[1].metadata).toMatchObject({ authUserCreated: true, rolledBack: true })
  })

  it('a failed rollback is recorded as such', async () => {
    h.companyError = { message: 'insert failed' }
    h.deleteUserError = { message: 'gotrue down' }
    expect((await create()).status).toBe(500)
    expect(h.audit[1].metadata).toMatchObject({ authUserCreated: true, rolledBack: false })
  })
})
