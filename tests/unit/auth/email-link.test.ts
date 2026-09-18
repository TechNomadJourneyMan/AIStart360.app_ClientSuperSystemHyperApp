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
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ auth: { admin: { generateLink: async () => s.link } } }),
}))
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: async (o: { to: string; subject: string; ctaUrl?: string }) => { s.sent.push(o) },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => s.limited }))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://portal.aistart360.app' }))

const { POST } = await import('@/app/api/v1/auth/email-link/route')

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/v1/auth/email-link', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  s.link = { data: { properties: { hashed_token: 'hash-123' } }, error: null }
  s.sent = []
  s.limited = false
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
    expect(url.searchParams.get('next')).toBe('/dashboard')
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
})
