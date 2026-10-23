/**
 * /api/v1/onboarding/survey and the answer authors (migration 131, W5):
 * POST stamps who wrote each answer (owner / value from a document / staff),
 * survives a database without the author columns, and GET returns the author
 * of every answer with expert / admin names from one profiles query.
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
  const body = { step: 2, autosave: true, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v }])), ...extra }
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

describe('POST — who wrote the answer', () => {
  it('the owner → user, stamped on the row and returned for the line under the field', async () => {
    const { status, json } = await post({ s2n_goal_12m_what: '**Рост** выручки' })
    expect(status).toBe(200)
    expect(row('s2n_goal_12m_what')).toMatchObject({ updated_by: OWNER, updated_by_role: 'user', answer: { value: '**Рост** выручки' } })
    expect(typeof row('s2n_goal_12m_what')?.updated_at).toBe('string')
    expect(json.data.attribution.s2n_goal_12m_what).toMatchObject({ updatedBy: OWNER, updatedByRole: 'user', updatedByName: null })
  })

  it('a value the owner accepted from a document → ai; other keys of the same save stay user', async () => {
    await post({ s2n_goal_12m_what: 'из файла', s2n_goal_3y_what: 'набрал сам' }, { origins: { s2n_goal_12m_what: 'document' } })
    expect(row('s2n_goal_12m_what')).toMatchObject({ updated_by: OWNER, updated_by_role: 'ai' })
    expect(row('s2n_goal_3y_what')).toMatchObject({ updated_by_role: 'user' })
    expect(state.upserts).toHaveLength(2)
  })

  it('staff saving a client\'s answers → expert with their id', async () => {
    state.session = EXPERT
    const { json } = await post({ s2n_goal_12m_what: 'правка эксперта' })
    expect(row('s2n_goal_12m_what')).toMatchObject({ user_id: OWNER, updated_by: EXPERT, updated_by_role: 'expert' })
    expect(json.data.attribution.s2n_goal_12m_what.updatedByRole).toBe('expert')
  })

  it('origins are validated with the body', async () => {
    expect((await post({ s2n_goal_12m_what: 'x' }, { origins: { s2n_goal_12m_what: 'expert' } })).status).toBe(400)
  })

  it('before migration 131: retried without the author columns, the answer is saved', async () => {
    state.noAuthorColumns = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { status } = await post({ s2n_goal_12m_what: 'текст' })
    expect(status).toBe(200)
    expect(row('s2n_goal_12m_what')).toMatchObject({ answer: { value: 'текст' } })
    expect(row('s2n_goal_12m_what')).not.toHaveProperty('updated_by_role')
    expect(state.upserts).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('GET — the author of every answer', () => {
  it('stored authors with expert names; legacy rows by the old rule', async () => {
    state.db.db.survey_answers.push(
      { user_id: OWNER, question_key: 's2n_goal_12m_what', step: 2, answer: { value: 'a' }, answered_at: '2026-10-22T09:00:00Z', updated_by: EXPERT, updated_by_role: 'expert', updated_at: '2026-10-22T09:00:00Z' },
      { user_id: OWNER, question_key: 's2n_goal_3y_what', step: 2, answer: { value: 'b' }, answered_at: '2026-10-21T09:00:00Z', updated_by: OWNER, updated_by_role: 'user', updated_at: '2026-10-21T09:00:00Z' },
      { user_id: OWNER, question_key: 's9n_revenue_2024', step: 9, answer: { value: 1, source: 'P&L.xlsx, B4' }, answered_at: '2026-10-20T09:00:00Z' },
      { user_id: OWNER, question_key: 's2n_goal_3y_metrics', step: 2, answer: { value: 'c' }, answered_at: '2026-10-19T09:00:00Z' },
      // Staff-only notes are not wizard keys: neither the answer nor its author leaks.
      { user_id: OWNER, question_key: 'gri_expert_cash', step: 0, answer: { value: 'note' }, updated_by: EXPERT, updated_by_role: 'expert' },
    )
    const res = await GET({ nextUrl: new URL('http://localhost/api/v1/onboarding/survey') } as never)
    const { data } = await res.json()
    expect(data.answers.s2n_goal_12m_what).toBe('a')
    expect(data.attribution.s2n_goal_12m_what).toEqual({ updatedBy: EXPERT, updatedByRole: 'expert', updatedAt: '2026-10-22T09:00:00Z', updatedByName: 'Иван Петров' })
    expect(data.attribution.s2n_goal_3y_what).toMatchObject({ updatedByRole: 'user', updatedByName: null })
    expect(data.attribution.s9n_revenue_2024).toMatchObject({ updatedByRole: 'ai', legacy: true })
    expect(data.attribution.s2n_goal_3y_metrics).toMatchObject({ updatedByRole: null, legacy: true })
    expect(data.attribution).not.toHaveProperty('gri_expert_cash')
  })
})

describe('POST — the path of the answer (migration 134)', () => {
  it('the body path is stamped (default full), returned with the author line; a month alone brings its year', async () => {
    const { json } = await post({ s2n_goal_12m_what: 'экспресс' }, { via: 'express' })
    expect(row('s2n_goal_12m_what')).toMatchObject({ updated_by_role: 'user', updated_via: 'express' })
    expect(json.data.attribution.s2n_goal_12m_what).toMatchObject({ updatedVia: 'express' })
    await post({ s1_current_revenue_month: 2_000_000 })
    expect(row('s1_current_revenue_month')).toMatchObject({ updated_via: 'full' })
    expect(row('s1_current_revenue_year')).toMatchObject({ step: 1, answer: { value: 24_000_000 }, updated_via: 'full' })
  })

  it('the browser cannot claim the chat or a staff edit', async () => {
    expect((await post({ s2n_goal_12m_what: 'x' }, { via: 'chat' })).status).toBe(400)
    expect((await post({ s2n_goal_12m_what: 'x' }, { via: 'staff' })).status).toBe(400)
  })

  it('a value confirmed in the field «Помощник» → path helper', async () => {
    await post({ s2n_goal_12m_what: 'из помощника' }, { origins: { s2n_goal_12m_what: 'chat' } })
    expect(row('s2n_goal_12m_what')).toMatchObject({ updated_by_role: 'user', updated_via: 'helper' })
  })
})
