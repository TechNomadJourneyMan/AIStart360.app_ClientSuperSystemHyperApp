import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  existing: [] as Array<{ question_key: string; step: number; answer: { value: unknown } }>,
  upserts: [] as unknown[],
  deletes: [] as string[][],
  headers: null as Record<string, string> | null,
  auditFail: false,
  audits: [] as Array<{ entry: Record<string, unknown>; required?: boolean }>,
  order: [] as string[],
  /** companies row of the edited user (null → no company yet). */
  company: { id: 'co-1' } as { id: string } | null,
  companyLookups: [] as Array<[string, unknown]>,
  events: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => table === 'companies'
      // announceSurveyChange: the company whose Point A the edit recalculates
      ? {
          select: () => ({
            eq: (col: string, v: unknown) => {
              state.companyLookups.push([col, v])
              return { maybeSingle: () => Promise.resolve({ data: state.company, error: null }) }
            },
          }),
        }
      : { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: state.existing, error: null }) }) }) },
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
vi.mock('@/lib/events/platform', () => ({
  emitPlatformEventSafely: (e: Record<string, unknown>) => { state.order.push('event'); state.events.push(e) },
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
    state.company = { id: 'co-1' }; state.companyLookups = []; state.events = []
  })

  it('writes old → new to the audit BEFORE changing data, stamped with the actor', async () => {
    const r = await adminEditSurvey(actor, USER, { s1_company_name: 'New LLC', s9n_revenue_2024: null }, null, { reason: 'fix' })
    expect(r).toMatchObject({ updated: 1, deleted: 1 })
    expect(state.order).toEqual(['audit', 'write', 'delete', 'event'])
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

  it('a staff edit asks for the Point A recalculation of the client\'s company (SURVEY_ANSWER_CHANGED, by staff)', async () => {
    await adminEditSurvey(actor, USER, { s1_company_name: 'New LLC', s9n_revenue_2024: null }, null)
    expect(state.companyLookups).toEqual([['user_id', USER]])
    expect(state.events).toHaveLength(1)
    const e = state.events[0]
    expect(e).toMatchObject({
      name: 'SURVEY_ANSWER_CHANGED', companyId: 'co-1', subjectType: 'survey', subjectId: USER,
      actor: 'user:admin-1', payload: { keys: ['s1_company_name', 's9n_revenue_2024'], by: 'staff' },
    })
    expect(String(e.dedupeKey)).toMatch(/^survey_changed:co-1:staff:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('no company yet → the edit is saved, no recalculation is asked for; no change → no event', async () => {
    state.company = null
    const r = await adminEditSurvey(actor, USER, { s1_company_name: 'New LLC' }, null)
    expect(r).toMatchObject({ updated: 1 })
    expect(state.events).toHaveLength(0)
    state.company = { id: 'co-1' }
    await adminEditSurvey(actor, USER, { s1_company_name: 'Old LLC' }, null)
    expect(state.events).toHaveLength(0)
  })

  it('does nothing when the audit cannot be written', async () => {
    state.auditFail = true
    await expect(adminEditSurvey(actor, USER, { s1_company_name: 'X' }, null)).rejects.toThrow(/Audit/)
    expect(state.upserts).toHaveLength(0)
    expect(state.events).toHaveLength(0)
  })

  it('ignores non-survey keys and unchanged values', async () => {
    const r = await adminEditSurvey(actor, USER, { s1_company_name: 'Old LLC', gri_expert_note: 'x' }, null)
    expect(r).toEqual({ updated: 0, deleted: 0, ignored: ['gri_expert_note'] })
    expect(state.audits).toHaveLength(0)
    await expect(adminEditSurvey(actor, USER, { goal_week_v2: 1 }, null)).rejects.toBeInstanceOf(SurveyEditError)
  })

  it('stores a «не знаю» / «примерно» mark as its own envelope (never nested, never a delete)', async () => {
    const r = await adminEditSurvey(actor, USER, {
      s9n_revenue_2024: { value: null, unknown: true },
      s9n_net_profit: { value: 15, approx: true, range: [10, 20] },
    }, null)
    expect(r).toMatchObject({ updated: 2, deleted: 0 })
    expect(state.upserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ question_key: 's9n_revenue_2024', answer: { value: null, unknown: true } }),
      expect.objectContaining({ question_key: 's9n_net_profit', answer: { value: 15, approx: true, range: [10, 20] } }),
    ]))
    expect(state.audits[0].entry).toMatchObject({ oldValue: { s9n_revenue_2024: 100 }, newValue: { s9n_revenue_2024: { value: null, unknown: true } } })
  })

  it('marks impersonation edits', async () => {
    await adminEditSurvey(actor, USER, { s1_company_name: 'Z' }, null, { source: 'impersonation', impersonationSessionId: 'sess-1' })
    expect(state.audits[0].entry.action).toBe('impersonation.survey_edited')
    expect(state.headers).toMatchObject({ 'x-actor-source': 'impersonation', 'x-impersonation-id': 'sess-1' })
    expect(state.events).toEqual([expect.objectContaining({ name: 'SURVEY_ANSWER_CHANGED', companyId: 'co-1', actor: 'user:admin-1' })])
  })
})
