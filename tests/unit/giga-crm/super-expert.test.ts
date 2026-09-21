/**
 * Роль SuperExpert: что ей можно, что нельзя, и что запрет живёт на сервере.
 *
 * Негативные случаи проверяются на РЕАЛЬНЫХ маршрутах: 403 приходит ДО того,
 * как route коснётся базы (мок createServiceClient бросает исключение).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  ROLE_PERMISSIONS, STAFF_ROLES, STAFF_ROLE_LABELS, canImpersonate, canManageTarget,
  grantableRoles, hasPermission, type StaffRole,
} from '@/lib/admin/rbac'

const state = vi.hoisted(() => ({ role: 'super_expert' as string, touched: 0, impersonationEnabled: true }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'se-1', kind: 'session', role: state.role as StaffRole, email: 'se@aistart360.app' })),
    staffRoleOfUser: async () => { state.touched++; return { staffRole: null, profileRole: 'client', status: 'approved', email: 'c@x.io' } },
    forbidTarget: async () => null,
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => { state.touched++; throw new Error('маршрут не должен дойти до базы') },
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => state.impersonationEnabled }))

const UID = '11111111-2222-3333-4444-555555555555'
const AID = '99999999-8888-4777-8666-555555555555'
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const settings = await import('@/app/api/giga-admin/settings/route')
const staffRole = await import('@/app/api/giga-admin/users/[id]/staff-role/route')
const sections = await import('@/app/api/giga-admin/sections/route')
const archive = await import('@/app/api/giga-admin/users/[id]/archive/route')
const imp = await import('@/app/api/giga-admin/impersonation/route')
const block = await import('@/app/api/giga-admin/users/[id]/block/route')
const gri = await import('@/app/api/giga-admin/users/[id]/gri/[assessmentId]/route')
const purge = await import('@/app/api/giga-admin/system/purge-events/route')
const audit = await import('@/app/api/giga-admin/audit/route')
const content = await import('@/app/api/giga-admin/content/pages/route')

beforeEach(() => { state.role = 'super_expert'; state.touched = 0; state.impersonationEnabled = true })

describe('матрица прав SuperExpert', () => {
  it('роль существует и подписана', () => {
    expect(STAFF_ROLES).toContain('super_expert')
    expect(STAFF_ROLE_LABELS.super_expert).toBe('SuperExpert')
  })

  it('видит людей и их данные', () => {
    for (const p of ['dashboard.view', 'users.view', 'users.sensitive', 'survey.view', 'gri.view', 'activity.view', 'cjm.view', 'analytics.view'] as const) {
      expect(hasPermission('super_expert', p), p).toBe(true)
    }
  })

  it('выполняет разрешённые операционные действия', () => {
    for (const p of ['users.invite', 'users.approve', 'company.edit', 'survey.edit', 'impersonate.view', 'impersonate.edit'] as const) {
      expect(hasPermission('super_expert', p), p).toBe(true)
    }
  })

  it('не получает системных и опасных прав', () => {
    for (const p of [
      'settings.manage', 'roles.manage', 'platform.sections', 'users.manage', 'users.archive',
      'survey.delete', 'gri.edit', 'gri.delete', 'audit.view',
      'content.edit', 'content.publish',
    ] as const) {
      expect(hasPermission('super_expert', p), p).toBe(false)
    }
  })

  it('не может повысить себя: выдавать роли ему нечем', () => {
    expect(grantableRoles('super_expert')).toEqual([])
  })

  it('не имеет прав на сотрудников своего уровня и выше', () => {
    expect(canManageTarget('super_expert', null)).toBe(true)
    expect(canManageTarget('super_expert', 'support')).toBe(true)
    expect(canManageTarget('super_expert', 'super_expert')).toBe(false)
    expect(canManageTarget('super_expert', 'admin')).toBe(false)
    expect(canManageTarget('super_expert', 'super_admin')).toBe(false)
    // И сам он управляем только теми, кто выше.
    expect(canManageTarget('admin', 'super_expert')).toBe(true)
    expect(canManageTarget('crm_manager', 'super_expert')).toBe(false)
  })

  it('открывает кабинет клиента, но не кабинет сотрудника', () => {
    expect(canImpersonate('super_expert', { staffRole: null, profileRole: 'client' })).toBe(true)
    expect(canImpersonate('super_expert', { staffRole: 'support', profileRole: 'client' })).toBe(false)
    expect(canImpersonate('super_expert', { staffRole: null, profileRole: 'admin' })).toBe(false)
  })

  it('это не скрытый Super Admin: набор прав строго меньше', () => {
    const se = ROLE_PERMISSIONS.super_expert
    const sa = ROLE_PERMISSIONS.super_admin
    expect(se.size).toBeLessThan(sa.size)
    for (const p of se) expect(sa.has(p)).toBe(true)
  })
})

describe('запрет живёт на сервере, а не в интерфейсе', () => {
  const forbidden: Array<{ name: string; call: () => Promise<Response> }> = [
    { name: 'системные настройки (чтение)', call: () => settings.GET(req('/api/giga-admin/settings')) },
    { name: 'системные настройки (запись)', call: () => settings.PUT(req('/api/giga-admin/settings', 'PUT', { key: 'maintenance', value: true })) },
    { name: 'выдача ролей', call: () => staffRole.PUT(req(`/api/giga-admin/users/${UID}/staff-role`, 'PUT', { role: 'super_expert', reason: 'проверка' }), { params: { id: UID } }) },
    { name: 'разделы платформы', call: () => sections.PUT(req('/api/giga-admin/sections', 'PUT', { sections: [] })) },
    { name: 'архивация пользователя', call: () => archive.POST(req(`/api/giga-admin/users/${UID}/archive`, 'POST', { action: 'archive', reason: 'x' }), { params: { id: UID } }) },
    { name: 'блокировка пользователя', call: () => block.POST(req(`/api/giga-admin/users/${UID}/block`, 'POST', { reason: 'x' }), { params: { id: UID } }) },
    { name: 'удаление результата GRI', call: () => gri.DELETE(req(`/api/giga-admin/users/${UID}/gri/${AID}`, 'DELETE', { reason: 'x' }), { params: { id: UID, assessmentId: AID } }) },
    { name: 'очистка событий', call: () => purge.POST(req('/api/giga-admin/system/purge-events', 'POST', { days: 1 })) },
    { name: 'журнал аудита', call: () => audit.GET(req('/api/giga-admin/audit')) },
    { name: 'создание страницы контента', call: () => content.POST(req('/api/giga-admin/content/pages', 'POST', { title: 'x', slug: 'x' })) },
  ]

  it('тумблер платформы выключает вход в кабинет клиента', async () => {
    // При включённом тумблере роль проходит дальше проверки прав (до базы,
    // которая в тесте бросает) — значит, отказ даёт именно тумблер, а не RBAC.
    state.impersonationEnabled = false
    const res = await imp.POST(req('/api/giga-admin/impersonation', 'POST', { userId: UID, mode: 'view', reason: 'проверка прав' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('выключен в настройках')
    expect(state.touched).toBe(0)
  })

  for (const c of forbidden) {
    it(`SuperExpert получает 403: ${c.name}`, async () => {
      const res = await c.call()
      expect(res.status, c.name).toBe(403)
      // 403 пришёл ДО обращения к данным.
      expect(state.touched, c.name).toBe(0)
    })
  }
})
