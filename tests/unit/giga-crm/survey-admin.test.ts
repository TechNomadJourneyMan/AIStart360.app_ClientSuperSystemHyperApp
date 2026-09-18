import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  existing: [] as Array<{ question_key: string; step: number; answer: { value: unknown } }>,
  upserts: [] as unknown[],
  deletes: [] as string[][],
  headers: null as Record<string, string> | null,
  auditFail: false,
  audits: [] as Array<{ entry: Record<string, unknown>; required?: boolean }>,
  order: [] as string[],
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: state.existing, error: null }) }) }),
    }),
  }),
  createActorServiceClient: (actor: { id: string; source: string; impersonationSessionId?: string }) => {
    state.headers = { 'x-actor-id': actor.id, 'x-actor-source': actor.source, ...(actor.impersonationSessionId ? { 'x-impersonation-id': actor.impersonationSessionId } : {}) }
    return {
      from: () => ({
        upsert: (rows: unknown[]) => { state.order.push('write'); state.upserts.push(...rows); return Promise.resolve({ error: null }) },
        delete: () => ({ eq: () => ({ in: (_c: string, keys: string[]) => { state.order.push('delete'); state.deletes.push(keys); return Promise.resolve({ error: null }) } }) }),
      }),
    }
  },
}))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, entry: Record<string, unknown>, _r: unknown, opts?: { required?: boolean }) => {
    state.order.push('audit')
    state.audits.push({ entry, required: opts?.required })
    if (state.auditFail) throw new Error('Audit log unavailable — action refused')
    return true
  },
}))

const { adminEditSurvey, SurveyEditError } = await import('@/lib/admin/survey-admin')
const actor = { id: 'admin-1', kind: 'session' as const, role: 'crm_manager' as const }
const USER = '11111111-2222-3333-4444-555555555555'

describe('adminEditSurvey', () => {
  beforeEach(() => {
    state.existing = [{ question_key: 's1_company_name', step: 1, answer: { value: 'Old LLC' } }, { question_key: 's9n_revenue_2024', step: 9, answer: { value: 100 } }]
    state.upserts = []; state.deletes = []; state.headers = null; state.auditFail = false; state.audits = []; state.order = []
  })

  it('writes old → new to the audit BEFORE changing data, stamped with the actor', async () => {
    const r = await adminEditSurvey(actor, USER, { s1_company_name: 'New LLC', s9n_revenue_2024: null }, null, { reason: 'fix' })
    expect(r).toMatchObject({ updated: 1, deleted: 1 })
    expect(state.order).toEqual(['audit', 'write', 'delete'])
    expect(state.audits[0].required).toBe(true)
    expect(state.audits[0].entry).toMatchObject({
      action: 'user.survey_edited',
      targetUserId: USER,
      oldValue: { s1_company_name: 'Old LLC', s9n_revenue_2024: 100 },
      newValue: { s1_company_name: 'New LLC', s9n_revenue_2024: null },
    })
    expect(state.headers).toEqual({ 'x-actor-id': 'admin-1', 'x-actor-source': 'admin' })
    expect(state.upserts[0]).toMatchObject({ question_key: 's1_company_name', step: 1, answer: { value: 'New LLC' } })
  })

  it('does nothing when the audit cannot be written', async () => {
    state.auditFail = true
    await expect(adminEditSurvey(actor, USER, { s1_company_name: 'X' }, null)).rejects.toThrow(/Audit/)
    expect(state.upserts).toHaveLength(0)
  })

  it('ignores non-survey keys and unchanged values', async () => {
    const r = await adminEditSurvey(actor, USER, { s1_company_name: 'Old LLC', gri_expert_note: 'x' }, null)
    expect(r).toEqual({ updated: 0, deleted: 0, ignored: ['gri_expert_note'] })
    expect(state.audits).toHaveLength(0)
    await expect(adminEditSurvey(actor, USER, { goal_week_v2: 1 }, null)).rejects.toBeInstanceOf(SurveyEditError)
  })

  it('marks impersonation edits', async () => {
    await adminEditSurvey(actor, USER, { s1_company_name: 'Z' }, null, { source: 'impersonation', impersonationSessionId: 'sess-1' })
    expect(state.audits[0].entry.action).toBe('impersonation.survey_edited')
    expect(state.headers).toMatchObject({ 'x-actor-source': 'impersonation', 'x-impersonation-id': 'sess-1' })
  })
})
