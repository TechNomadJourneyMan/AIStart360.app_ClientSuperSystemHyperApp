/**
 * Приглашения на платформу: письмо со ссылкой на НАШ домен (Site URL в Supabase
 * указывает на посторонний адрес), права, разбор списка адресов и аудит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  role: 'super_admin' as string,
  existingEmails: [] as string[],
  link: { data: { properties: { hashed_token: 'hash-1' } }, error: null } as unknown,
  sent: [] as Array<{ to: string; subject: string; ctaUrl?: string; body: string }>,
  audits: [] as Array<{ action: string; entityId?: string }>,
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
  sendNotificationEmail: async (o: { to: string; subject: string; ctaUrl?: string; body: string }) => { s.sent.push(o) },
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://portal.aistart360.app' }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { generateLink: async () => s.link } },
    from: () => ({
      select: () => ({
        ilike: (_c: string, email: string) => ({
          maybeSingle: async () => ({ data: s.existingEmails.includes(email) ? { id: 'u-1' } : null }),
        }),
      }),
    }),
  }),
}))

const { POST } = await import('@/app/api/giga-admin/invites/route')
const { parseEmailList } = await import('@/lib/admin/invites')

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/giga-admin/invites', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  s.role = 'super_admin'
  s.existingEmails = []
  s.link = { data: { properties: { hashed_token: 'hash-1' } }, error: null }
  s.sent = []
  s.audits = []
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
    const url = new URL(s.sent[0].ctaUrl as string)
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
    const url = new URL(s.sent[0].ctaUrl as string)
    expect(url.searchParams.get('type')).toBe('magiclink')
    expect(url.searchParams.get('next')).toBe('/dashboard')
  })

  it('кладёт сообщение пригласившего в письмо', async () => {
    await post({ emails: ['new@company.kz'], note: 'Встреча в четверг' })
    expect(s.sent[0].body).toContain('Встреча в четверг')
    expect(s.sent[0].body).toContain('admin@aistart360.app')
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

  it('требует право на управление пользователями', async () => {
    for (const role of ['analyst', 'support', 'content_manager']) {
      s.role = role
      expect((await post({ emails: ['a@x.io'] })).status, role).toBe(403)
    }
    expect(s.sent).toHaveLength(0)
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
    const url = new URL(s.sent[0].ctaUrl as string)
    expect(url.searchParams.get('next')).toBe('/auth/reset-password')
  })
})
