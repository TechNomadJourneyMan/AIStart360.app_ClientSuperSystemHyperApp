/**
 * POST /api/v1/onboarding/survey with the express path (survey Ф2): the save
 * that answers the last question of a deepening block writes
 * SURVEY_BLOCK_COMPLETED once per block; the full questionnaire path does not;
 * and no express save is ever «анкета отправлена».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryClient, type Row } from '../data-layer/memory-client'

const OWNER = '11111111-1111-4111-8111-111111111111'

const state = vi.hoisted(() => ({
  db: null as unknown as { client: unknown; db: Record<string, Row[]> },
  events: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ ...(state.db.client as object), from: (t: string) => (state.db.client as { from: (t: string) => unknown }).from(t), auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.db.client }))
vi.mock('@/lib/api-identity', () => ({ resolveTargetUserId: async () => ({ userId: OWNER }) }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: vi.fn() }))
vi.mock('@/lib/notifications/product', () => ({ notifyQuestionnaireCompleted: vi.fn() }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: vi.fn() }))
vi.mock('@/lib/events/track', () => ({
  trackEvent: vi.fn(async (e: Record<string, unknown>) => { state.events.push(e) }),
  trackEventOnce: vi.fn(async (e: Record<string, unknown>) => { state.events.push(e) }),
}))
vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }))

const { POST } = await import('@/app/api/v1/onboarding/survey/route')

async function post(answers: Record<string, unknown>, via: string) {
  const body = { step: 12, autosave: false, via, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v }])) }
  const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never)
  return res.status
}

// Б15 «Системы и инструменты»: 7 keys.
const B15 = { s12_edm: 'none', s12_erp: 'none', s12_bi_tool: 'excel', s12_messengers: ['telegram'], s12_telephony: 'none', s12_automation_details: 'Пока ничего' }

beforeEach(() => {
  state.events = []
  state.db = memoryClient({ companies: [{ id: 'co-1', user_id: OWNER }], survey_answers: [], profiles: [], staff_roles: [] }) as never
})

describe('SURVEY_BLOCK_COMPLETED', () => {
  it('the express save that answers the last key of a block', async () => {
    expect(await post(B15, 'express')).toBe(200)
    expect(state.events.filter((e) => e.name === 'SURVEY_BLOCK_COMPLETED')).toEqual([])
    expect(await post({ s12_it_support: false }, 'express')).toBe(200)
    const done = state.events.filter((e) => e.name === 'SURVEY_BLOCK_COMPLETED')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ userId: OWNER, entityId: 'b15', metadata: { block: 'b15' } })
    expect(state.events.map((e) => e.name)).not.toContain('QUESTIONNAIRE_COMPLETED')
  })

  it('not for the full questionnaire path', async () => {
    await post({ ...B15, s12_it_support: true }, 'full')
    expect(state.events.filter((e) => e.name === 'SURVEY_BLOCK_COMPLETED')).toEqual([])
  })
})
