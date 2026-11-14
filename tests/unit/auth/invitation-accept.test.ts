/**
 * Принятие приглашения: запись закрывается один раз, роль из приглашения
 * выдаётся, просроченная ссылка роль не даёт. С SR-04 запись ищется по
 * токену приглашения из письма (см. sr04-invitation-takeover.test.ts —
 * сценарии захвата аккаунта).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  invite: null as null | Record<string, unknown>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        // Аккаунт создан самим приглашением (после него) — отбирать нечего.
        getUserById: async (id: string) => ({ data: { user: { id, created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString() } }, error: null }),
      },
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      let patch: Record<string, unknown> | null = null
      for (const m of ['eq', 'neq', 'limit', 'select', 'is']) b[m] = () => b
      b.maybeSingle = async () => ({ data: s.invite })
      b.update = (p: Record<string, unknown>) => { patch = p; s.updates.push({ table, patch: p }); return b }
      b.upsert = async (row: Record<string, unknown>) => { s.upserts.push(row); return { error: null } }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: patch ? [{ id: 'x' }] : [], error: null }).then(r)
      return b
    },
  }),
}))
vi.mock('@/lib/mfa/store', () => ({ adminResetUserMfa: async () => undefined }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async () => undefined }))

const { acceptInvitation } = await import('@/lib/admin/invites')

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString()
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString()
const invite = (over: Record<string, unknown>) => ({
  email: 'se@company.kz', status: 'sent', link_type: 'invite', sent_at: anHourAgo(), expires_at: inOneHour(), ...over,
})
const accept = (email: string, userId: string) => acceptInvitation({ inviteToken: 'tok', userId, email, accessToken: 'jwt' })

beforeEach(() => {
  s.invite = null
  s.updates = []
  s.upserts = []
})

describe('acceptInvitation', () => {
  it('без приглашения ничего не делает', async () => {
    const r = await accept('new@company.kz', 'u-1')
    expect(r).toMatchObject({ accepted: false, staffRole: null })
    expect(s.upserts).toHaveLength(0)
  })

  it('закрывает приглашение и не выдаёт роль, если её не было', async () => {
    s.invite = invite({ id: 'inv-1', email: 'new@company.kz', staff_role: null, user_id: 'u-1' })
    const r = await accept('new@company.kz', 'u-1')
    expect(r.accepted).toBe(true)
    expect(r.staffRole).toBeNull()
    expect(s.updates[0].patch.status).toBe('accepted')
    expect(s.upserts).toHaveLength(0)
  })

  it('выдаёт роль из приглашения и одобряет аккаунт сотрудника', async () => {
    s.invite = invite({ id: 'inv-2', staff_role: 'super_expert', user_id: 'u-2' })
    const r = await accept('se@company.kz', 'u-2')
    expect(r.staffRole).toBe('super_expert')
    expect(s.upserts[0]).toMatchObject({ user_id: 'u-2', role: 'super_expert' })
    expect(s.updates.some((u) => u.table === 'profiles' && u.patch.status === 'approved')).toBe(true)
  })

  it('просроченное приглашение роль не выдаёт', async () => {
    s.invite = invite({ id: 'inv-3', staff_role: 'super_expert', user_id: 'u-3', expires_at: anHourAgo() })
    const r = await accept('se@company.kz', 'u-3')
    expect(r.accepted).toBe(false)
    expect(r.staffRole).toBeNull()
    expect(s.upserts).toHaveLength(0)
    expect(s.updates[0].patch.status).toBe('expired')
  })

  it('некорректный адрес не ходит в базу', async () => {
    const r = await accept('не-почта', 'u-4')
    expect(r.accepted).toBe(false)
    expect(s.updates).toHaveLength(0)
  })
})
