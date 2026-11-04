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
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ auth: { admin: { generateLink: async () => s.link } } }),
}))
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: async (o: { to: string; subject: string; ctaUrl?: string }) => { s.sent.push(o); return s.sendResult },
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
  s.sendResult = { data: { id: 'msg-1' }, error: null }
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

  it('сбой отправки письма пишется в журнал (без адреса и ссылки), а ответ прежний', async () => {
    s.sendResult = { data: null, error: { message: 'The gmail.com domain is not verified' } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ email: 'user@example.com', purpose: 'recovery' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const logged = String(spy.mock.calls[0][0])
    expect(logged).toContain('delivery failed')
    expect(logged).not.toContain('user@example.com')
    expect(logged).not.toContain('hash-123')
    spy.mockRestore()
  })

  it('нет ключа Resend ({ error: string }) — тоже в журнал', async () => {
    s.sendResult = { error: 'RESEND_API_KEY is missing' }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post({ email: 'user@example.com', purpose: 'recovery' })).status).toBe(200)
    expect(String(spy.mock.calls[0][0])).toContain('RESEND_API_KEY is missing')
    spy.mockRestore()
  })

  it('каждый запрос получает свой ответ (тело не «использовано» вторым запросом)', async () => {
    const a = await post({ email: 'a@example.com', purpose: 'recovery' })
    const b = await post({ email: 'b@example.com', purpose: 'recovery' })
    expect((await a.json()).ok).toBe(true)
    expect((await b.json()).ok).toBe(true)
  })
})
