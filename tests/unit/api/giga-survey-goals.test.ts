/**
 * PATCH /api/giga-admin/users/:id/survey — a staff edit of a step-1 goal
 * answer moves the client's goal (metric_targets) too (plan 2026-10-22 W1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryClient } from '../data-layer/memory-client'

const USER = '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'
const h = vi.hoisted(() => ({
  service: null as unknown as ReturnType<typeof import('../data-layer/memory-client').memoryClient>,
  edit: vi.fn(),
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.service.client, createActorServiceClient: () => h.service.client }))
vi.mock('@/lib/admin/giga-actor', () => ({
  requireGiga: async () => ({ actor: { id: 'admin-1', kind: 'session', role: 'admin' } }),
  staffRoleOfUser: async () => ({ profileRole: 'client', staffRole: null }),
}))
vi.mock('@/lib/admin/client-scope', () => ({ guardClientAccess: async () => null }))
vi.mock('@/lib/admin/rbac', () => ({ canManageTarget: () => true }))
vi.mock('@/lib/admin/survey-admin', () => ({ adminEditSurvey: h.edit, SurveyEditError: class extends Error {} }))

const { PATCH } = await import('@/app/api/giga-admin/users/[id]/survey/route')

const patch = (changes: Record<string, unknown>) =>
  PATCH(new Request(`http://localhost/api/giga-admin/users/${USER}/survey`, { method: 'PATCH', body: JSON.stringify({ changes }) }) as never, { params: { id: USER } })

beforeEach(() => {
  h.service = memoryClient({ companies: [{ id: 'co', user_id: USER, target_revenue_12m_kzt: 6_000_000 }], metric_targets: [], survey_answers: [] })
  h.edit.mockReset().mockResolvedValue({ updated: 1, deleted: 0, ignored: [] })
})

describe('GIGA survey edit → goals', () => {
  it('a goal answer edited by staff becomes the client\'s goal (expert source, staff attribution)', async () => {
    const res = await patch({ s1_goal_12m_revenue_year: 780_000_000 })
    expect(res.status).toBe(200)
    expect(h.service.db.metric_targets[0]).toMatchObject({ company_id: 'co', period_label: '12m', target_value: 780_000_000, source: 'expert', updated_by: 'admin-1' })
    expect(h.service.db.companies[0].target_revenue_12m_kzt).toBe(780_000_000)
    // Only the year was edited: the month answer is aligned.
    expect(h.service.db.survey_answers.find((r) => r.question_key === 's1_goal_12m_revenue_month')).toMatchObject({ step: 1, answer: { value: 65_000_000 } })
  })

  it('other answers / no-op edits leave goals alone', async () => {
    await patch({ s1_company_name: 'X' })
    h.edit.mockResolvedValue({ updated: 0, deleted: 0, ignored: [] })
    await patch({ s1_goal_12m_revenue_year: 1 })
    expect(h.service.db.metric_targets).toEqual([])
  })
})
