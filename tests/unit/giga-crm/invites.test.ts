/**
 * Приглашения на платформу: письмо со ссылкой на НАШ домен (Site URL в Supabase
 * указывает на посторонний адрес), права, роль в приглашении, разбор списка
 * адресов, запись приглашения и аудит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  role: 'super_admin' as string,
  existingEmails: [] as string[],
  link: { data: { properties: { hashed_token: 'hash-1' } }, error: null } as unknown,
  sent: [] as Array<{ to: string; input: Record<string, unknown> }>,
  audits: [] as Array<{ action: string; entityId?: string; metadata?: Record<string, unknown> }>,
  invitations: [] as Array<Record<string, unknown>>,
  limited: false,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: s.role as StaffRole, email: 'admin@aistart360.app' })) }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, entry: { action: string; entityId?: string }) => { s.audits.push(entry); return true },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => s.limited }))
vi.mock('@/lib/email', () => ({
  sendPortalInvitationEmail: async (to: string, input: Record<string, unknown>) => {
    s.sent.push({ to, input })
    return { ok: true }
  },
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://portal.aistart360.app' }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { generateLink: async () => s.link } },
    from: (table: string) => {
      if (table === 'platform_invitations') {
        return {
          insert: (row: Record<string, unknown>) => {
            s.invitations.push(row)
            return { select: () => ({ single: async () => ({ data: { id: `inv-${s.invitations.length}` }, error: null }) }) }
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      return {
        select: () => ({
          ilike: (_c: string, email: string) => ({
            maybeSingle: async () => ({ data: s.existingEmails.includes(email) ? { id: 'u-1', full_name: 'Иван' } : null }),
          }),
        }),
      }
    },
  }),
}))

const { POST } = await import('@/app/api/giga-admin/invites/route')
const { parseEmailList } = await import('@/lib/admin/invite-shared')

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/giga-admin/invites', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  s.role = 'super_admin'
  s.existingEmails = []
  s.link = { data: { properties: { hashed_token: 'hash-1' } }, error: null }
  s.sent = []
  s.audits = []
  s.invitations = []
  s.limited = false
})

describe('разбор списка адресов', () => {
  it('принимает запятые, точки с запятой и переводы строк, убирает дубли', () => {
    const { emails, invalid } = parseEmailList('a@x.io, b@x.io;\n a@x.io\n не-почта')
    expect(emails).toEqual(['a@x.io', 'b@x.io'])
    expect(invalid).toEqual(['не-почта'])
  })
})

describe('POST /api/giga-admin/invites', () => {
  it('шлёт ссылку на наш домен и ведёт новичка задавать пароль', async () => {
    const res = await post({ emails: ['new@company.kz'] })
    expect(res.status).toBe(200)
    expect(s.sent).toHaveLength(1)
    const url = new URL(s.sent[0].input.url as string)
    expect(url.origin).toBe('https://portal.aistart360.app')
    expect(url.pathname).toBe('/auth/verify')
    expect(url.searchParams.get('type')).toBe('invite')
    expect(url.searchParams.get('next')).toBe('/auth/reset-password')
  })

  it('существующему аккаунту шлёт ссылку для входа, а не приглашение', async () => {
    s.existingEmails = ['known@company.kz']
    const res = await post({ emails: ['known@company.kz'] })
    const body = await res.json()
    expect(body.results[0].outcome).toBe('relinked')
    expect(s.sent[0].input.existingAccount).toBe(true)
    const url = new URL(s.sent[0].input.url as string)
    expect(url.searchParams.get('type')).toBe('magiclink')
    expect(url.searchParams.get('next')).toBe('/dashboard')
  })

  it('кладёт сообщение пригласившего и компанию в письмо', async () => {
    await post({ emails: ['new@company.kz'], note: 'Встреча в четверг', company: 'ТОО «Пример»' })
    expect(s.sent[0].input.note).toBe('Встреча в четверг')
    expect(s.sent[0].input.invitedByLabel).toBe('admin@aistart360.app')
    expect(s.sent[0].input.company).toBe('ТОО «Пример»')
  })

  it('пишет запись приглашения со сроком действия и без токена', async () => {
    await post({ emails: ['new@company.kz'] })
    expect(s.invitations).toHaveLength(1)
    const row = s.invitations[0]
    expect(row.email).toBe('new@company.kz')
    expect(row.status).toBe('sent')
    expect(new Date(row.expires_at as string).getTime()).toBeGreaterThan(Date.now())
    // Одноразовый токен живёт только в письме — в базе его быть не должно.
    expect(JSON.stringify(row)).not.toContain('hash-1')
  })

  it('пишет каждое приглашение в журнал аудита', async () => {
    await post({ emails: ['a@x.io', 'b@x.io'] })
    expect(s.audits.map((a) => a.action)).toEqual(['user.invited', 'user.invited'])
    expect(s.audits.map((a) => a.entityId)).toEqual(['a@x.io', 'b@x.io'])
  })

  it('не отправляет и не аудирует, если Supabase не дал токен', async () => {
    s.link = { data: null, error: { message: 'User already registered' } }
    const res = await post({ emails: ['new@company.kz'] })
    const body = await res.json()
    expect(body.sent).toBe(0)
    expect(body.results[0].outcome).toBe('failed')
    expect(s.sent).toHaveLength(0)
    expect(s.audits).toHaveLength(0)
  })

  it('требует право на приглашения', async () => {
    for (const role of ['analyst', 'support', 'content_manager']) {
      s.role = role
      expect((await post({ emails: ['a@x.io'] })).status, role).toBe(403)
    }
    expect(s.sent).toHaveLength(0)
  })

  it('SuperExpert может приглашать', async () => {
    s.role = 'super_expert'
    expect((await post({ emails: ['a@x.io'] })).status).toBe(200)
    expect(s.sent).toHaveLength(1)
  })

  it('роль в приглашении выдаёт только тот, кто управляет ролями', async () => {
    s.role = 'super_expert'
    expect((await post({ emails: ['a@x.io'], staffRole: 'super_expert' })).status).toBe(403)
    s.role = 'crm_manager'
    expect((await post({ emails: ['a@x.io'], staffRole: 'super_expert' })).status).toBe(403)
    expect(s.sent).toHaveLength(0)

    s.role = 'super_admin'
    expect((await post({ emails: ['a@x.io'], staffRole: 'super_expert' })).status).toBe(200)
    expect(s.invitations[0].staff_role).toBe('super_expert')
    expect(s.sent[0].input.roleLabel).toBe('SuperExpert')
  })

  it('ограничивает массовую рассылку', async () => {
    s.limited = true
    expect((await post({ emails: ['a@x.io'] })).status).toBe(429)
    expect(s.sent).toHaveLength(0)
  })

  it('не принимает пустой список и больше 25 адресов', async () => {
    expect((await post({ emails: [] })).status).toBe(422)
    expect((await post({ emails: Array.from({ length: 26 }, (_, i) => `u${i}@x.io`) })).status).toBe(422)
  })

  it('не уводит приглашённого на чужой сайт через next', async () => {
    await post({ emails: ['new@company.kz'], next: 'https://evil.example/steal' })
    const url = new URL(s.sent[0].input.url as string)
    expect(url.searchParams.get('next')).toBe('/auth/reset-password')
  })
})
