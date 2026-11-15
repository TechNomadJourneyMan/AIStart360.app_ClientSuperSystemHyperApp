/**
 * R2-C (Q3): ONE rule for the portal and for the database. For a matrix of
 * members / owners (own tier, own overrides, the owner's tier and overrides,
 * the membership) the portal's decision — lib/access/server.ts readEntitlements
 * (incl. company_inherited_rights of migration 148) + lib/access/decision.ts
 * decideFeature — must equal has_paid_section() of the database for the same
 * person, section by section. The portal side reads the real test DB through a
 * minimal PostgREST-like client bound to the person's session.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'
import { readEntitlements } from '@/lib/access/server'
import { decideFeature } from '@/lib/access/decision'
import { PAID_SECTIONS } from '@/lib/access/entitlements'

/** The calls readEntitlements makes, executed as the person (RLS, auth.uid()). */
function sessionClient(db: Db, uid: string) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
            return asUser(db, uid, async () => ({ data: (await db.query(`SELECT tier, feature_flags FROM public.profiles WHERE id = $1`, [id])).rows[0] ?? null, error: null }))
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: { p_user: string }) => {
      if (fn !== 'company_inherited_rights') throw new Error(`unexpected rpc ${fn}`)
      return asUser(db, uid, async () => ({ data: (await db.query(`SELECT public.company_inherited_rights($1) AS r`, [args.p_user])).rows[0].r, error: null }))
    },
  }
}

interface Case {
  name: string
  own: { tier: 'free' | 'pro'; flags: Record<string, boolean> }
  owner: { tier: 'free' | 'pro'; flags: Record<string, boolean> }
  membership: 'active' | 'invited' | 'removed' | 'none'
  role?: 'owner' | 'admin' | 'member' | 'viewer'
}

const CASES: Case[] = [
  { name: 'free member of a pro company', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: {} }, membership: 'active' },
  { name: 'viewer of a pro company', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: {} }, membership: 'active', role: 'viewer' },
  { name: 'co-owner row of a pro company', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: {} }, membership: 'active', role: 'owner' },
  { name: 'free member of a free company', own: { tier: 'free', flags: {} }, owner: { tier: 'free', flags: {} }, membership: 'active' },
  { name: 'invited (not active) to a pro company', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: {} }, membership: 'invited' },
  { name: 'removed from a pro company', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: {} }, membership: 'removed' },
  { name: 'no membership at all', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: {} }, membership: 'none' },
  { name: 'member with an own explicit false', own: { tier: 'free', flags: { market: false, point_a: false } }, owner: { tier: 'pro', flags: {} }, membership: 'active' },
  { name: 'member with an own explicit true', own: { tier: 'free', flags: { point_b: true } }, owner: { tier: 'free', flags: {} }, membership: 'active' },
  { name: 'free owner with one section opened', own: { tier: 'free', flags: {} }, owner: { tier: 'free', flags: { point_a: true, market: true } }, membership: 'active' },
  { name: 'pro owner with one section closed', own: { tier: 'free', flags: {} }, owner: { tier: 'pro', flags: { gri_full: false } }, membership: 'active' },
  { name: 'pro member of a free company', own: { tier: 'pro', flags: {} }, owner: { tier: 'free', flags: {} }, membership: 'active' },
]

describe.skipIf(!dbTestsEnabled)('one paid-access rule for the portal and the database (148)', () => {
  afterAll(closeTestPool)

  for (const c of CASES) {
    it(c.name, async () => {
      await inRollback(async (db) => {
        await db.query(
          `INSERT INTO public.system_settings (key, value) VALUES ('access_gates', 'true'::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        )
        const owner = await seedUser(db, { status: 'approved' })
        const company = await seedCompany(db, owner)
        await db.query(`UPDATE public.profiles SET tier = $2, feature_flags = $3::jsonb WHERE id = $1`, [owner, c.owner.tier, JSON.stringify(c.owner.flags)])
        const person = await seedUser(db, { status: 'approved' })
        await db.query(`UPDATE public.profiles SET tier = $2, feature_flags = $3::jsonb WHERE id = $1`, [person, c.own.tier, JSON.stringify(c.own.flags)])
        if (c.membership !== 'none') {
          await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, $3, $4)`, [company, person, c.role ?? 'member', c.membership])
        }

        const ent = await readEntitlements(sessionClient(db, person) as never, person)
        const portal = Object.fromEntries(PAID_SECTIONS.map((s) => [s, decideFeature({ gatesEnabled: true, ent }, s).allowed]))
        const database = await asUser(db, person, async () => {
          const out: Record<string, boolean> = {}
          for (const s of PAID_SECTIONS) out[s] = (await db.query(`SELECT public.has_paid_section($1) AS ok`, [s])).rows[0].ok as boolean
          return out
        })
        expect(portal).toEqual(database)
      })
    })
  }

  it('the matrix is not trivial: both «open» and «closed» answers occur', async () => {
    // guards the test itself — a broken setup that answers the same for everything would pass above
    await inRollback(async (db) => {
      await db.query(`INSERT INTO public.system_settings (key, value) VALUES ('access_gates', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [owner])
      const person = await seedUser(db, { status: 'approved' })
      const before = await readEntitlements(sessionClient(db, person) as never, person)
      expect(before.point_a).toBe(false)
      await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [company, person])
      const after = await readEntitlements(sessionClient(db, person) as never, person)
      expect(after.point_a).toBe(true)
    })
  })
})
