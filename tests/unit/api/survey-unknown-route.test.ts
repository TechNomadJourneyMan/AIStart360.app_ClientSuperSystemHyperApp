/**
 * /api/v1/onboarding/survey and «Не знаю» / «примерно» (survey MVP item 3):
 * the marks are stored as their own envelope and come back as marks; an
 * inconsistent mark is refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryClient, type Row } from '../data-layer/memory-client'

const OWNER = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'

const state = vi.hoisted(() => ({
  session: '' as string,
  target: '' as string,
  db: null as unknown as { client: unknown; db: Record<string, Row[]> },
  /** Simulate PostgREST before migration 131 (unknown author columns). */
  noAuthorColumns: false,
  upserts: [] as Array<Array<Record<string, unknown>>>,
}))

function sessionClient() {
  const base = state.db.client as { from: (t: string) => Record<string, unknown> }
  return {
    auth: { getUser: async () => ({ data: { user: { id: state.session } }, error: null }) },
    from(t: string) {
      const b = base.from(t)
      if (t !== 'survey_answers') return b
      const upsert = b.upsert as (rows: Array<Record<string, unknown>>, o: unknown) => unknown
      b.upsert = (rows: Array<Record<string, unknown>>, o: unknown) => {
        state.upserts.push(rows)
        if (state.noAuthorColumns && rows.some((r) => 'updated_by_role' in r)) {
          return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'updated_by' column of 'survey_answers' in the schema cache" } })
        }
        return upsert(rows, o)
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => sessionClient() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.db.client }))
vi.mock('@/lib/api-identity', () => ({ resolveTargetUserId: async () => ({ userId: state.target }) }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: vi.fn() }))
vi.mock('@/lib/notifications/product', () => ({ notifyQuestionnaireCompleted: vi.fn() }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: vi.fn() }))
vi.mock('@/lib/events/track', () => ({ trackEvent: vi.fn(async () => {}), trackEventOnce: vi.fn(async () => {}) }))
vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }))

const { GET, POST } = await import('@/app/api/v1/onboarding/survey/route')

async function post(answers: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const body = { step: 9, autosave: true, answers, ...extra }
  const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never)
  return { status: res.status, json: await res.json() }
}
const row = (key: string) => state.db.db.survey_answers.find((r) => r.question_key === key)

beforeEach(() => {
  state.session = OWNER
  state.target = OWNER
  state.noAuthorColumns = false
  state.upserts = []
  state.db = memoryClient({
    companies: [{ id: 'co-1', user_id: OWNER }],
    survey_answers: [],
    profiles: [{ id: EXPERT, role: 'expert', full_name: 'Иван Петров', email: 'ivan@x.kz' }, { id: OWNER, role: 'client', full_name: 'Владелец' }],
    staff_roles: [],
  }) as never
})

describe('«не знаю» / «примерно» through the survey route', () => {
  it('stores the marks as sent and counts «не знаю» as an answered step', async () => {
    const { status, json } = await post({
      s9n_net_margin: { value: null, unknown: true },
      s9n_revenue_2024: { value: 55_000_000, approx: true, range: [50_000_000, 60_000_000] },
    })
    expect(status).toBe(200)
    expect(row('s9n_net_margin')).toMatchObject({ answer: { value: null, unknown: true } })
    expect(row('s9n_revenue_2024')).toMatchObject({ answer: { value: 55_000_000, approx: true, range: [50_000_000, 60_000_000] } })
    expect(json.data.completed_steps).toBe(1)
  })

  it('GET returns the marks, plain answers unwrapped', async () => {
    state.db.db.survey_answers.push(
      { user_id: OWNER, question_key: 's9n_net_margin', step: 9, answer: { value: null, unknown: true }, answered_at: '2026-10-22T09:00:00Z' },
      { user_id: OWNER, question_key: 's9n_debtor_days', step: 9, answer: { value: 30 }, answered_at: '2026-10-22T09:00:00Z' },
    )
    const res = await GET({ nextUrl: new URL('http://localhost/api/v1/onboarding/survey') } as never)
    const json = await res.json()
    expect(json.data.answers.s9n_net_margin).toEqual({ value: null, unknown: true })
    expect(json.data.answers.s9n_debtor_days).toBe(30)
  })

  it('refuses «не знаю» with a value', async () => {
    expect((await post({ s9n_net_margin: { value: 12, unknown: true } })).status).toBe(400)
  })
})
