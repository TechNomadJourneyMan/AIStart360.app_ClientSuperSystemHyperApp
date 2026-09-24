/**
 * Кто попадает в ГИГА-панель. Правило из ветки whatsapp-ai-production (только
 * одобренный аккаунт) сохранено и распространено на роли персонала из
 * staff_roles, которые появились вместе с RBAC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as null | { role?: string; status?: string },
  staff: null as null | { role?: string },
}))
const gigaCookie = vi.hoisted(() => ({ verify: vi.fn() }))

function table(name: string) {
  const row = name === 'profiles' ? db.profile : db.staff
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }
}

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: db.getUser }, from: table }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: table }) }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))

import { getGigaActor } from '@/lib/admin/giga-actor'

function request(cookie?: string) {
  return new NextRequest('http://localhost/api/giga-admin/test', {
    headers: cookie ? { cookie: `aistart360_giga=${cookie}` } : undefined,
  })
}

describe('getGigaActor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.profile = null
    db.staff = null
    gigaCookie.verify.mockReturnValue(null)
  })

  it('accepts an approved personal super_admin session', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } } })
    db.profile = { role: 'super_admin', status: 'approved' }

    const actor = await getGigaActor(request())
    expect(actor).toMatchObject({ id: 'admin-1', kind: 'session', email: 'admin@example.com', role: 'super_admin' })
    expect(actor?.permissions).toContain('settings.manage')
  })

  it('accepts an approved staff member by their staff_roles row', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'support-1', email: 'support@example.com' } } })
    db.profile = { role: 'client', status: 'approved' }
    db.staff = { role: 'support' }

    const actor = await getGigaActor(request())
    expect(actor).toMatchObject({ id: 'support-1', kind: 'session', role: 'support' })
    // Роль поддержки не даёт настройки платформы.
    expect(actor?.permissions).not.toContain('settings.manage')
  })

  it.each(['pending_approval', 'rejected', 'blocked', 'archived'])(
    'rejects a personal super_admin whose status is %s',
    async (status) => {
      db.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } } })
      db.profile = { role: 'super_admin', status }

      await expect(getGigaActor(request())).resolves.toBeNull()
    },
  )

  it('rejects a staff member whose account is not approved yet', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'support-1', email: 'support@example.com' } } })
    db.profile = { role: 'client', status: 'pending_approval' }
    db.staff = { role: 'support' }

    await expect(getGigaActor(request())).resolves.toBeNull()
  })

  it('rejects an approved session without any staff role', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'client-1', email: 'client@example.com' } } })
    db.profile = { role: 'client', status: 'approved' }

    await expect(getGigaActor(request())).resolves.toBeNull()
  })

  it('ignores the old break-glass cookie: no personal session — no access', async () => {
    db.getUser.mockResolvedValue({ data: { user: null } })
    gigaCookie.verify.mockReturnValue('super_admin')

    await expect(getGigaActor(request('signed-token'))).resolves.toBeNull()
  })
})
