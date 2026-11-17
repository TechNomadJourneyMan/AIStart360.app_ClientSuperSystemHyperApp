/**
 * R4 B3, ревью W3A-3: сбой чтения режима регистрации (не «строки нет», а ошибка
 * базы — на проде бывал too_many_connections) больше не открывает регистрацию.
 * Всё, что создаёт аккаунты или показывает регистрацию / демо, получает
 * закрытый вариант 'invite' (или режим, прочитанный за последние 5 минут):
 * страницы входа, демо-API, API регистрации, форма «Запросить приглашение».
 * «Строки нет» — по-прежнему 'approval' (админ режим не трогал).
 * Настоящий lib/settings/system-settings.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  down: false,
  row: null as null | { value: unknown; updated_at: string },
  createUser: vi.fn(async () => ({ data: null, error: { message: 'stop' } })),
  inserts: 0,
}))

function settingsQuery() {
  const q: Record<string, unknown> = {}
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => (s.down ? { data: null, error: { message: 'sorry, too many clients already' } } : { data: s.row, error: null }),
  })
  return q
}
function emptyQuery() {
  const q: Record<string, unknown> = {}
  Object.assign(q, {
    select: () => q, eq: () => q, in: () => q, limit: () => q, update: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async () => { s.inserts++; return { error: null } },
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  })
  return q
}

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { createUser: s.createUser } },
    from: (table: string) => (table === 'system_settings' ? settingsQuery() : emptyQuery()),
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { createUser: s.createUser } } }) }))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimited: async () => false,
  checkRateLimitForRequest: async () => ({ limited: false }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/background', () => ({ runInBackground: async () => {} }))

const settings = await import('@/lib/settings/system-settings')
const { loadAuthEntry } = await import('@/lib/registration/entry')
const { POST: demo } = await import('@/app/api/auth/demo-access/route')
const { POST: register } = await import('@/app/api/auth/register/route')
const { POST: requestInvite } = await import('@/app/api/auth/request-invite/route')

const json = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  s.down = false
  s.row = { value: 'invite', updated_at: '2026-11-01T00:00:00.000Z' }
  s.createUser.mockClear()
  s.inserts = 0
  settings.__resetRegistrationModeCacheForTests()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  delete process.env.DEMO_ACCESS_ENABLED
})

describe('W3A-3: чтение режима', () => {
  it('ошибка базы — ok:false, а getRegistrationMode отдаёт закрытый «по приглашению»', async () => {
    s.down = true
    expect(await settings.readRegistrationMode()).toEqual({ mode: 'approval', ok: false, updatedAt: null })
    expect(await settings.getRegistrationMode()).toBe('invite')
  })

  it('«строки нет» — по-прежнему «по подтверждению»; время записи строки отдаётся', async () => {
    s.row = null
    expect(await settings.readRegistrationMode()).toEqual({ mode: 'approval', ok: true, updatedAt: null })
    s.row = { value: 'approval', updated_at: '2026-11-02T00:00:00.000Z' }
    expect(await settings.readRegistrationMode()).toEqual({ mode: 'approval', ok: true, updatedAt: '2026-11-02T00:00:00.000Z' })
  })

  it('сбой сразу после удачного чтения — последний известный режим (до 5 минут)', async () => {
    s.row = { value: 'approval', updated_at: '2026-11-02T00:00:00.000Z' }
    expect(await settings.getRegistrationMode()).toBe('approval')
    s.down = true
    expect(await settings.getRegistrationMode()).toBe('approval')
  })
})

describe('W3A-3: при сбое ничего не открывается', () => {
  beforeEach(() => { s.down = true })

  it('страницы входа: форма запроса приглашения, демо скрыто', async () => {
    const entry = await loadAuthEntry({})
    expect(entry.mode).toBe('invite')
    expect(entry.demoOpen).toBe(false)
  })

  it('демо-API — 403, аккаунт не создан', async () => {
    expect((await demo(new Request('http://x/api/auth/demo-access', { method: 'POST' }))).status).toBe(403)
    expect(s.createUser).not.toHaveBeenCalled()
  })

  it('API регистрации — 403, аккаунт не создан', async () => {
    const res = await register(json('http://x/api/auth/register', { email: 'new@user.io', password: 'secret12345', name: 'Новый' }))
    expect(res.status).toBe(403)
    expect(s.createUser).not.toHaveBeenCalled()
  })

  it('форма «Запросить приглашение» принимает заявку, а не отвечает «регистрация открыта»', async () => {
    const res = await requestInvite(json('http://x/api/auth/request-invite', { name: 'Айгуль', email: 'a@corp.kz', company: 'ТОО Ромашка', consent: true }))
    expect(res.status).toBe(200)
    expect(s.inserts).toBe(1)
  })
})
