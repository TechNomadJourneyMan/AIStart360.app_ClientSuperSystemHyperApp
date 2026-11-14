/**
 * SR-17 / SR-08 — who the Telegram bots admit and which clients they show,
 * by the rule of migration 140 (lib/access/actor.ts):
 *   • expert bot: an active expert (approved, profiles.role 'expert') or
 *     approved staff Admin / Super Admin / SuperExpert from staff_roles; a
 *     legacy profiles.role admin / super_admin without staff_roles is nobody;
 *   • admin bot: staff ONLY from staff_roles (legacy super_admin is not staff);
 *   • client scope: an expert sees only the clients assigned to them; an
 *     expert without assignments sees nobody; staff by the GIGA scope;
 *   • notices / review requests reach only people who may read the client;
 *   • the report decision is refused for a client not assigned to the reviewer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const EXPERT = 'e0e0e0e0-0000-4000-8000-000000000001'
const OTHER = 'e0e0e0e0-0000-4000-8000-000000000002'
const CLIENT = 'c0c0c0c0-0000-4000-8000-000000000001'

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  assignments: [] as Array<{ user_id: string; company_id: string | null }>,
  coverRows: [] as unknown[],
  fail: false,
  queries: [] as string[],
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      db.queries.push(sql)
      if (db.fail) throw new Error('db down')
      if (sql.includes('JOIN public.user_assignments a ON a.user_id = c.user_id')) return db.coverRows
      if (sql.includes('FROM public.user_assignments a')) return db.assignments
      return db.rows
    }),
    $executeRaw: vi.fn(async () => 1),
  },
}))

const { expertPrincipalOf } = await import('@/lib/telegram/bots/expert/link')
const { linkedStaffOf } = await import('@/lib/telegram/staff-link')
const { botClientScopeOf, loadBrainScope, companyAllowed, NO_CLIENTS } = await import('@/lib/telegram/brain/scope')
const { hearsAboutClient } = await import('@/lib/notifications/expert-audience')
const { actorFromRows, actorReachesClient, isExpertBotActor } = await import('@/lib/access/actor')
const { reviewerCoversCompany } = await import('@/lib/reports/review-flow')

type Row = { role: string | null; status: string; staff_role: string | null; client_scope: string | null }
const row = (role: string | null, staff_role: string | null = null, status = 'approved', client_scope: string | null = null): Row =>
  ({ role, status, staff_role, client_scope })

beforeEach(() => {
  db.rows = []
  db.assignments = []
  db.coverRows = []
  db.fail = false
  db.queries = []
})

describe('expert bot: who is admitted (migration 140)', () => {
  const cases: Array<[string, Row, null | { role: string; clientScope: 'all' | 'assigned' }]> = [
    ['active expert', row('expert'), { role: 'expert', clientScope: 'assigned' }],
    ['expert pending approval', row('expert', null, 'pending_approval'), null],
    ['expert blocked', row('expert', null, 'blocked'), null],
    ['legacy profiles.role admin, no staff_roles', row('admin'), null],
    ['legacy profiles.role super_admin, no staff_roles', row('super_admin'), null],
    ['staff admin (profile client)', row('client', 'admin'), { role: 'admin', clientScope: 'all' }],
    ['staff super_admin', row('client', 'super_admin'), { role: 'super_admin', clientScope: 'all' }],
    ['staff super_expert, scope all', row('client', 'super_expert'), { role: 'super_expert', clientScope: 'all' }],
    ['staff super_expert, scope assigned', row('client', 'super_expert', 'approved', 'assigned'), { role: 'super_expert', clientScope: 'assigned' }],
    ['staff super_expert, not approved', row('client', 'super_expert', 'blocked'), null],
    ['staff crm_manager (no expert role)', row('client', 'crm_manager'), null],
    ['client', row('client'), null],
  ]
  it.each(cases)('%s', (_name, r, expected) => {
    const p = expertPrincipalOf({ user_id: EXPERT, email: null, full_name: null, ...r })
    if (expected === null) expect(p).toBeNull()
    else expect(p).toMatchObject(expected)
  })
})

describe('admin bot: staff only from staff_roles (SR-08)', () => {
  const cases: Array<[string, Row, null | { role: string; clientScope: 'all' | 'assigned' }]> = [
    ['legacy profiles.role super_admin, no staff_roles', row('super_admin'), null],
    ['legacy profiles.role admin, no staff_roles', row('admin'), null],
    ['staff super_admin', row('super_admin', 'super_admin'), { role: 'super_admin', clientScope: 'all' }],
    ['staff admin', row('client', 'admin'), { role: 'admin', clientScope: 'all' }],
    ['staff support, scope assigned', row('client', 'support', 'approved', 'assigned'), { role: 'support', clientScope: 'assigned' }],
    ['staff admin ignores client_scope assigned', row('client', 'admin', 'approved', 'assigned'), { role: 'admin', clientScope: 'all' }],
    ['staff role of a blocked profile', row('client', 'admin', 'blocked'), null],
    ['active expert (not staff)', row('expert'), null],
  ]
  it.each(cases)('%s', (_name, r, expected) => {
    const s = linkedStaffOf({ user_id: EXPERT, profile_role: r.role, status: r.status, staff_role: r.staff_role, client_scope: r.client_scope, email: null })
    if (expected === null) expect(s).toBeNull()
    else expect(s).toMatchObject(expected)
  })
})

describe('client scope of the bots (brain/scope.ts)', () => {
  it.each([
    ['active expert', row('expert'), 'assigned'],
    ['legacy admin without staff_roles', row('admin'), 'none'],
    ['legacy super_admin without staff_roles', row('super_admin'), 'none'],
    ['expert not approved', row('expert', null, 'rejected'), 'none'],
    ['staff analyst (GIGA scope)', row('client', 'analyst'), 'all'],
    ['staff support assigned', row('client', 'support', 'approved', 'assigned'), 'assigned'],
    ['client', row('client'), 'none'],
  ] as const)('%s → %s', (_name, r, expected) => {
    expect(botClientScopeOf(EXPERT, r)).toBe(expected)
  })

  it('loadBrainScope: the assigned expert sees the assigned company; others nothing', async () => {
    db.rows = [row('expert')]
    db.assignments = [{ user_id: CLIENT, company_id: 'co-1' }]
    const scope = await loadBrainScope(EXPERT)
    expect(companyAllowed(scope, 'co-1')).toBe(true)
    expect(companyAllowed(scope, 'co-2')).toBe(false)
  })

  it('loadBrainScope: an expert without assignments sees no client', async () => {
    db.rows = [row('expert')]
    const scope = await loadBrainScope(EXPERT)
    expect(companyAllowed(scope, 'co-1')).toBe(false)
  })

  it('loadBrainScope: a legacy admin is not staff — no client (was ALL before SR-08)', async () => {
    db.rows = [row('admin')]
    expect(await loadBrainScope(EXPERT)).toEqual(NO_CLIENTS)
  })

  it('loadBrainScope fails closed: DB error, unknown person, malformed id', async () => {
    db.fail = true
    expect(await loadBrainScope(EXPERT)).toEqual(NO_CLIENTS)
    db.fail = false
    db.rows = []
    expect(await loadBrainScope(EXPERT)).toEqual(NO_CLIENTS)
    expect(await loadBrainScope('not-a-uuid')).toEqual(NO_CLIENTS)
  })
})

describe('notice audience: only people who may read the client', () => {
  const actor = (r: Row, id = EXPERT) => actorFromRows(id, { profile: { role: r.role, status: r.status }, staff: r.staff_role ? { role: r.staff_role, client_scope: r.client_scope } : null })
  const assignedToMe = { clientUserId: CLIENT, assigneeId: EXPERT }
  const assignedToOther = { clientUserId: CLIENT, assigneeId: OTHER }
  const unassigned = { clientUserId: CLIENT, assigneeId: null }
  it.each([
    ['assigned expert hears about their client', row('expert'), assignedToMe, true],
    ['expert hears nothing about another expert\'s client', row('expert'), assignedToOther, false],
    ['expert hears nothing about an unassigned client', row('expert'), unassigned, false],
    ['expert hears nothing without a client', row('expert'), null, false],
    ['legacy admin hears nothing', row('admin'), assignedToMe, false],
    ['staff admin hears about every client', row('client', 'admin'), assignedToOther, true],
    ['staff super_expert (all) hears without a client', row('client', 'super_expert'), null, true],
    ['staff super_expert (assigned) — only own client', row('client', 'super_expert', 'approved', 'assigned'), assignedToOther, false],
    ['staff crm_manager is not in the expert audience', row('client', 'crm_manager'), assignedToMe, false],
  ] as const)('%s', (_name, r, client, expected) => {
    expect(hearsAboutClient(actor(r), client)).toBe(expected)
  })

  it('actorReachesClient / isExpertBotActor agree with the table', () => {
    expect(isExpertBotActor(actor(row('admin')))).toBe(false)
    expect(actorReachesClient(actor(row('expert')), CLIENT, EXPERT)).toBe(true)
    expect(actorReachesClient(actor(row('expert')), CLIENT, OTHER)).toBe(false)
    expect(actorReachesClient(actor(row('expert')), null, EXPERT)).toBe(false)
  })
})

describe('report decision: the reviewer must cover the client (decideReportReview)', () => {
  const reviewer = (clientScope: 'all' | 'assigned' | 'none') => ({ userId: EXPERT, profileRole: 'expert', staffRole: null, email: null, name: null, clientScope })

  it('assigned expert → may decide', async () => {
    db.coverRows = [{ ok: 1 }]
    expect(await reviewerCoversCompany(reviewer('assigned'), 'co-1')).toBe(true)
  })
  it('expert without assignment to this client → refused', async () => {
    db.coverRows = []
    expect(await reviewerCoversCompany(reviewer('assigned'), 'co-1')).toBe(false)
  })
  it('scope all → no lookup needed; scope none → refused; DB error → refused', async () => {
    expect(await reviewerCoversCompany(reviewer('all'), 'co-1')).toBe(true)
    expect(db.queries).toHaveLength(0)
    expect(await reviewerCoversCompany(reviewer('none'), 'co-1')).toBe(false)
    db.fail = true
    expect(await reviewerCoversCompany(reviewer('assigned'), 'co-1')).toBe(false)
  })
})
