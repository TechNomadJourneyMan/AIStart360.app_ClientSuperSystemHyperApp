/**
 * Migration 106 on real Postgres: billing_set_plan() is the single write path
 * for a plan and keeps subscriptions and profiles.tier consistent; the expiry
 * functions are idempotent; only the service role may call them.
 * Every test fails on a database built without 106 (the functions do not exist).
 * Run: node scripts/test-db/setup.mjs --db aistart360_w8 && TEST_DATABASE_URL=… npx vitest run tests/integration/db/billing-unify.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'

const DAY = 864e5

interface PlanArgs {
  org: string
  user: string | null
  tier: string
  end?: Date | null
  source?: string
  provider?: string | null
  note?: string | null
  actor?: string
  onlyIfExpired?: boolean
  now?: Date
  paymentTx?: string | null
}

/** Service-role call inside a savepoint, so a refused call leaves the transaction usable. */
async function asServiceSafe<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT svc')
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
  await db.query('SET LOCAL ROLE service_role')
  try {
    const out = await fn()
    await db.query('RESET ROLE')
    await db.query('RELEASE SAVEPOINT svc')
    return out
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT svc')
    throw err
  }
}

async function setPlan(db: Db, a: PlanArgs) {
  const { rows } = await asServiceSafe(db, () => db.query(
    `SELECT public.billing_set_plan($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS r`,
    [a.org, a.user, a.tier, a.end ?? null, a.source ?? 'admin', a.provider ?? null, a.note ?? null, a.actor ?? 'staff-1', a.onlyIfExpired ?? false, a.now ?? new Date(), a.paymentTx ?? null],
  ))
  return rows[0].r as { applied: boolean; reason?: string; profile_tier: string | null; kept_access?: boolean; after: Record<string, unknown> | null }
}

async function sub(db: Db, org: string) {
  const { rows } = await db.query(
    `SELECT tier::text, status::text, provider::text, "trialEndsAt", "currentPeriodEnd", source, note, "assignedBy" FROM public.subscriptions WHERE "orgId" = $1`,
    [org],
  )
  return rows[0] as Record<string, unknown> | undefined
}

async function profileTier(db: Db, user: string): Promise<string> {
  const { rows } = await db.query(`SELECT tier FROM public.profiles WHERE id = $1`, [user])
  return rows[0].tier as string
}

async function insertSub(db: Db, org: string, tier: string, status: string, trialEndsAt: Date | null, periodEnd: Date | null) {
  await db.query(
    `INSERT INTO public.subscriptions (id, "orgId", tier, status, "trialEndsAt", "currentPeriodEnd", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2::"SubscriptionTier", $3::"SubscriptionStatus",
             ($4::timestamptz AT TIME ZONE 'UTC'), ($5::timestamptz AT TIME ZONE 'UTC'), now() AT TIME ZONE 'UTC')`,
    [org, tier, status, trialEndsAt, periodEnd],
  )
}

describe.skipIf(!dbTestsEnabled)('billing unify (106)', () => {
  afterAll(closeTestPool)

  it('an admin plan lands in subscriptions AND profiles.tier in one call', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      const end = new Date(Date.now() + 90 * DAY)
      const r = await setPlan(db, { org: company, user, tier: 'enterprise', end, note: 'договор №7' })
      expect(r.applied).toBe(true)
      expect(r.profile_tier).toBe('pro')
      const s = await sub(db, company)
      expect(s).toMatchObject({ tier: 'enterprise', status: 'active', provider: null, source: 'admin', note: 'договор №7', assignedBy: 'staff-1' })
      // TIMESTAMP WITHOUT TIME ZONE holds UTC.
      const { rows } = await db.query(`SELECT ("currentPeriodEnd" = ($2::timestamptz AT TIME ZONE 'UTC')) AS same FROM public.subscriptions WHERE "orgId" = $1`, [company, end])
      expect(rows[0].same).toBe(true)
      expect(await profileTier(db, user)).toBe('pro')
    }))

  it('free cancels the row and closes access; a trial needs an end date', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      await setPlan(db, { org: user, user, tier: 'pilot', end: new Date(Date.now() + 30 * DAY), source: 'trial' })
      expect(await sub(db, user)).toMatchObject({ tier: 'pilot', status: 'trialing', source: 'trial', currentPeriodEnd: null })
      expect(await profileTier(db, user)).toBe('pro')

      await setPlan(db, { org: user, user, tier: 'free' })
      expect(await sub(db, user)).toMatchObject({ tier: 'pilot', status: 'canceled', source: 'admin' })
      expect(await profileTier(db, user)).toBe('free')

      expect(await pgErrorCode(setPlan(db, { org: user, user, tier: 'pilot', end: null }))).toBe('22023')
      expect(await pgErrorCode(setPlan(db, { org: user, user, tier: 'gold' }))).toBe('22023')
      expect(await pgErrorCode(setPlan(db, { org: user, user, tier: 'pro', source: 'paypal' }))).toBe('22023')
    }))

  it('an unknown profile is refused and nothing is written', () =>
    inRollback(async (db) => {
      const ghost = '99999999-0000-0000-0000-000000000000'
      expect(await pgErrorCode(setPlan(db, { org: ghost, user: ghost, tier: 'pro' }))).toBe('P0002')
      expect(await sub(db, ghost)).toBeUndefined()
    }))

  it('Kaspi: a company tenant key is upgraded with its owner', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      const r = await setPlan(db, { org: company, user, tier: 'pro', end: new Date(Date.now() + 31 * DAY), source: 'kaspi', provider: 'kaspi', actor: 'kaspi:webhook' })
      expect(r.applied).toBe(true)
      expect(await sub(db, company)).toMatchObject({ tier: 'pro', status: 'active', provider: 'kaspi', source: 'kaspi' })
      expect(await profileTier(db, user)).toBe('pro')
    }))

  it('Kaspi: the payment is marked succeeded with the plan, and a repeated callback adds nothing', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      await db.query(
        `INSERT INTO public.payment_transactions (id, "orgId", provider, amount, currency, status, "planKey")
         VALUES ('tx-dup', $1, 'kaspi'::"AcquiringProvider", 30000, 'USD', 'pending'::"PaymentStatus", 'pro_monthly')`,
        [company],
      )
      const first = new Date(Date.now() + 31 * DAY)
      const r1 = await setPlan(db, { org: company, user, tier: 'pro', end: first, source: 'kaspi', provider: 'kaspi', actor: 'kaspi:webhook', paymentTx: 'tx-dup' })
      expect(r1.applied).toBe(true)
      const { rows } = await db.query(`SELECT status::text FROM public.payment_transactions WHERE id = 'tx-dup'`)
      expect(rows[0].status).toBe('succeeded')
      const endAfterFirst = (await sub(db, company))?.currentPeriodEnd

      // The retry computes a period one month further — it must not land.
      const r2 = await setPlan(db, { org: company, user, tier: 'pro', end: new Date(first.getTime() + 31 * DAY), source: 'kaspi', provider: 'kaspi', actor: 'kaspi:webhook', paymentTx: 'tx-dup' })
      expect(r2).toMatchObject({ applied: false, reason: 'payment_already_final' })
      expect((await sub(db, company))?.currentPeriodEnd).toEqual(endAfterFirst)
    }))

  it('expiry: due rows are listed with their owner; the downgrade applies once', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      const other = await seedUser(db, { status: 'approved' })
      await setPlan(db, { org: company, user, tier: 'pro', end: new Date(Date.now() + DAY) })
      await setPlan(db, { org: other, user: other, tier: 'pro', end: new Date(Date.now() + 10 * DAY) })
      const later = new Date(Date.now() + 2 * DAY)

      const due = await asService(db, () => db.query(`SELECT * FROM public.billing_due_expirations($1, 100)`, [later]))
      const mine = due.rows.filter((r) => r.org_id === company || r.org_id === other)
      expect(mine).toEqual([expect.objectContaining({ org_id: company, user_id: user, tier: 'pro', status: 'active' })])

      // Not expired at "now" → no-op even with the expiry guard.
      expect((await setPlan(db, { org: company, user, tier: 'free', source: 'system', onlyIfExpired: true })).applied).toBe(false)
      expect(await profileTier(db, user)).toBe('pro')

      const first = await setPlan(db, { org: company, user, tier: 'free', source: 'system', actor: 'system:billing-expiry', onlyIfExpired: true, now: later })
      expect(first.applied).toBe(true)
      expect(await sub(db, company)).toMatchObject({ status: 'canceled', source: 'system', assignedBy: 'system:billing-expiry' })
      expect(await profileTier(db, user)).toBe('free')

      const second = await setPlan(db, { org: company, user, tier: 'free', source: 'system', onlyIfExpired: true, now: later })
      expect(second).toMatchObject({ applied: false, reason: 'not_expired' })
      const again = await asService(db, () => db.query(`SELECT * FROM public.billing_due_expirations($1, 100)`, [later]))
      expect(again.rows.some((r) => r.org_id === company)).toBe(false)
    }))

  it('an extension made before the job runs wins over the stale due list', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      await insertSub(db, user, 'pro', 'active', null, new Date(Date.now() - DAY))
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [user])
      await setPlan(db, { org: user, user, tier: 'pro', end: new Date(Date.now() + 30 * DAY) })
      const r = await setPlan(db, { org: user, user, tier: 'free', source: 'system', onlyIfExpired: true })
      expect(r.applied).toBe(false)
      expect(await profileTier(db, user)).toBe('pro')
    }))

  it('two tenant keys of one person: a deliberate change supersedes, expiry keeps paid access', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, user)
      // Old trial under the user key (expired), paid plan under the company key.
      await insertSub(db, user, 'pilot', 'trialing', new Date(Date.now() - DAY), null)
      await setPlan(db, { org: company, user, tier: 'pro', end: null, source: 'kaspi', provider: 'kaspi', onlyIfExpired: false })
      // The deliberate Kaspi change cancelled the stale trial row.
      expect(await sub(db, user)).toMatchObject({ status: 'canceled' })

      // Re-open the stale trial and let the job see it: Pro access stays.
      await db.query(`UPDATE public.subscriptions SET status = 'trialing' WHERE "orgId" = $1`, [user])
      const r = await setPlan(db, { org: user, user, tier: 'free', source: 'system', onlyIfExpired: true })
      expect(r).toMatchObject({ applied: true, kept_access: true, profile_tier: 'pro' })
      expect(await profileTier(db, user)).toBe('pro')
      expect(await sub(db, company)).toMatchObject({ status: 'active' })
    }))

  it('legacy rows get a source; clients cannot call the billing functions', () =>
    inRollback(async (db) => {
      const user = await seedUser(db, { status: 'approved' })
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'subscriptions_source_check'`)
      expect(rows[0].n).toBe(1)
      expect(await pgErrorCode(asUser(db, user, () =>
        db.query(`SELECT public.billing_set_plan($1, $2::uuid, 'enterprise', NULL, 'admin')`, [user, user])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, null, () =>
        db.query(`SELECT * FROM public.billing_due_expirations(now(), 10)`)))).toBe('42501')
    }))
})
