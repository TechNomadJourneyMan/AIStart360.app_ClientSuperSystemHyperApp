/**
 * Фильтр мата в роутах кабинета: имя в профиле, регистрация, компания,
 * подпись цели и анкета. С матом — 400 и имя поля, без записи; чисто — дальше.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  profileUpdates: [] as Array<Record<string, unknown>>,
  companyWrites: [] as Array<Record<string, unknown>>,
  upsertGoal: vi.fn(),
  resolveTarget: vi.fn(),
  createUser: vi.fn(),
}))

// settings/profile + goals: session client
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'u@x.io' } }, error: null }) },
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        h.profileUpdates.push(patch)
        return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: patch, error: null }) }) }) }
      },
    }),
  }),
}))
vi.mock('@/lib/activity/log', () => ({ logActivity: vi.fn(async () => undefined) }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn(async () => undefined) }))

// goals
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: vi.fn(async () => ({ ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } })),
  tenantErrorMessage: () => 'Нет доступа',
}))
vi.mock('@/lib/metrics/company-metrics', () => ({ loadCompanyMetrics: async () => new Map() }))
vi.mock('@/lib/goals/store', () => ({ upsertGoal: h.upsertGoal, deleteGoal: vi.fn(), syncRevenueGoal: vi.fn() }))
// Goal ↔ questionnaire mirroring is covered by tests/unit/goals/survey-sync.test.ts.
vi.mock('@/lib/goals/survey-sync', () => ({
  mirrorGoalToSurvey: vi.fn(async () => ({ skipped: 'test' })),
  syncGoalsFromSurvey: vi.fn(async () => ({ skipped: 'test' })),
  surveyWriterFor: vi.fn(),
  touchesGoalKeys: () => false,
}))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: vi.fn() }))

// onboarding/company + survey: legacy server client
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => {
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b, eq: () => b,
        single: async () => ({ data: null, error: null }),
        insert: (row: Record<string, unknown>) => { h.companyWrites.push(row); return b },
        update: (row: Record<string, unknown>) => { h.companyWrites.push(row); return b },
      })
      return b
    },
  }),
}))
vi.mock('@/lib/api-identity', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-identity')>()),
  resolveTargetUserId: h.resolveTarget,
}))

// registration
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  isRateLimited: async () => false,
  isRateLimitedKey: async () => false,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ auth: { admin: { createUser: h.createUser } } }) }))
vi.mock('@/lib/settings/system-settings', () => ({ getRegistrationMode: async () => 'invite', getAutoApproveClients: async () => false }))

const BAD = 'Это полная хуйня'
const settings = await import('@/app/api/v1/settings/profile/route')
const goals = await import('@/app/api/v1/goals/route')
const onboardingCompany = await import('@/app/api/v1/onboarding/company/route')
const survey = await import('@/app/api/v1/onboarding/survey/route')
const register = await import('@/app/api/auth/register/route')

const jsonReq = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const out = async (res: Response) => ({ status: res.status, body: await res.json() })

beforeEach(() => {
  h.profileUpdates = []
  h.companyWrites = []
  h.upsertGoal.mockReset().mockImplementation(async (_s, _c, input) => ({
    id: 'g1', metricId: input.metricId, label: input.label ?? null, unit: '%', targetValue: input.targetValue, direction: 'higher_is_better',
    periodLabel: input.periodLabel, deadline: null, baselineValue: null, baselinePeriod: null, source: 'owner', note: null, createdAt: '2026-10-16T00:00:00Z',
  }))
  // Survey: identity lookup is the first step after the filter; a 401 here
  // proves the request got past it without touching answers.
  h.resolveTarget.mockReset().mockResolvedValue({ error: 'unauthorized' })
  h.createUser.mockReset()
})

describe('PATCH /api/v1/settings/profile (имя в профиле)', () => {
  it('мат в имени → 400 full_name, профиль не меняется', async () => {
    const { status, body } = await out(await settings.PATCH(jsonReq('/api/v1/settings/profile', 'PATCH', { full_name: `Иван ${BAD}` })))
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false, code: 'profanity', field: 'full_name' })
    expect(h.profileUpdates).toHaveLength(0)
  })

  it('чистое имя → 200', async () => {
    const res = await settings.PATCH(jsonReq('/api/v1/settings/profile', 'PATCH', { full_name: 'Иван Петров', organization: 'ТОО Береке' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdates[0]).toMatchObject({ full_name: 'Иван Петров' })
  })
})

describe('POST /api/auth/register (имя при регистрации)', () => {
  it('мат в имени → 400 name, пользователь не создаётся', async () => {
    const { status, body } = await out(await register.POST(jsonReq('/api/auth/register', 'POST', { email: 'a@b.kz', password: 'secret-123', name: 'бля бля' })))
    expect(status).toBe(400)
    expect(body.field).toBe('name')
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('мат в названии организации → 400 organization', async () => {
    const { body } = await out(await register.POST(jsonReq('/api/auth/register', 'POST', { email: 'a@b.kz', password: 'secret-123', name: 'Иван', organization: BAD })))
    expect(body.field).toBe('organization')
  })
})

describe('POST /api/v1/onboarding/company (компания из кабинета)', () => {
  it('мат в названии → 400 name, без записи', async () => {
    const { status, body } = await out(await onboardingCompany.POST(jsonReq('/api/v1/onboarding/company', 'POST', { name: BAD, employee_count: 5 })))
    expect(status).toBe(400)
    expect(body.field).toBe('name')
    expect(h.companyWrites).toHaveLength(0)
  })

  it('мат в списке регионов → 400 regions.N', async () => {
    const { body } = await out(await onboardingCompany.POST(jsonReq('/api/v1/onboarding/company', 'POST', { name: 'ТОО', regions: ['Алматы', BAD] })))
    expect(body.field).toBe('regions.1')
  })

  it('чистые данные → 200', async () => {
    const res = await onboardingCompany.POST(jsonReq('/api/v1/onboarding/company', 'POST', { name: 'ТОО Береке', regions: ['Алматы'] }))
    expect(res.status).toBe(200)
    expect(h.companyWrites).toHaveLength(1)
  })
})

describe('POST /api/v1/goals (подпись цели)', () => {
  const goal = { metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m' }

  it('мат в подписи → 400 label, цель не сохраняется', async () => {
    const { status, body } = await out(await goals.POST(new Request('http://localhost/api/v1/goals', { method: 'POST', body: JSON.stringify({ ...goal, label: BAD }) })))
    expect(status).toBe(400)
    expect(body.field).toBe('label')
    expect(h.upsertGoal).not.toHaveBeenCalled()
  })

  it('чистая подпись → 200', async () => {
    const res = await goals.POST(new Request('http://localhost/api/v1/goals', { method: 'POST', body: JSON.stringify({ ...goal, label: 'Маржа 40%' }) }))
    expect(res.status).toBe(200)
    expect(h.upsertGoal).toHaveBeenCalledOnce()
  })
})

describe('POST /api/v1/onboarding/survey (анкета)', () => {
  const save = (answers: Record<string, { value: unknown }>) =>
    survey.POST(jsonReq('/api/v1/onboarding/survey', 'POST', { step: 3, answers }))

  it('текстовый ответ с матом → 400 с ключом вопроса, ничего не сохраняется', async () => {
    const { status, body } = await out(await save({ s1_employee_count: { value: 25 }, s3n_client_portrait: { value: BAD } }))
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false, code: 'profanity', field: 's3n_client_portrait', error: 'Уберите нецензурные слова — такой текст сохранить нельзя.' })
    expect(h.resolveTarget).not.toHaveBeenCalled()
  })

  it('числа, выбор и чистый текст проходят фильтр', async () => {
    const res = await save({ s1_employee_count: { value: 25 }, s1_business_model: { value: 'B2B' }, s3n_client_portrait: { value: 'Владельцы малого бизнеса' } })
    expect(res.status).toBe(401) // дальше фильтра: проверка сессии
    expect(h.resolveTarget).toHaveBeenCalledOnce()
  })

  it('ключи вне анкеты не проверяются (их всё равно не пишем)', async () => {
    const res = await save({ gri_expert_cash: { value: BAD } })
    expect(res.status).toBe(401)
  })
})
