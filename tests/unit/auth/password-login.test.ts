import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  signIn: vi.fn(),
  createClient: vi.fn(),
  rateLimit: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    s.createClient(...args)
    return { auth: { signInWithPassword: s.signIn } }
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  clientIp: () => 'test-ip',
  checkRateLimit: (...args: unknown[]) => s.rateLimit(...args),
}))

import { POST } from '@/app/api/auth/password/route'

function post(body: unknown = { email: 'client@example.kz', password: 'wrong' }, headers: Record<string, string> = {}) {
  return POST(new Request('https://portal.aistart360.app/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key')
  vi.stubEnv('AUTH_URL', '')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  s.rateLimit.mockResolvedValue({ limited: false })
  s.signIn.mockResolvedValue({
    data: { user: null, session: null },
    error: { status: 400, message: 'Invalid login credentials' },
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('password login adapter', () => {
  it('returns a Russian managed refusal for GoTrue 400, with no tokens and no cache', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const result = await response.json()
    expect(result).toEqual({
      ok: false, code: 'authentication_failed',
      error: expect.stringContaining('Неверный адрес почты или пароль'),
    })
    expect(result).not.toHaveProperty('session')
    expect(s.signIn).toHaveBeenCalledWith({ email: 'client@example.kz', password: 'wrong' })
  })

  it('returns only the verified session pair after real password authentication', async () => {
    s.signIn.mockResolvedValue({
      error: null,
      data: {
        user: { id: 'verified-user', app_metadata: { private: 'keep-server-side' } },
        session: { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 },
      },
    })
    const response = await post({ email: ' client@example.kz ', password: 'correct' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true, session: { access_token: 'access-token', refresh_token: 'refresh-token' },
    })
    expect(s.signIn).toHaveBeenCalledWith({ email: 'client@example.kz', password: 'correct' })
    expect(s.createClient).toHaveBeenCalledWith(
      'https://test.supabase.co', 'public-anon-key',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
    )
  })

  it('never treats a missing session as authenticated', async () => {
    s.signIn.mockResolvedValue({ error: null, data: { user: { id: 'u' }, session: null } })
    expect(await (await post()).json()).toMatchObject({ ok: false })
  })

  it('keeps both IP and account limits fail-closed and preserves retry delay', async () => {
    s.rateLimit.mockResolvedValueOnce({ limited: false })
      .mockResolvedValueOnce({ limited: true, retryAfterSeconds: 30 })
    const response = await post()
    expect(response.status).toBe(200)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toMatchObject({ ok: false, code: 'rate_limited' })
    expect(s.rateLimit).toHaveBeenNthCalledWith(1, 'test-ip', 'password-login-ip', expect.objectContaining({ failClosed: true }))
    expect(s.rateLimit).toHaveBeenNthCalledWith(2, 'client@example.kz', 'password-login-account', expect.objectContaining({ failClosed: true }))
    expect(s.signIn).not.toHaveBeenCalled()
  })

  it('rejects cross-site login before contacting the provider', async () => {
    const response = await post(undefined, { origin: 'https://other.example', 'sec-fetch-site': 'cross-site' })
    expect(await response.json()).toMatchObject({ ok: false, code: 'invalid_origin' })
    expect(s.signIn).not.toHaveBeenCalled()
    expect(s.rateLimit).not.toHaveBeenCalled()
  })

  it.each(['AUTH_URL', 'NEXT_PUBLIC_APP_URL'])('accepts the configured public %s origin through an internal reverse proxy', async (key) => {
    vi.stubEnv(key, 'http://localhost:3000')
    const response = await POST(new Request('http://localhost:3005/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ email: 'client@example.kz', password: 'wrong' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: false, code: 'authentication_failed' })
    expect(s.signIn).toHaveBeenCalledOnce()
  })

  it('does not authorize an arbitrary forwarded public host', async () => {
    const response = await post(undefined, {
      Origin: 'https://other.example', 'X-Forwarded-Host': 'other.example', 'X-Forwarded-Proto': 'https',
    })
    expect(await response.json()).toMatchObject({ ok: false, code: 'invalid_origin' })
    expect(s.signIn).not.toHaveBeenCalled()
  })

  it('validates input without enforcing new-registration password length', async () => {
    expect(await (await post({ email: 'not-mail', password: 'x' })).json())
      .toMatchObject({ ok: false, code: 'invalid_input' })
    expect(s.signIn).not.toHaveBeenCalled()
    await post({ email: 'legacy@example.kz', password: 'x' })
    expect(s.signIn).toHaveBeenCalledOnce()
  })

  it('does not expose a provider exception or manufacture a session', async () => {
    s.signIn.mockRejectedValue(new Error('Internal provider failure with private data'))
    const response = await post()
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('Нет связи с сервером')
    expect(body).not.toContain('private data')
    expect(body).not.toContain('access_token')
  })
})
