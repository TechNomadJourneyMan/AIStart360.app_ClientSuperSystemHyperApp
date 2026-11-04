/**
 * Ссылка из письма: GET /auth/verify токен не тратит (почтовые сканеры), а
 * ведёт на /auth/confirm; токен меняется на сессию только POST-ом формы с нашей
 * же страницы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  verifyCalls: [] as Array<{ type: string; token_hash: string }>,
  verifyResult: { data: { user: { id: 'u1', email: 'a@b.c' } }, error: null } as unknown,
  accepted: [] as Array<string | undefined>,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: Array<{ name: string; value: string; options?: object }>) => void } }) => ({
    auth: {
      verifyOtp: async (args: { type: string; token_hash: string }) => {
        s.verifyCalls.push(args)
        const r = s.verifyResult as { error: unknown }
        if (!r.error) opts.cookies.setAll([{ name: 'sb-ref-auth-token', value: 'session', options: { path: '/' } }])
        return s.verifyResult
      },
    },
  }),
}))
vi.mock('@/lib/admin/invites', () => ({ acceptInvitation: async (email?: string) => { s.accepted.push(email) } }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => {} }))

const { GET, POST } = await import('@/app/auth/verify/route')
const { parseEmailLinkParams } = await import('@/app/auth/verify/link-params')

const post = (fields: Record<string, string>, headers: Record<string, string> = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }) => {
  const body = new URLSearchParams(fields).toString()
  return POST(new NextRequest('http://localhost/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'localhost', ...headers },
    body,
  }))
}
const loc = (r: Response) => r.headers.get('location') ?? ''

beforeEach(() => {
  s.verifyCalls = []
  s.accepted = []
  s.verifyResult = { data: { user: { id: 'u1', email: 'a@b.c' } }, error: null }
})

describe('GET /auth/verify', () => {
  it('не тратит токен, а ведёт на страницу подтверждения с теми же параметрами', async () => {
    const r = await GET(new NextRequest('http://localhost/auth/verify?token_hash=abc123&type=recovery&next=%2Fauth%2Freset-password'))
    expect(s.verifyCalls).toHaveLength(0)
    const url = new URL(loc(r))
    expect(url.pathname).toBe('/auth/confirm')
    expect(url.searchParams.get('token_hash')).toBe('abc123')
    expect(url.searchParams.get('type')).toBe('recovery')
    expect(url.searchParams.get('next')).toBe('/auth/reset-password')
  })

  it('чужой next заменяется безопасным по умолчанию', async () => {
    const r = await GET(new NextRequest('http://localhost/auth/verify?token_hash=abc&type=recovery&next=https%3A%2F%2Fevil.example'))
    expect(new URL(loc(r)).searchParams.get('next')).toBe('/auth/reset-password')
    const r2 = await GET(new NextRequest('http://localhost/auth/verify?token_hash=abc&next=%2F%2Fevil.example'))
    expect(new URL(loc(r2)).searchParams.get('next')).toBe('/dashboard')
  })

  it('без токена — на /login с понятной ошибкой', async () => {
    const r = await GET(new NextRequest('http://localhost/auth/verify?type=recovery'))
    expect(loc(r)).toContain('/login?error=link_invalid')
  })
})

describe('POST /auth/verify (кнопка «Продолжить»)', () => {
  it('меняет токен на сессию и ведёт на next (303), ставя cookie сессии', async () => {
    const r = await post({ token_hash: 'abc123', type: 'recovery', next: '/auth/reset-password' })
    expect(r.status).toBe(303)
    expect(new URL(loc(r)).pathname).toBe('/auth/reset-password')
    expect(s.verifyCalls).toEqual([{ type: 'recovery', token_hash: 'abc123' }])
    expect(r.headers.get('set-cookie')).toContain('sb-ref-auth-token=session')
    expect(s.accepted).toEqual(['a@b.c'])
  })

  it('устаревший токен — /login?error=link_expired', async () => {
    s.verifyResult = { data: { user: null }, error: { message: 'Token has expired or is invalid' } }
    const r = await post({ token_hash: 'abc123', type: 'recovery', next: '/auth/reset-password' })
    expect(r.status).toBe(303)
    expect(loc(r)).toContain('/login?error=link_expired')
  })

  it('не принимает форму с чужого сайта (login CSRF)', async () => {
    const r1 = await post({ token_hash: 'abc', type: 'magiclink' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
    expect(loc(r1)).toContain('/login?error=link_invalid')
    const r2 = await post({ token_hash: 'abc', type: 'magiclink' }, { origin: 'https://evil.example' })
    expect(loc(r2)).toContain('/login?error=link_invalid')
    const r3 = await post({ token_hash: 'abc', type: 'magiclink' }, { origin: 'null' })
    expect(loc(r3)).toContain('/login?error=link_invalid')
    expect(s.verifyCalls).toHaveLength(0)
  })

  it('next из формы тоже проходит проверку на свой домен', async () => {
    const r = await post({ token_hash: 'abc', type: 'magiclink', next: 'https://evil.example/x' })
    expect(new URL(loc(r)).origin).toBe('http://localhost')
    expect(new URL(loc(r)).pathname).toBe('/dashboard')
  })

  it('без токена — ошибка без обращения к Supabase', async () => {
    const r = await post({ type: 'recovery' })
    expect(loc(r)).toContain('/login?error=link_invalid')
    expect(s.verifyCalls).toHaveLength(0)
  })
})

describe('parseEmailLinkParams', () => {
  const parse = (q: string) => { const p = new URLSearchParams(q); return parseEmailLinkParams((k) => p.get(k)) }
  it('тип по умолчанию — magiclink, приглашение и восстановление ведут на смену пароля', () => {
    expect(parse('token_hash=a').type).toBe('magiclink')
    expect(parse('token_hash=a&type=invite').next).toBe('/auth/reset-password')
    expect(parse('token_hash=a&type=recovery').next).toBe('/auth/reset-password')
    expect(parse('token_hash=a&type=signup').type).toBe('magiclink')
  })
  it('мусор вместо токена не считается ссылкой', () => {
    expect(parse('token_hash=%3Cscript%3E').tokenHash).toBeNull()
    expect(parse('').tokenHash).toBeNull()
  })
})
