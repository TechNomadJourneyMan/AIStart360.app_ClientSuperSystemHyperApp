/**
 * GIGA-CRM «Шаблоны Точки А» (/api/giga-admin/point-a/templates, right
 * pointa.templates): validation, duplicate keys, the protected default
 * template and the recalculation of every company the change touches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { BLOCK_KEYS, CODE_TEMPLATES } from '@/lib/point-a/v4/config'
import { companiesAffectedByTemplate, templateUsage } from '@/lib/point-a/template-impact'
import { fakeClient, newFakeDb, type FakeDb } from './_fake-supabase'

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  db: null as unknown as FakeDb,
  audits: [] as string[],
  recalc: vi.fn(async (_id: string, _reason: string) => true),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'session', role: h.role as StaffRole })) }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient(h.db) }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: { action: string }) => { h.audits.push(e.action); return true } }))
vi.mock('@/lib/point-a/recalc-queue', () => ({ requestPointARecalc: h.recalc }))

const list = await import('@/app/api/giga-admin/point-a/templates/route')
const one = await import('@/app/api/giga-admin/point-a/templates/[key]/route')

const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/giga-admin/point-a/templates${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
const blocks = (w: Partial<Record<(typeof BLOCK_KEYS)[number], number>> = {}) =>
  BLOCK_KEYS.map((k) => ({ key: k, weight: w[k] ?? 0.1, enabled: (w[k] ?? 0.1) > 0 }))
const tplRow = (t: (typeof CODE_TEMPLATES)[number]) => ({ key: t.key, title: t.title, industries: [...t.industries], blocks: t.blocks.map((b) => ({ ...b })), version: 1 })

beforeEach(() => {
  h.role = 'admin'
  h.db = newFakeDb()
  h.db.tables = {
    pa_templates: CODE_TEMPLATES.map(tplRow),
    companies: [
      { id: 'c-shop', industry: 'Интернет-магазин одежды' },  // ecommerce by industry
      { id: 'c-explicit', industry: 'Завод ЖБИ' },           // explicitly ecommerce
      { id: 'c-plant', industry: 'Завод металлоконструкций' }, // production by industry
      { id: 'c-services', industry: 'Интернет-реклама' },      // explicitly services
      { id: 'c-none', industry: null },                      // default
    ],
    pa_company_config: [
      { company_id: 'c-explicit', template_key: 'ecommerce' },
      { company_id: 'c-services', template_key: 'services' },
    ],
  }
  h.audits = []
  h.recalc.mockClear()
})

describe('permission pointa.templates', () => {
  it('only admin / super_admin; others get 403 before any read', async () => {
    for (const role of ['super_expert', 'crm_manager', 'analyst', 'support', 'content_manager']) {
      h.role = role
      expect((await list.GET(req('', 'GET'))).status, role).toBe(403)
      expect((await list.POST(req('', 'POST', { key: 'horeca', title: 'HoReCa', industries: [], blocks: blocks() }))).status, role).toBe(403)
      expect((await one.DELETE(req('/ecommerce', 'DELETE'), { params: { key: 'ecommerce' } })).status, role).toBe(403)
    }
    expect(h.db.writes).toEqual([])
    h.role = 'super_admin'
    expect((await list.GET(req('', 'GET'))).status).toBe(200)
  })

  it('GET lists templates (default first) with usage and the 7-block library', async () => {
    const body = await (await list.GET(req('', 'GET'))).json()
    expect(body.data.templates[0].key).toBe('default')
    expect(body.data.library).toHaveLength(7)
    expect(body.data.library[0].metrics[0]).toHaveProperty('label')
    const eco = body.data.templates.find((t: { key: string }) => t.key === 'ecommerce')
    expect(eco.usage).toEqual({ explicit: 1, auto: 1 })
  })
})

describe('create', () => {
  it('validates key, blocks and weights', async () => {
    const bad = [
      { key: 'Bad Key', title: 'HoReCa', blocks: blocks() },
      { key: 'horeca', title: 'HoReCa', blocks: blocks().slice(0, 6) },
      { key: 'horeca', title: 'HoReCa', blocks: blocks({ finance: 1.5 }) },
      { key: 'horeca', title: 'HoReCa', blocks: BLOCK_KEYS.map((k) => ({ key: k, weight: 0, enabled: true })) },
      { key: 'horeca', title: 'HoReCa', blocks: [...blocks().slice(0, 6), { key: 'finance', weight: 0.1, enabled: true }] },
      { key: 'horeca', title: 'HoReCa', blocks: blocks(), industries: Array.from({ length: 21 }, (_, i) => `отрасль${i}`) },
    ]
    for (const b of bad) expect((await list.POST(req('', 'POST', b))).status, JSON.stringify(b).slice(0, 60)).toBe(400)
    expect(h.db.writes).toEqual([])
  })

  it('409 on a duplicate key', async () => {
    expect((await list.POST(req('', 'POST', { key: 'ecommerce', title: 'Дубль', blocks: blocks() }))).status).toBe(409)
    expect(h.db.writes).toEqual([])
  })

  it('creates with lower-cased industries and recalculates companies it captures', async () => {
    const res = await list.POST(req('', 'POST', { key: 'metal', title: 'Металл', industries: ['МЕТАЛЛ', 'металл'], blocks: blocks({ finance: 0.5 }) }))
    expect(res.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'pa_templates')!
    expect(w.payload).toMatchObject({ key: 'metal', industries: ['металл'], version: 1 })
    expect((w.payload as { blocks: Array<{ key: string }> }).blocks.map((b) => b.key)).toEqual([...BLOCK_KEYS])
    // «Завод металлоконструкций»: «металл» (6 chars) is more specific than «завод» — the company moves to
    // the new template and is recalculated; nothing else matches «металл».
    expect(h.recalc.mock.calls.map((c) => c[0])).toEqual(['c-plant'])
    expect(h.audits).toEqual(['point_a.template_created'])
  })
})

describe('update', () => {
  it('bumps the version and recalculates every company using the template before or after', async () => {
    const res = await one.PUT(req('/ecommerce', 'PUT', { title: 'E-commerce', industries: ['интернет-магазин', 'завод'], blocks: blocks({ marketing: 0.3 }) }), { params: { key: 'ecommerce' } })
    expect(res.status).toBe(200)
    const w = h.db.writes.find((x) => x.table === 'pa_templates')!
    expect(w).toMatchObject({ op: 'update', payload: { version: 2, updated_by: 'aaaaaaaa-0000-4000-8000-000000000001' } })
    const ids = h.recalc.mock.calls.map((c) => c[0]).sort()
    // shop: by industry; explicit: names it; plant: now matches «завод» (ecommerce precedes production).
    expect(ids).toEqual(['c-explicit', 'c-plant', 'c-shop'])
    expect(h.recalc.mock.calls.every((c) => c[1] === 'template_changed')).toBe(true)
    expect((await res.json()).data.recalc).toMatchObject({ affected: 3, queued: 3 })
  })

  it('404 for an unknown template', async () => {
    expect((await one.PUT(req('/nope', 'PUT', { title: 'X y', blocks: blocks() }), { params: { key: 'nope' } })).status).toBe(404)
  })
})

describe('delete', () => {
  it('refuses the default template', async () => {
    expect((await one.DELETE(req('/default', 'DELETE'), { params: { key: 'default' } })).status).toBe(400)
    expect(h.db.writes).toEqual([])
  })

  it('deletes and recalculates its companies (explicit ones fall back to their industry)', async () => {
    const res = await one.DELETE(req('/ecommerce', 'DELETE'), { params: { key: 'ecommerce' } })
    expect(res.status).toBe(200)
    expect(h.recalc.mock.calls.map((c) => c[0]).sort()).toEqual(['c-explicit', 'c-shop'])
    expect(h.audits).toEqual(['point_a.template_deleted'])
  })
})

describe('companiesAffectedByTemplate / templateUsage', () => {
  const companies = [
    { id: 'a', industry: 'розница', templateKey: null },
    { id: 'b', industry: 'консалтинг', templateKey: null },
    { id: 'c', industry: null, templateKey: 'ecommerce' },
    { id: 'd', industry: 'розница', templateKey: 'gone' },
  ]
  it('explicit users, industry matches before/after, and stale explicit keys', () => {
    const before = [...CODE_TEMPLATES]
    const after = before.filter((t) => t.key !== 'ecommerce')
    expect(companiesAffectedByTemplate(companies, 'ecommerce', before, after).sort()).toEqual(['a', 'c', 'd'])
    expect(companiesAffectedByTemplate(companies, 'services', before, before)).toEqual(['b'])
  })
  it('counts usage', () => {
    expect(templateUsage(companies, CODE_TEMPLATES)).toMatchObject({ ecommerce: { explicit: 1, auto: 2 }, services: { explicit: 0, auto: 1 } })
  })
})
