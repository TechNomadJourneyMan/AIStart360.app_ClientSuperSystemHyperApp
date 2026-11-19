/**
 * R5 review (wave 1B, M-1) on the real schema: the AI budget tier of lib/ai/budget.ts
 * (readBudgetTier → resolveActor + readEntitlements) for people seeded the way the portal makes
 * them. The reads go to the test DB as the service role: resolveActor's PostgREST fetches and
 * readEntitlements' profiles read + company_inherited_rights() (migration 148) are answered by SQL.
 *   • invited staff (staff_roles row, profiles.role = 'client')   → staff
 *   • active expert (profiles.role = 'expert', approved)           → staff
 *   • legacy profiles.role admin without staff_roles (140)         → free
 *   • free member of a pro company (148, Q3)                       → pro
 *   • free account with a feature_flags override                   → pro
 *   • plain free client                                            → free
 * And with the meter down: the invited staff member goes through, the free client gets 503.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const cur = vi.hoisted(() => ({ db: null as unknown, queue: Promise.resolve() as Promise<unknown> }))
const dbNow = () => cur.db as Db
/** The resolvers read in parallel; one pg client runs one service-role statement at a time. */
function svc<T>(sql: string, args: unknown[]): Promise<{ rows: T[] }> {
  const run = cur.queue.then(() => asService(dbNow(), () => dbNow().query(sql, args)))
  cur.queue = run.catch(() => undefined)
  return run as Promise<{ rows: T[] }>
}

vi.mock('@/lib/settings/store', () => ({ getSetting: async () => undefined }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
            const { rows } = await svc(`SELECT tier, feature_flags FROM public.profiles WHERE id = $1`, [id])
            return { data: rows[0] ?? null, error: null }
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: { p_user: string }) => {
      if (fn !== 'company_inherited_rights') throw new Error(`unexpected rpc ${fn}`)
      const { rows } = await svc<{ r: unknown }>(`SELECT public.company_inherited_rights($1) AS r`, [args.p_user])
      return { data: rows[0].r, error: null }
    },
  }),
}))

/** resolveActor's two PostgREST reads, answered from the test DB as the service role. */
async function postgrest(input: string | URL): Promise<Response> {
  const url = new URL(String(input))
  const table = url.pathname.split('/').pop()
  const id = (url.searchParams.get('id') ?? url.searchParams.get('user_id') ?? '').replace(/^eq\./, '')
  const sql = table === 'profiles' ? `SELECT role, status FROM public.profiles WHERE id = $1 LIMIT 1`
    : table === 'staff_roles' ? `SELECT * FROM public.staff_roles WHERE user_id = $1 LIMIT 1`
      : null
  if (!sql) return new Response('not found', { status: 404 })
  const { rows } = await svc(sql, [id])
  return Response.json(rows)
}

const { readBudgetTier, assertAiBudget, __setAiBudgetDeps, AiBudgetUnavailableError } = await import('@/lib/ai/budget')

const setTier = (db: Db, id: string, tier: 'free' | 'pro', flags: Record<string, boolean> = {}) =>
  db.query(`UPDATE public.profiles SET tier = $2, feature_flags = $3::jsonb WHERE id = $1`, [id, tier, JSON.stringify(flags)])

afterAll(closeTestPool)

describe.skipIf(!dbTestsEnabled)('AI budget tier on the real schema (R5 M-1)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', postgrest)
  })
  afterEach(() => {
    __setAiBudgetDeps(null)
    vi.unstubAllGlobals()
  })

  it('staff from staff_roles / an active expert; paid from overrides and the company tariff; nothing from profiles.role alone', () =>
    inRollback(async (db) => {
      cur.db = db
      const invitedStaff = await seedStaff(db, 'crm_manager')
      expect((await db.query(`SELECT role FROM public.profiles WHERE id = $1`, [invitedStaff])).rows[0].role).toBe('client')
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const legacyAdmin = await seedUser(db, { role: 'admin', status: 'approved' })
      const owner = await seedUser(db, { status: 'approved' })
      await setTier(db, owner, 'pro')
      const company = await seedCompany(db, owner)
      const member = await seedUser(db, { status: 'approved' })
      await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [company, member])
      const overridden = await seedUser(db, { status: 'approved' })
      await setTier(db, overridden, 'free', { ai_chat: true })
      const plain = await seedUser(db, { status: 'approved' })

      expect(await readBudgetTier(invitedStaff)).toBe('staff')
      expect(await readBudgetTier(expert)).toBe('staff')
      expect(await readBudgetTier(legacyAdmin)).toBe('free')
      expect(await readBudgetTier(member)).toBe('pro')
      expect(await readBudgetTier(overridden)).toBe('pro')
      expect(await readBudgetTier(owner)).toBe('pro')
      expect(await readBudgetTier(plain)).toBe('free')

      // The meter is down: staff and paid go through (loudly), the free client gets 503.
      const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
      __setAiBudgetDeps({ readLimitUsd: async () => 1, readSpentTodayUsd: async () => { throw new Error('rpc missing') } })
      await expect(assertAiBudget(invitedStaff, 'ai_chat')).resolves.toBeUndefined()
      await expect(assertAiBudget(member, 'ai_chat')).resolves.toBeUndefined()
      await expect(assertAiBudget(plain, 'ai_chat')).rejects.toBeInstanceOf(AiBudgetUnavailableError)
      loud.mockRestore()
    }))
})
