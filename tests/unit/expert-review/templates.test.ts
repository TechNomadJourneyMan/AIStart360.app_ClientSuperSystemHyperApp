/**
 * Шаблоны эксперта (/api/giga-admin/expert-templates): доступ по
 * `clients.review`, поддержка — 403; править может автор, общие — ещё Admin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { hasPermission } from '@/lib/admin/rbac'
import { makeFakeDb, type FakeDb } from './_fake-db'

const ME = '99999999-8888-4777-8666-555555555555'
const COLLEAGUE = '88888888-8888-4777-8666-555555555555'
const T_SHARED = 'bbbbbbbb-0000-4000-8000-000000000001'
const T_PRIVATE = 'bbbbbbbb-0000-4000-8000-000000000002'

const state = vi.hoisted(() => ({ role: 'super_expert' as string, db: null as unknown as FakeDb, audit: [] as string[] }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: state.role as StaffRole })) }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: { action: string }) => { state.audit.push(e.action); return true } }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.db }))

const list = await import('@/app/api/giga-admin/expert-templates/route')
const one = await import('@/app/api/giga-admin/expert-templates/[templateId]/route')

const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

beforeEach(() => {
  state.role = 'super_expert'
  state.audit = []
  state.db = makeFakeDb({
    expert_templates: [
      { id: T_SHARED, block: 'gri:team', title: 'Найм', body: 'Стандарт найма', created_by: COLLEAGUE, is_shared: true, updated_at: '2026-09-01' },
      { id: T_PRIVATE, block: 'general', title: 'Личный', body: 'Мой текст', created_by: COLLEAGUE, is_shared: false, updated_at: '2026-09-01' },
    ],
  })
})

describe('expert templates permissions', () => {
  it('clients.review: SuperExpert/Admin/Super Admin — да, Поддержка/CRM — нет', () => {
    expect(hasPermission('super_expert', 'clients.review')).toBe(true)
    expect(hasPermission('admin', 'clients.review')).toBe(true)
    expect(hasPermission('super_admin', 'clients.review')).toBe(true)
    expect(hasPermission('support', 'clients.review')).toBe(false)
    expect(hasPermission('crm_manager', 'clients.review')).toBe(false)
  })

  it('Поддержка получает 403 на любые операции', async () => {
    state.role = 'support'
    expect((await list.GET(req('/api/giga-admin/expert-templates', 'GET'))).status).toBe(403)
    expect((await list.POST(req('/api/giga-admin/expert-templates', 'POST', { block: 'general', title: 't', body: 'b' }))).status).toBe(403)
    expect((await one.PUT(req(`/api/giga-admin/expert-templates/${T_SHARED}`, 'PUT', { title: 'x' }), { params: { templateId: T_SHARED } })).status).toBe(403)
    expect((await one.DELETE(req(`/api/giga-admin/expert-templates/${T_SHARED}`, 'DELETE'), { params: { templateId: T_SHARED } })).status).toBe(403)
    expect(state.db.tables.expert_templates).toHaveLength(2)
  })

  it('список: общие + свои, фильтр по блоку с универсальными; чужие личные не видны', async () => {
    const res = await list.GET(req('/api/giga-admin/expert-templates?block=gri:team', 'GET'))
    const { data } = await res.json()
    expect(data.map((t: { id: string }) => t.id)).toEqual([T_SHARED])
  })

  it('SuperExpert создаёт шаблон; неизвестный блок — 400', async () => {
    const ok = await list.POST(req('/api/giga-admin/expert-templates', 'POST', { block: 'point-b', title: 'Цель', body: 'Текст' }))
    expect(ok.status).toBe(200)
    expect(state.db.tables.expert_templates).toHaveLength(3)
    expect(state.db.tables.expert_templates[2]).toMatchObject({ created_by: ME, is_shared: true, block: 'point-b' })
    expect(state.audit).toEqual(['expert.template_created'])
    expect((await list.POST(req('/api/giga-admin/expert-templates', 'POST', { block: 'nope', title: 'x', body: 'y' }))).status).toBe(400)
  })

  it('чужой общий шаблон: SuperExpert — 403, Admin — может; чужой личный — 404', async () => {
    const put = () => one.PUT(req(`/api/giga-admin/expert-templates/${T_SHARED}`, 'PUT', { title: 'Новое' }), { params: { templateId: T_SHARED } })
    expect((await put()).status).toBe(403)
    state.role = 'admin'
    expect((await put()).status).toBe(200)
    expect(state.db.tables.expert_templates[0]).toMatchObject({ title: 'Новое' })
    expect((await one.DELETE(req(`/api/giga-admin/expert-templates/${T_PRIVATE}`, 'DELETE'), { params: { templateId: T_PRIVATE } })).status).toBe(404)
  })
})
