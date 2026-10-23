/**
 * «Готово» of the express flow (spec §7.2; PO §18.3 item 1): the event
 * SURVEY_EXPRESS_COMPLETED once, the assigned expert notified once — and
 * never «анкета заполнена» (no QUESTIONNAIRE_COMPLETED / ONBOARDING_COMPLETED).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryClient, type Row } from '../data-layer/memory-client'
import { completeExpress } from '@/lib/survey/express-complete'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'

const s = vi.hoisted(() => ({
  db: null as unknown as { client: unknown; db: Record<string, Row[]> },
  user: null as { id: string } | null,
  events: [] as Array<Record<string, unknown>>,
  staff: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ ...(s.db.client as object), auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.db.client }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/events/track', () => ({
  trackEventOnce: async (e: Record<string, unknown>) => {
    if (s.events.some((x) => x.name === e.name && x.entityId === e.entityId)) return
    s.events.push(e)
  },
  trackEvent: async (e: Record<string, unknown>) => { s.events.push(e) },
}))
vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (n: Record<string, unknown>) => {
    if (s.staff.some((x) => x.dedupeKey === n.dedupeKey)) return { ok: true, duplicate: true }
    s.staff.push(n)
    return { ok: true }
  },
}))

const route = await import('@/app/api/v1/survey/express/complete/route')
const post = async (body: unknown = { minutes: 8 }) => {
  const res = await route.POST(new Request('http://t/api/v1/survey/express/complete', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  s.user = { id: CLIENT }
  s.events = []
  s.staff = []
  s.db = memoryClient({
    survey_answers: [
      { user_id: CLIENT, question_key: 's1_company_name', answer: { value: 'ТОО Пример' } },
      { user_id: CLIENT, question_key: 's3_deal_cycle_days', answer: { value: null, unknown: true } },
      { user_id: CLIENT, question_key: 's4_has_org_chart', answer: { value: false } },
    ],
    companies: [{ id: 'c1', user_id: CLIENT, name: 'ТОО Пример' }],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }],
  })
})

describe('POST /api/v1/survey/express/complete', () => {
  it('401 without a session', async () => {
    s.user = null
    expect((await post()).status).toBe(401)
    expect(s.events).toEqual([])
  })

  it('event once with the summary; the assigned expert notified once', async () => {
    const r = await post()
    expect(r.status).toBe(200)
    expect(r.body.data.summary).toMatchObject({ total: 26, answered: 3, unknown: 1, skipped: 23 })
    expect(s.events).toHaveLength(1)
    expect(s.events[0]).toMatchObject({ name: 'SURVEY_EXPRESS_COMPLETED', userId: CLIENT, metadata: { answered: 3, unknown: 1, skipped: 23, minutes: 8 } })
    expect(s.staff).toHaveLength(1)
    expect(s.staff[0]).toMatchObject({
      type: 'survey.express.completed', audienceUserIds: [EXPERT], dedupeKey: `survey.express.completed:${CLIENT}`, companyId: 'c1',
      title: 'Клиент завершил быстрый старт — первичная Точка А готова',
    })
    await post()
    expect(s.events).toHaveLength(1)
    expect(s.staff).toHaveLength(1)
  })

  it('never marks the questionnaire as submitted', async () => {
    await post()
    expect(s.events.map((e) => e.name)).not.toContain('QUESTIONNAIRE_COMPLETED')
    expect(s.events.map((e) => e.name)).not.toContain('ONBOARDING_COMPLETED')
  })

  it('no assignee → staff with clients.review', async () => {
    s.db.db.user_assignments = []
    await post()
    expect(s.staff[0]).toMatchObject({ audienceUserIds: null, audiencePermission: 'clients.review' })
  })
})

describe('completeExpress never throws', () => {
  it('failed reads and a failed notification still answer', async () => {
    const r = await completeExpress({
      readAnswers: async () => { throw new Error('db down') },
      companyOf: async () => null,
      assigneeOf: async () => null,
      trackOnce: async () => { throw new Error('events down') },
      notifyStaff: async () => { throw new Error('tg down') },
    }, { userId: CLIENT, minutes: 1e9 })
    expect(r).toEqual({ summary: { total: 26, answered: 0, unknown: 0, skipped: 26 }, notified: false })
  })
})
