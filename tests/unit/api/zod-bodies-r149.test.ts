/**
 * R-149: request bodies through Zod — /api/v1/crm/* (clients, interactions,
 * reminders, connections) and /api/checkout. The legitimate bodies of the
 * known callers (hooks/useCrm.ts, components/crm/*, components/settings/
 * IntegrationsPanel.tsx, app/(dashboard)/pulse, app/_components/
 * CheckoutButton.tsx) still pass; junk is a 400 { ok:false, code:'invalid_body' }
 * before any write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

type Row = Record<string, unknown>
const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const REMINDER_ID = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; op: string; row: Row }>,
  tested: 0,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'u@corp.kz' } }, error: null }) },
    from: (table: string) => {
      let row: Row | null = null
      const b: Record<string, unknown> = {}
      const result = () => ({ data: row ?? { id: table === 'crm_reminders' ? REMINDER_ID : CLIENT_ID, client_id: CLIENT_ID, status: 'new' }, error: null })
      Object.assign(b, {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        insert: (r: Row) => { h.writes.push({ table, op: 'insert', row: r }); row = r; return b },
        update: (r: Row) => { h.writes.push({ table, op: 'update', row: r }); row = r; return b },
        upsert: (r: Row) => { h.writes.push({ table, op: 'upsert', row: r }); row = r; return b },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [result().data], error: null }).then(res),
      })
      return b
    },
  }),
}))
vi.mock('@/lib/crm/provider-client', () => ({ testProvider: async () => { h.tested += 1; return { ok: true } } }))
vi.mock('@/lib/crm/token-store', () => ({ sealCrmToken: (t: string) => `sealed:${t.length}` }))

const clients = await import('@/app/api/v1/crm/clients/route')
const client = await import('@/app/api/v1/crm/clients/[id]/route')
const interactions = await import('@/app/api/v1/crm/clients/[id]/interactions/route')
const reminders = await import('@/app/api/v1/crm/clients/[id]/reminders/route')
const reminder = await import('@/app/api/v1/crm/reminders/[id]/route')
const connections = await import('@/app/api/v1/crm/connections/route')
const { describeIssue, parseBody, readJsonBody } = await import('@/lib/validation/http')
const { CheckoutBody, FinmodelPutBody } = await import('@/lib/validation/schemas')

const req = (method: string, body: unknown, raw = false) =>
  new NextRequest('http://localhost/api', {
    method, body: raw ? (body as string) : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
const out = async (r: Response) => ({ status: r.status, body: await r.json() })
const idp = (id: string) => ({ params: { id } })

beforeEach(() => {
  h.writes = []
  h.tested = 0
})

describe('R-149 /api/v1/crm/clients', () => {
  it('the bodies the UI sends pass (AddClientInline, ClientDrawer, ClientsTable)', async () => {
    expect((await clients.POST(req('POST', { name: 'Айгуль', phone: '+7 701 000 00 00' }))).status).toBe(200)
    expect((await clients.POST(req('POST', { name: 'Айгуль' }))).status).toBe(200)
    expect((await client.PATCH(req('PATCH', { status: 'customer' }), idp(CLIENT_ID))).status).toBe(200)
    const drawer = { name: 'Айгуль', phone: '', email: null, status: 'waiting', avg_check: 15000, next_contact_at: null, note: null }
    expect((await client.PATCH(req('PATCH', drawer), idp(CLIENT_ID))).status).toBe(200)
  })

  it('R-149: service columns and junk types are refused before any write', async () => {
    for (const bad of [
      { name: 'A', user_id: 'u-2' },
      { name: 'A', id: CLIENT_ID },
      { name: 'A', created_at: '2000-01-01' },
      { name: 'A', last_contact_at: '2000-01-01' },
      { name: ['A'] },
      { name: 'A', avg_check: true },
      { name: 'A', avg_check: -1 },
      { name: 'A', note: 'x'.repeat(10_001) },
      'A',
      null,
    ]) {
      const r = await out(await clients.POST(req('POST', bad)))
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.body.ok).toBe(false)
      const p = await out(await client.PATCH(req('PATCH', bad), idp(CLIENT_ID)))
      expect(p.status, `PATCH ${JSON.stringify(bad)}`).toBe(400)
    }
    expect(h.writes).toHaveLength(0)
  })

  it('a body that is not JSON → 400', async () => {
    expect((await clients.POST(req('POST', '{name:', true))).status).toBe(400)
  })
})

describe('R-149 /api/v1/crm/clients/:id/interactions and reminders', () => {
  it('the bodies the UI sends pass', async () => {
    expect((await interactions.POST(req('POST', { kind: 'call', comment: 'Звонок из карточки' }), idp(CLIENT_ID))).status).toBe(200)
    expect((await interactions.POST(req('POST', { kind: 'message' }), idp(CLIENT_ID))).status).toBe(200)
    expect((await reminders.POST(req('POST', { due_at: '2026-12-01T10:00:00.000Z', note: 'перезвонить' }), idp(CLIENT_ID))).status).toBe(200)
    expect((await reminder.PATCH(req('PATCH', { status: 'done' }), idp(REMINDER_ID))).status).toBe(200)
    expect((await reminder.PATCH(req('PATCH', { status: 'dismissed', next_contact_at: '2026-12-02T10:00:00.000Z' }), idp(REMINDER_ID))).status).toBe(200)
  })

  it('a long WhatsApp draft is still cut to 2000, not refused', async () => {
    const r = await interactions.POST(req('POST', { kind: 'message', comment: 'я'.repeat(3000) }), idp(CLIENT_ID))
    expect(r.status).toBe(200)
    expect(String(h.writes.find((w) => w.table === 'crm_interactions')?.row.comment)).toHaveLength(2000)
  })

  it('R-149: junk is refused before any write', async () => {
    const cases: Array<[() => Promise<Response>, string]> = [
      [() => interactions.POST(req('POST', { kind: 'status_change' }), idp(CLIENT_ID)), 'kind'],
      [() => interactions.POST(req('POST', { kind: 'call', user_id: 'u-2' }), idp(CLIENT_ID)), 'user_id'],
      [() => interactions.POST(req('POST', { kind: 'call', comment: { a: 1 } }), idp(CLIENT_ID)), 'comment'],
      [() => reminders.POST(req('POST', {}), idp(CLIENT_ID)), 'due_at'],
      [() => reminders.POST(req('POST', { due_at: 'завтра' }), idp(CLIENT_ID)), 'due_at'],
      [() => reminders.POST(req('POST', { due_at: '2026-12-01', status: 'done' }), idp(CLIENT_ID)), 'status'],
      [() => reminder.PATCH(req('PATCH', { status: 'open' }), idp(REMINDER_ID)), 'status'],
      [() => reminder.PATCH(req('PATCH', { status: 'done', next_contact_at: 'когда-нибудь' }), idp(REMINDER_ID)), 'next_contact_at'],
      [() => reminder.PATCH(req('PATCH', { status: 'done', client_id: CLIENT_ID }), idp(REMINDER_ID)), 'client_id'],
    ]
    for (const [run, field] of cases) {
      const r = await out(await run())
      expect(r.status, field).toBe(400)
      expect(r.body).toMatchObject({ ok: false, field })
    }
    expect(h.writes).toHaveLength(0)
  })
})

describe('R-149 /api/v1/crm/connections', () => {
  it('the IntegrationsPanel / pulse bodies pass', async () => {
    const r = await connections.POST(req('POST', { provider: 'amocrm', base_url: 'acme.amocrm.ru', access_token: 'tok' }))
    expect(r.status).toBe(200)
    expect(h.tested).toBe(1)
  })

  it('a bad body keeps its 422 (a non-string token used to crash with 500), no CRM call', async () => {
    for (const bad of [
      { provider: 'salesforce', base_url: 'x', access_token: 't' },
      { provider: 'amocrm', base_url: 'x' },
      { provider: 'amocrm', base_url: 'x', access_token: 42 },
      { provider: 'amocrm', base_url: 'x', access_token: 't', user_id: 'u-2' },
      { provider: 'amocrm', base_url: 'x'.repeat(501), access_token: 't' },
    ]) {
      const r = await out(await connections.POST(req('POST', bad)))
      expect(r.status, JSON.stringify(bad)).toBe(422)
      expect(r.body.ok).toBe(false)
    }
    expect(h.tested).toBe(0)
    expect(h.writes).toHaveLength(0)
  })
})

describe('lib/validation/http', () => {
  it('a strict schema names the first unknown key; messages are Russian', () => {
    const S = z.object({ a: z.string().max(3) }).strict()
    const bad = parseBody({ a: 'x', b: 1 }, S)
    expect(bad.ok).toBe(false)
    const tooLong = S.safeParse({ a: 'xxxx' })
    expect(tooLong.success).toBe(false)
    if (!tooLong.success) expect(describeIssue(tooLong.error.issues[0])).toEqual({ message: 'Поле «a»: не длиннее 3 символов', field: 'a' })
  })

  it('an oversized body is a 413 before parsing', async () => {
    const r = await readJsonBody(req('POST', { a: 'x'.repeat(100) }), { maxBytes: 50 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(413)
  })
})

describe('R-149 schemas: /api/checkout and /api/v1/point-b/finmodel', () => {
  it('checkout: { planKey } (CheckoutButton) passes; junk is refused', () => {
    expect(CheckoutBody.safeParse({ planKey: 'pilot' }).success).toBe(true)
    expect(CheckoutBody.safeParse({ planKey: 'pro', provider: 'kaspi' }).success).toBe(true)
    for (const bad of [{}, { planKey: '' }, { planKey: 5 }, { planKey: 'x'.repeat(65) }, { planKey: 'pro', amount: 1 }, { planKey: 'pro', orgId: 'o' }, null]) {
      expect(CheckoutBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('finmodel: the controller body passes, top-level extras are dropped, item extras / shape junk are refused', () => {
    const ok = FinmodelPutBody.safeParse({ values: [{ key: 'cash_balance', value: 1, note: 'по выписке' }], companyId: 'c-2' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data).not.toHaveProperty('companyId')
    // The value itself is the store's (invalid_value with the field), not the shape's.
    expect(FinmodelPutBody.safeParse({ values: [{ key: 'cash_balance', value: '5 млн' }] }).success).toBe(true)
    for (const bad of [
      { values: [] },
      { values: [{ key: 'cash_balance', value: 1, company_id: 'c-2' }] },
      { values: [{ key: 'cash_balance', value: 1, note: 'x'.repeat(2001) }] },
      { values: [{ key: 'x'.repeat(101), value: 1 }] },
      { values: Array.from({ length: 21 }, () => ({ key: 'cash_balance', value: 1 })) },
    ]) {
      expect(FinmodelPutBody.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false)
    }
  })
})
