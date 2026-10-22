/**
 * POST /api/v1/settings/password — смена пароля вошедшим пользователем.
 *
 * Найдено (W6):
 *  • любой отказ Supabase (слабый пароль, тот же пароль, нужна повторная
 *    авторизация) превращался в «Не удалось сменить пароль» без причины;
 *  • у аккаунта, созданного через Google, пароля нет — форма требовала
 *    «текущий пароль» и всегда отвечала «Неверный текущий пароль», не объясняя,
 *    что делать (так было у аккаунта владельца);
 *  • подбор текущего пароля через этот маршрут ничем не ограничивался.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  user: { id: 'u1', email: 'owner@example.com', identities: [{ provider: 'email' }] } as null | {
    id: string; email?: string; identities?: Array<{ provider: string }>
  },
  signInError: null as null | { message: string },
  updateError: null as null | Record<string, unknown>,
  limited: false,
  updated: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: s.user } }),
      updateUser: async ({ password }: { password: string }) => {
        if (s.updateError) return { data: null, error: s.updateError }
        s.updated.push(password)
        return { data: { user: s.user }, error: null }
      },
    },
  }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => ({ data: {}, error: s.signInError }),
      signOut: async () => ({ error: null }),
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => s.limited }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => {} }))

const { POST } = await import('@/app/api/v1/settings/password/route')
const post = async (body: unknown) => {
  const res = await POST(new Request('http://localhost/api/v1/settings/password', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  s.user = { id: 'u1', email: 'owner@example.com', identities: [{ provider: 'email' }] }
  s.signInError = null
  s.updateError = null
  s.limited = false
  s.updated = []
})

describe('POST /api/v1/settings/password', () => {
  it('меняет пароль после проверки текущего', async () => {
    const r = await post({ current: 'old-pass-1', newPassword: 'new-pass-12' })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(s.updated).toEqual(['new-pass-12'])
  })

  it('без сессии — 401 с русским текстом', async () => {
    s.user = null
    const r = await post({ current: 'a', newPassword: 'new-pass-12' })
    expect(r.status).toBe(401)
    expect(r.json.message).toMatch(/Войдите/)
  })

  it('короткий пароль отклоняется с понятным текстом (то же правило, что в формах)', async () => {
    const r = await post({ current: 'old-pass-1', newPassword: 'short' })
    expect(r.status).toBe(422)
    expect(r.json.message).toMatch(/минимум 8/)
  })

  it('неверный текущий пароль', async () => {
    s.signInError = { message: 'Invalid login credentials' }
    const r = await post({ current: 'wrong', newPassword: 'new-pass-12' })
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('wrong_current_password')
    expect(r.json.oauthOnly).toBe(false)
    expect(s.updated).toEqual([])
  })

  it('аккаунт только через Google: подсказывает задать пароль по ссылке из письма', async () => {
    s.user = { id: 'u1', email: 'owner@example.com', identities: [{ provider: 'google' }] }
    s.signInError = { message: 'Invalid login credentials' }
    const r = await post({ current: 'anything', newPassword: 'new-pass-12' })
    expect(r.json.error).toBe('wrong_current_password')
    expect(r.json.oauthOnly).toBe(true)
    expect(r.json.message).toMatch(/Google/)
  })

  it('слабый пароль по правилам Supabase — причина по-русски', async () => {
    s.updateError = { message: 'Password should contain at least one character of each', code: 'weak_password', status: 422, reasons: ['characters'] }
    const r = await post({ current: 'old-pass-1', newPassword: 'newpassword' })
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('weak_password')
    expect(r.json.message).toMatch(/заглавные/)
  })

  it('Supabase требует повторный вход — говорит, что сделать', async () => {
    s.updateError = { message: 'Password update requires reauthentication', code: 'reauthentication_needed', status: 400 }
    const r = await post({ current: 'old-pass-1', newPassword: 'new-pass-12' })
    expect(r.json.error).toBe('reauthentication_needed')
    expect(r.json.message).toMatch(/войти заново/)
  })

  it('тот же пароль — свой текст', async () => {
    const r = await post({ current: 'same-pass-1', newPassword: 'same-pass-1' })
    expect(r.json.error).toBe('same_password')
    expect(r.json.message).toMatch(/совпадает/)
  })

  it('ограничивает подбор текущего пароля', async () => {
    s.limited = true
    const r = await post({ current: 'old-pass-1', newPassword: 'new-pass-12' })
    expect(r.status).toBe(429)
    expect(r.json.message).toMatch(/Слишком много/)
    expect(s.updated).toEqual([])
  })
})
