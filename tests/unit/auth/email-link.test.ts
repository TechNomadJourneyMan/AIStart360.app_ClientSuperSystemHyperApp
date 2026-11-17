/**
 * Вход и восстановление пароля по нашей собственной ссылке: Supabase подменяет
 * адрес возврата своим Site URL, поэтому токен создаётся служебным ключом,
 * а письмо с ссылкой на наш /auth/verify отправляем мы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  link: { data: { properties: { hashed_token: 'hash-123' } }, error: null } as unknown,
  sent: [] as Array<{ to: string; subject: string; ctaUrl?: string }>,
  limited: false,
  sendResult: undefined as unknown,
  account: true,
  bg: [] as Array<Promise<unknown>>,
  ipKeys: [] as string[],
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { generateLink: async () => s.link } },
    // R4 B3: the link (generateLink creates a GoTrue user for an unknown address)
    // is made only for an existing account — the profile lookup answers here.
    from: () => {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q, ilike: () => q, limit: () => q,
        maybeSingle: async () => ({ data: s.account ? { id: 'u-1' } : null, error: null }),
      })
      return q
    },
  }),
}))
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: async (o: { to: string; subject: string; ctaUrl?: string }) => { s.sent.push(o); return s.sendResult },
}))
// Review W3A-4: the per-address limit by the trusted client IP (checkRateLimitForRequest), the e-mail one by the address.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ limited: s.limited }),
  checkRateLimitForRequest: async (req: Request) => { s.ipKeys.push(req.headers.get('x-real-ip') ?? ''); return { limited: s.limited } },
}))
// Review W3A-4: the lookup, the link and the letter go after the answer.
vi.mock('@/lib/background', () => ({ runInBackground: (_l: string, work: () => Promise<unknown>) => { const p = work(); s.bg.push(p); return p } }))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://portal.aistart360.app' }))

const { POST } = await import('@/app/api/v1/auth/email-link/route')

const post = async (body: unknown) => {
  const res = await POST(new NextRequest('http://localhost/api/v1/auth/email-link', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  await Promise.all(s.bg.splice(0))
  return res
}

beforeEach(() => {
  s.link = { data: { properties: { hashed_token: 'hash-123' } }, error: null }
  s.sent = []
  s.limited = false
  s.sendResult = { data: { id: 'msg-1' }, error: null }
  s.account = true
  s.bg = []
  s.ipKeys = []
})

describe('POST /api/v1/auth/email-link', () => {
  it('шлёт ссылку на НАШ домен, а не на Site URL из Supabase', async () => {
    const res = await post({ email: 'user@example.com', purpose: 'login' })
    expect(res.status).toBe(200)
    expect(s.sent).toHaveLength(1)
    const url = new URL(s.sent[0].ctaUrl as string)
    expect(url.origin).toBe('https://portal.aistart360.app')
    expect(url.pathname).toBe('/auth/verify')
    expect(url.searchParams.get('token_hash')).toBe('hash-123')
    expect(url.searchParams.get('type')).toBe('magiclink')
  })

  it('для восстановления ведёт на страницу смены пароля', async () => {
    await post({ email: 'user@example.com', purpose: 'recovery' })
    const url = new URL(s.sent[0].ctaUrl as string)
    expect(url.searchParams.get('type')).toBe('recovery')
    expect(url.searchParams.get('next')).toBe('/auth/reset-password')
  })

  it('не позволяет увести пользователя на чужой сайт через next', async () => {
    await post({ email: 'user@example.com', purpose: 'login', next: 'https://evil.example/steal' })
    const url = new URL(s.sent[0].ctaUrl as string)
    // R-029: the fallback is the cabinet by role (/login → middleware), not the old /dashboard
    expect(url.searchParams.get('next')).toBe('/login')
  })

  it('R-029: без адреса возврата ссылка ведёт в кабинет по роли, а не в старый /dashboard', async () => {
    await post({ email: 'user@example.com', purpose: 'login' })
    expect(new URL(s.sent[0].ctaUrl as string).searchParams.get('next')).toBe('/login')
    await post({ email: 'user@example.com', purpose: 'login', next: '/client/point-b' })
    expect(new URL(s.sent[1].ctaUrl as string).searchParams.get('next')).toBe('/client/point-b')
  })

  it('не раскрывает, существует ли аккаунт', async () => {
    s.link = { data: null, error: { message: 'User not found' } }
    const res = await post({ email: 'nobody@example.com', purpose: 'login' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(s.sent).toHaveLength(0)
  })

  it('ограничивает частоту запросов', async () => {
    s.limited = true
    const res = await post({ email: 'user@example.com', purpose: 'login' })
    expect(res.status).toBe(429)
    expect(s.sent).toHaveLength(0)
  })

  it('отвергает некорректный email', async () => {
    expect((await post({ email: 'не-почта' })).status).toBe(422)
  })

  it('недоставленное письмо видно в логах (без ссылки), ответ тот же', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    s.sendResult = { data: null, error: { message: 'The aistart360.app domain is not verified' } }
    const res = await post({ email: 'user@example.com', purpose: 'recovery' })
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalled()
    const logged = spy.mock.calls.flat().join(' ')
    expect(logged).toMatch(/not verified/)
    expect(logged).not.toMatch(/hash-123/)
    spy.mockRestore()
  })

  it('W3A-4: ответ одинаков и приходит до поиска аккаунта и письма — время не выдаёт, есть ли адрес', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    s.link = gate.then(() => ({ data: { properties: { hashed_token: 'hash-123' } }, error: null }))
    const known = await POST(new NextRequest('http://localhost/api/v1/auth/email-link', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'user@example.com', purpose: 'login' }),
    }))
    // GoTrue has not answered yet, the letter is not sent — the answer is already here.
    expect(known.status).toBe(200)
    expect(s.sent).toHaveLength(0)
    s.account = false
    const unknown = await POST(new NextRequest('http://localhost/api/v1/auth/email-link', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', purpose: 'login' }),
    }))
    const [a, b] = [await known.json(), await unknown.json()]
    expect(a).toEqual(b)
    expect(a.message).toContain('Если аккаунт с таким адресом существует')
    release()
    await Promise.all(s.bg.splice(0))
    expect(s.sent).toHaveLength(1)
  })

  it('W3A-4: ограничение по адресу — через доверенный IP (тот же помощник, что у «Запросить приглашение»)', async () => {
    await POST(new NextRequest('http://localhost/api/v1/auth/email-link', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ email: 'user@example.com' }),
    }))
    expect(s.ipKeys).toEqual(['203.0.113.7'])
  })
})
