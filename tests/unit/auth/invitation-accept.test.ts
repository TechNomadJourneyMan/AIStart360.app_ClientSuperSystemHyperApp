/**
 * Принятие приглашения: запись закрывается один раз, роль из приглашения
 * выдаётся, просроченная ссылка роль не даёт.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  invite: null as null | { id: string; staff_role: string | null; expires_at: string },
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        ilike: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: s.invite }) }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        s.updates.push({ table, patch })
        const chain = {
          eq: () => chain,
          neq: async () => ({ error: null }),
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        }
        return chain
      },
      upsert: async (row: Record<string, unknown>) => { s.upserts.push(row); return { error: null } },
    }),
  }),
}))

const { acceptInvitation } = await import('@/lib/admin/invites')

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString()
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString()

beforeEach(() => {
  s.invite = null
  s.updates = []
  s.upserts = []
})

describe('acceptInvitation', () => {
  it('без приглашения ничего не делает', async () => {
    const r = await acceptInvitation('new@company.kz', 'u-1')
    expect(r).toEqual({ accepted: false, staffRole: null })
    expect(s.upserts).toHaveLength(0)
  })

  it('закрывает приглашение и не выдаёт роль, если её не было', async () => {
    s.invite = { id: 'inv-1', staff_role: null, expires_at: inOneHour() }
    const r = await acceptInvitation('new@company.kz', 'u-1')
    expect(r.accepted).toBe(true)
    expect(r.staffRole).toBeNull()
    expect(s.updates[0].patch.status).toBe('accepted')
    expect(s.upserts).toHaveLength(0)
  })

  it('выдаёт роль из приглашения и одобряет аккаунт сотрудника', async () => {
    s.invite = { id: 'inv-2', staff_role: 'super_expert', expires_at: inOneHour() }
    const r = await acceptInvitation('se@company.kz', 'u-2')
    expect(r.staffRole).toBe('super_expert')
    expect(s.upserts[0]).toMatchObject({ user_id: 'u-2', role: 'super_expert' })
    expect(s.updates.some((u) => u.table === 'profiles' && u.patch.status === 'approved')).toBe(true)
  })

  it('просроченное приглашение роль не выдаёт', async () => {
    s.invite = { id: 'inv-3', staff_role: 'super_expert', expires_at: anHourAgo() }
    const r = await acceptInvitation('se@company.kz', 'u-3')
    expect(r.accepted).toBe(false)
    expect(r.staffRole).toBeNull()
    expect(s.upserts).toHaveLength(0)
    expect(s.updates[0].patch.status).toBe('expired')
  })

  it('некорректный адрес не ходит в базу', async () => {
    const r = await acceptInvitation('не-почта', 'u-4')
    expect(r.accepted).toBe(false)
    expect(s.updates).toHaveLength(0)
  })
})
