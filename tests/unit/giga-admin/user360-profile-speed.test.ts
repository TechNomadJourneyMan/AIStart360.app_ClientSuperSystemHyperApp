/**
 * GET /api/giga-admin/users/:id/profile (User 360 header) reads in two round trips (W4): every
 * user-keyed read (the survey completion markers included) at once, then the Point B date together
 * with the «viewed» mark. The response is what the card shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { memoryDb, roundTrips } from '../_round-trips'

const USER = 'cccccccc-0000-4000-8000-000000000001'
const STAFF = 'aaaaaaaa-0000-4000-8000-000000000001'

const s = vi.hoisted(() => ({ net: null as null | ReturnType<typeof import('../_round-trips').roundTrips>, tables: {} as Record<string, Array<Record<string, unknown>>> }))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.net!.sb }))
vi.mock('@/lib/admin/client-scope', () => ({ guardClientAccess: async () => null }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: STAFF, kind: 'session', role: 'admin' })),
    staffRoleOfUser: async () => ({ staffRole: null, profileRole: 'client', status: 'approved', email: 'c@example.com' }),
  }
})

const route = await import('@/app/api/giga-admin/users/[id]/profile/route')

function seed() {
  s.tables = {
    profiles: [{ id: USER, email: 'c@example.com', full_name: 'Клиент', role: 'client', status: 'approved', created_at: '2026-09-01T00:00:00Z', approved_at: '2026-09-02T00:00:00Z', last_seen_at: null }],
    companies: [{ id: 'company-1', user_id: USER, name: 'Ромашка' }],
    survey_answers: [{ user_id: USER, question_key: 's1_company_name', answer: { value: 'Ромашка' }, answered_at: '2026-09-03T00:00:00Z' }],
    diagnostics: [{ id: 'd-1', user_id: USER, overall_score: 55, health_index: 50, stage: 'growth', calculated_at: '2026-09-05T00:00:00Z', is_current: true }],
    point_b_analysis: [{ diagnostic_id: 'd-1', calculated_at: '2026-09-06T00:00:00Z' }],
    gri_assessments: [], gri_assessment_drafts: [], documents: [{ id: 'doc-1', user_id: USER }], user_events: [], impersonation_sessions: [],
    app_notifications: [],
  }
  s.net = roundTrips(memoryDb(s.tables))
}

beforeEach(seed)

describe('User 360 profile — round trips (W4)', () => {
  it('two round trips; the card data and the «viewed» mark are as before', async () => {
    const res = await route.GET(new NextRequest(`http://x/api/giga-admin/users/${USER}/profile`), { params: { id: USER } })
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(s.net!.waves()).toBe(2)
    expect(body.data.company).toMatchObject({ name: 'Ромашка' })
    expect(body.data.diagnostics).toMatchObject({ id: 'd-1', runs: 1 })
    expect(body.data.counters).toEqual({ documents: 1, events: 0 })
    expect(body.data.journey).toBeTruthy()
    expect(JSON.stringify(body.data.journey)).toContain('2026-09-06') // Point B date from point_b_analysis
    expect(s.tables.__writes).toEqual([expect.objectContaining({ table: 'staff_client_views', staff_id: STAFF, user_id: USER })])
  })

  it('the questionnaire status (survey Ф5): mode, express, full not submitted — still two round trips', async () => {
    s.tables.profiles[0].preferences = { survey: { mode: 'express', chosen_at: '2026-09-03T00:00:00Z' } }
    s.tables.user_events.push({ id: 'e-1', user_id: USER, event_name: 'SURVEY_EXPRESS_COMPLETED', created_at: '2026-09-04T00:00:00Z', metadata: { answered: 20, unknown: 2, skipped: 6 }, source: 'server' })
    const res = await route.GET(new NextRequest(`http://x/api/giga-admin/users/${USER}/profile`), { params: { id: USER } })
    const body = await res.json()
    expect(s.net!.waves()).toBe(2)
    expect(body.data.surveyStatus).toMatchObject({ mode: 'express', stuckOnExpress: true, fullPending: true, express: { answered: 20, total: 26 } })
  })

  it('an unknown user is 404 and nothing is marked as viewed', async () => {
    s.tables.profiles = []
    const res = await route.GET(new NextRequest(`http://x/api/giga-admin/users/${USER}/profile`), { params: { id: USER } })
    expect(res.status).toBe(404)
    expect(s.tables.__writes ?? []).toEqual([])
  })
})
