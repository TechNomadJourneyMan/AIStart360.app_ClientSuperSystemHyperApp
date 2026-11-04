/**
 * Фильтр контента в клиентских роутах: текст с матом / оскорблениями / спамом
 * НЕ сохраняется (422 CONTENT_REJECTED), случай пишется в журнал
 * content_moderation_events; чистый текст и числа сохраняются как раньше.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; op: string; payload: unknown }>,
  journal: [] as Array<Record<string, unknown>>,
  notified: 0,
  filterEnabled: true,
  dictionary: [] as Array<{ term: string; kind: string }>,
  company: null as Record<string, unknown> | null,
  background: [] as Promise<unknown>[],
}))

/** Chainable query double: every builder method returns the chain; awaiting it yields rows. */
function chain(table: string, rows: () => unknown[] = () => []) {
  const c: Record<string, unknown> = {}
  const self = () => c
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'contains', 'range']) c[m] = self
  let wrote = false
  c.insert = (payload: unknown) => { wrote = true; s.writes.push({ table, op: 'insert', payload }); return c }
  c.update = (payload: unknown) => { wrote = true; s.writes.push({ table, op: 'update', payload }); return c }
  c.upsert = (payload: unknown) => { wrote = true; s.writes.push({ table, op: 'upsert', payload }); return c }
  // A read returns the stored company (null = none yet); a write returns the written row.
  c.single = () => Promise.resolve({ data: wrote ? { id: 'co-1' } : (table === 'companies' ? s.company : {}), error: null })
  c.maybeSingle = () => Promise.resolve({ data: table === 'companies' ? s.company : { full_name: 'Иван' }, error: null })
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej)
  return c
}

const user = { id: '11111111-2222-4333-8444-555555555555', email: 'client@example.com' }
const serverClient = { auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => chain(t) }

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => serverClient }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => serverClient }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      if (t === 'content_filter_terms') return chain(t, () => s.dictionary)
      if (t === 'content_moderation_events') {
        const c = chain(t)
        c.insert = (rows: Array<Record<string, unknown>>) => { s.journal.push(...rows); return Promise.resolve({ error: null }) }
        return c
      }
      return chain(t)
    },
  }),
}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => s.filterEnabled }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async () => { s.notified++ } }))
vi.mock('@/lib/background', () => ({
  runInBackground: (label: string, work: () => Promise<unknown>) => {
    // Only the moderation journal is under test; the survey mirror is not run.
    if (label === 'moderation-record') s.background.push(work())
  },
}))
vi.mock('@/lib/activity/log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => {} }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: async () => {} }))
vi.mock('@/lib/notifications/product', () => ({ notifyQuestionnaireCompleted: async () => ({ ok: true }) }))
vi.mock('@/lib/api-identity', () => ({ resolveTargetUserId: async () => ({ userId: user.id }) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => {}, trackEventOnce: async () => {} }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => {} }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
vi.mock('@/lib/integrations/google-sheets', () => ({ googleSheetsConfigured: () => false, spreadsheetUrl: () => '', upsertRowByKey: async () => ({ ok: true }) }))

const { resetRecentRejections } = await import('@/lib/moderation/guard')
const profile = await import('@/app/api/v1/settings/profile/route')
const survey = await import('@/app/api/v1/onboarding/survey/route')
const company = await import('@/app/api/v1/onboarding/company/route')

const json = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const drain = async () => { await Promise.all(s.background.splice(0)) }
const writesTo = (table: string) => s.writes.filter((w) => w.table === table && w.op !== 'select')

beforeEach(() => {
  s.writes = []
  s.journal = []
  s.notified = 0
  s.filterEnabled = true
  s.dictionary = []
  s.company = null
  s.background = []
  resetRecentRejections()
})

describe('PATCH /api/v1/settings/profile — фильтр контента', () => {
  it('отклоняет имя с матом: 422 CONTENT_REJECTED, профиль не обновляется, случай в журнале', async () => {
    const res = await profile.PATCH(json('/api/v1/settings/profile', 'PATCH', { full_name: 'Иван Пиздюков', position: 'CEO' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'CONTENT_REJECTED' })
    expect(body.error).toContain('«Имя»')
    expect(body.fields).toEqual([{ field: 'full_name', label: 'Имя', categories: ['mat'] }])
    expect(writesTo('profiles')).toHaveLength(0)

    await drain()
    expect(s.journal).toHaveLength(1)
    expect(s.journal[0]).toMatchObject({ user_id: user.id, user_email: user.email, source: 'profile', field: 'full_name', categories: ['mat'] })
    expect(String(s.journal[0].excerpt)).not.toMatch(/пизд/i)
    expect(s.notified).toBe(1)
  })

  it('сохраняет чистый профиль', async () => {
    const res = await profile.PATCH(json('/api/v1/settings/profile', 'PATCH', { full_name: 'Иван Петров', organization: 'ТОО Ромашка' }))
    expect(res.status).toBe(200)
    expect(writesTo('profiles')).toHaveLength(1)
    await drain()
    expect(s.journal).toHaveLength(0)
  })

  it('слово из словаря «запретить» блокирует, «исключение» — пропускает', async () => {
    s.dictionary = [{ term: 'казино', kind: 'block' }]
    // guard кеширует словарь 60 с — сбрасываем.
    const { invalidateFilterDictionary } = await import('@/lib/moderation/guard')
    invalidateFilterDictionary()
    const res = await profile.PATCH(json('/api/v1/settings/profile', 'PATCH', { organization: 'Казино Вулкан' }))
    expect(res.status).toBe(422)
    expect((await res.json()).fields[0].categories).toEqual(['custom'])
    invalidateFilterDictionary()
  })

  it('выключенный фильтр (content_filter_enabled = false) сохраняет без проверки', async () => {
    s.filterEnabled = false
    const res = await profile.PATCH(json('/api/v1/settings/profile', 'PATCH', { full_name: 'Иван Пиздюков' }))
    expect(res.status).toBe(200)
    expect(writesTo('profiles')).toHaveLength(1)
  })
})

describe('POST /api/v1/onboarding/survey — свободные тексты анкеты', () => {
  const post = (answers: Record<string, unknown>) => survey.POST(json('/api/v1/onboarding/survey', 'POST', {
    step: 2,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v }])),
  }) as never)

  it('отклоняет мат в свободном ответе — ничего не сохраняется', async () => {
    const res = await post({ s2n_what_blocks_growth: 'всё нахуй развалилось', s1_employee_count: 12 })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_REJECTED')
    expect(body.fields.map((f: { field: string }) => f.field)).toEqual(['s2n_what_blocks_growth'])
    expect(writesTo('survey_answers')).toHaveLength(0)
    await drain()
    expect(s.journal[0]).toMatchObject({ source: 'survey', field: 's2n_what_blocks_growth' })
  })

  it('принимает числа и выбор из списка; чистый текст сохраняется', async () => {
    const res = await post({
      s1_employee_count: 12,
      s1_goal_12m_revenue_month: 5_000_000,
      s1_industry: 'Розничная торговля',
      s3n_price_segment: 'premium',
      s2n_what_blocks_growth: 'Не хватает продавцов и денег на рекламу',
    })
    expect(res.status).toBe(200)
    expect(writesTo('survey_answers')).toHaveLength(1)
  })

  it('название компании проверяется как имя (ссылки запрещены)', async () => {
    const res = await post({ s1_company_name: 'Лучшие цены www.spam-shop.kz' })
    expect(res.status).toBe(422)
    expect((await res.json()).fields[0]).toMatchObject({ field: 's1_company_name', categories: ['spam'] })
  })

  it('не проверяет числовые и select-поля (там нечего фильтровать)', async () => {
    // Мат как значение select — бессмыслица (там варианты из списка), а проверка
    // таких полей отключена намеренно: ложное срабатывание заблокировало бы всю анкету.
    const res = await post({ s4m_control_method: 'сука' })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/onboarding/company — белый список колонок + фильтр', () => {
  it('пишет только разрешённые колонки (partner_id / target_revenue_* из тела игнорируются)', async () => {
    const res = await company.POST(json('/api/v1/onboarding/company', 'POST', {
      name: 'ТОО Ромашка', industry: 'Ритейл', employee_count: 10, regions: ['Алматы'],
      partner_id: 'evil', target_revenue_12m_kzt: 1, user_id: 'someone-else',
    }) as never)
    expect(res.status).toBe(200)
    const insert = writesTo('companies').find((w) => w.op === 'insert')
    expect(insert?.payload).toEqual({ user_id: user.id, name: 'ТОО Ромашка', industry: 'Ритейл', employee_count: 10, regions: ['Алматы'] })
  })

  it('отклоняет название компании с матом — запись не создаётся', async () => {
    const res = await company.POST(json('/api/v1/onboarding/company', 'POST', { name: 'ТОО Хуйня', contact_name: 'Иван' }) as never)
    expect(res.status).toBe(422)
    expect((await res.json()).fields[0]).toMatchObject({ field: 'name', label: 'Название компании' })
    expect(writesTo('companies')).toHaveLength(0)
  })
})
