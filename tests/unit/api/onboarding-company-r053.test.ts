/**
 * R-053 (б): POST /api/v1/onboarding/company writes only the whitelisted
 * step-1 fields (Zod .strict()); service columns are refused, never written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  existing: null as Row | null,
  writes: [] as Array<{ op: 'insert' | 'update'; row: Row }>,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => {
      let last: Row | null = null
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        single: async () => ({ data: last ? { id: 'c-1', ...last } : h.existing, error: null }),
        insert: (row: Row) => { h.writes.push({ op: 'insert', row }); last = row; return b },
        update: (row: Row) => { h.writes.push({ op: 'update', row }); last = row; return b },
      })
      return b
    },
  }),
}))

const { POST } = await import('@/app/api/v1/onboarding/company/route')
const call = async (body: unknown) => {
  const res = await POST(new NextRequest('http://localhost/api/v1/onboarding/company', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))
  return { status: res.status, body: await res.json() }
}

/** Exactly what app/client/onboarding/page.tsx and lib/survey/answers-controller.ts send. */
const FORM = {
  name: 'ТОО Береке', industry: 'Ритейл', employee_count: 12, founded_at: '2019-01-01', business_model: 'B2C',
  regions: ['Алматы'], contact_name: 'Айдар', contact_position: 'CEO', contact_phone: '+77010000000', contact_email: 'a@b.kz',
}

beforeEach(() => {
  h.existing = null
  h.writes = []
})

describe('R-053 POST /api/v1/onboarding/company — whitelist', () => {
  it('the form fields are written (insert with user_id from the session)', async () => {
    const r = await call(FORM)
    expect(r.status).toBe(200)
    expect(h.writes).toEqual([{ op: 'insert', row: { ...FORM, user_id: 'u-1' } }])
  })

  it('R-053: partner_id / status / stage / id / target_revenue / timestamps are refused, nothing is written', async () => {
    for (const extra of [
      { partner_id: '00000000-0000-4000-8000-000000000001' },
      { status: 'active' },
      { stage: 'Scale' },
      { id: 'c-other' },
      { target_revenue_12m_kzt: 1e12 },
      { created_at: '2000-01-01' },
      { size: 'L' },
    ]) {
      h.existing = { id: 'c-1' }
      const r = await call({ ...FORM, ...extra })
      expect(r.status, JSON.stringify(extra)).toBe(400)
      expect(r.body).toMatchObject({ ok: false, code: 'invalid_body', field: Object.keys(extra)[0] })
    }
    expect(h.writes).toHaveLength(0)
  })

  it('user_id in the body is still tolerated and ignored (the session decides)', async () => {
    const r = await call({ ...FORM, user_id: 'u-attacker' })
    expect(r.status).toBe(200)
    expect(h.writes[0].row.user_id).toBe('u-1')
  })

  it('an update touches only the keys that came, and never the owner', async () => {
    h.existing = { id: 'c-1' }
    const r = await call({ name: 'ТОО Новое', regions: ['Астана'] })
    expect(r.status).toBe(200)
    expect(h.writes).toHaveLength(1)
    const { updated_at, ...row } = h.writes[0].row
    expect(typeof updated_at).toBe('string')
    expect(row).toEqual({ name: 'ТОО Новое', regions: ['Астана'] })
  })

  it('R-149: types and lengths are checked', async () => {
    for (const bad of [
      { name: 'x'.repeat(201) },
      { name: 'ТОО', regions: 'Алматы' },
      { name: 'ТОО', regions: Array.from({ length: 51 }, () => 'А') },
      { name: 'ТОО', employee_count: -1 },
      { name: 'ТОО', employee_count: 'много' },
      { name: 'ТОО', contact_email: 'a'.repeat(400) },
      { name: 'ТОО', industry: { $gt: '' } },
    ]) {
      const r = await call(bad)
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.body.ok).toBe(false)
    }
    expect(h.writes).toHaveLength(0)
  })

  it('the survey envelopes and empty values keep working', async () => {
    const r = await call({ name: 'ТОО', employee_count: { value: 7 }, industry: null, founded_at: undefined })
    expect(r.status).toBe(200)
    expect(h.writes[0].row).toEqual({ name: 'ТОО', employee_count: 7, industry: null, user_id: 'u-1' })
  })

  it('a new company without a name is a 400 (the column is NOT NULL), an empty name is never written', async () => {
    expect((await call({ industry: 'Ритейл' })).status).toBe(400)
    h.existing = { id: 'c-1' }
    const r = await call({ name: '   ', industry: 'Ритейл' })
    expect(r.status).toBe(200)
    expect(h.writes[0].row).not.toHaveProperty('name')
  })
})
