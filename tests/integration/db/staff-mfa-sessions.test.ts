/**
 * SR-01: staff / expert rights in RLS need a live GoTrue session that passed
 * the portal second factor (migration 143, public.staff_session_ok()).
 *
 * Before: a stolen staff password → token from GoTrue → every staff right
 * through PostgREST; a revoked session's JWT kept them until `exp`.
 *
 * Real policies on the disposable test DB (scripts/test-db/setup.mjs); every
 * case runs in a transaction that is rolled back.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedSession, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

interface World {
  ownerA: string
  ownerB: string
  companyA: string
  companyB: string
}

async function world(db: Db): Promise<World> {
  const ownerA = await seedUser(db, { status: 'approved' })
  const ownerB = await seedUser(db, { status: 'approved' })
  const companyA = await seedCompany(db, ownerA, 'Company A')
  const companyB = await seedCompany(db, ownerB, 'Company B')
  for (const [owner, company] of [[ownerA, companyA], [ownerB, companyB]] as const) {
    await db.query(`INSERT INTO public.diagnostics (user_id, company_id, overall_score) VALUES ($1, $2, 50)`, [owner, company])
    await db.query(
      `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type)
       VALUES ($1, $2, 'p&l.xlsx', 'https://x/storage/v1/object/a', 'financial_report')`,
      [owner, company],
    )
    await db.query(
      `INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer)
       VALUES ($1, $2, 1, 's1_company_name', '{"value":"x"}')`,
      [owner, company],
    )
  }
  return { ownerA, ownerB, companyA, companyB }
}

type Seen = { companies: string[]; survey: string[]; documents: string[]; diagnostics: string[]; profiles: string[] }

/** Owners (of the two) whose rows the caller sees, per table — as PostgREST with `sessionId`. */
async function seen(db: Db, uid: string, w: World, sessionId?: string | null): Promise<Seen> {
  const owners = [w.ownerA, w.ownerB]
  return asUser(
    db,
    uid,
    async () => {
      const q = async (sql: string) =>
        Array.from(new Set((await db.query(sql, [owners])).rows.map((r) => r.owner as string))).sort()
      return {
        companies: await q(`SELECT user_id::text AS owner FROM public.companies WHERE user_id = ANY($1)`),
        survey: await q(`SELECT user_id::text AS owner FROM public.survey_answers WHERE user_id = ANY($1)`),
        documents: await q(`SELECT user_id::text AS owner FROM public.documents WHERE user_id = ANY($1)`),
        diagnostics: await q(`SELECT user_id::text AS owner FROM public.diagnostics WHERE user_id = ANY($1)`),
        profiles: await q(`SELECT id::text AS owner FROM public.profiles WHERE id = ANY($1)`),
      }
    },
    { sessionId },
  )
}

const none: Seen = { companies: [], survey: [], documents: [], diagnostics: [], profiles: [] }
/** Everything of both clients; foreign profiles only for staff admins (profiles_admin_select, 140). */
const all = (w: World, admin = true): Seen => {
  const both = [w.ownerA, w.ownerB].sort()
  return { companies: both, survey: both, documents: both, diagnostics: both, profiles: admin ? both : [] }
}
const isAdminRole = (role: string) => role === 'super_admin' || role === 'admin'

async function requireMfa(db: Db, value: unknown = true) {
  await db.query(
    `INSERT INTO public.system_settings (key, value) VALUES ('staff_require_mfa', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(value)],
  )
}

/** What the server writes when the step-up passes (lib/mfa/step-up-session.ts). */
async function stepUp(db: Db, uid: string, sessionId: string, ttl = "interval '12 hours'") {
  await db.query(
    `INSERT INTO public.staff_mfa_sessions (session_id, user_id, verified_at, expires_at, method)
     VALUES ($1, $2, now(), now() + ${ttl}, 'totp')`,
    [sessionId, uid],
  )
}

async function staffFlag(db: Db, uid: string, sessionId?: string | null) {
  return asUser(
    db,
    uid,
    async () => (await db.query(`SELECT public.is_platform_staff() AS s, public.staff_session_ok() AS ok`)).rows[0] as { s: boolean; ok: boolean },
    { sessionId },
  )
}

describe.skipIf(!dbTestsEnabled)('SR-01: staff RLS rights need a live session with the step-up (143)', () => {
  afterAll(closeTestPool)

  it('2FA mandatory: staff without the step-up record read no foreign client; with it — everything, as before', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await requireMfa(db)
      for (const role of ['super_admin', 'admin', 'crm_manager', 'support', 'super_expert']) {
        const staff = await seedStaff(db, role)
        const sid = await seedSession(db, staff)
        expect(await seen(db, staff, w, sid), role).toEqual(none)
        expect(await staffFlag(db, staff, sid), role).toEqual({ s: false, ok: false })
        await stepUp(db, staff, sid)
        expect(await seen(db, staff, w, sid), role).toEqual(all(w, isAdminRole(role)))
        expect(await staffFlag(db, staff, sid), role).toEqual({ s: true, ok: true })
      }
    }))

  it('the setting stored as {"enabled": true} counts too', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await requireMfa(db, { enabled: true })
      const admin = await seedStaff(db, 'admin')
      expect(await seen(db, admin, w)).toEqual(none)
    }))

  it('a record of another session, an expired record or a record of another user grant nothing', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await requireMfa(db)
      const admin = await seedStaff(db, 'admin')
      const other = await seedStaff(db, 'admin')
      const sid = await seedSession(db, admin)
      const sid2 = await seedSession(db, admin, { fresh: true })
      await stepUp(db, admin, sid2)
      expect(await seen(db, admin, w, sid)).toEqual(none)

      const sid3 = await seedSession(db, admin, { fresh: true })
      await db.query(
        `INSERT INTO public.staff_mfa_sessions (session_id, user_id, verified_at, expires_at)
         VALUES ($1, $2, now() - interval '13 hours', now() - interval '1 hour')`,
        [sid3, admin],
      )
      expect(await seen(db, admin, w, sid3)).toEqual(none)

      const otherSid = await seedSession(db, other)
      await stepUp(db, other, otherSid)
      // `admin` presenting the other admin's session id: the session is not theirs.
      expect(await seen(db, admin, w, otherSid)).toEqual(none)
    }))

  it('SR-04 window: a revoked session (gone from auth.sessions) or one past not_after reads nothing, even with a record', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const admin = await seedStaff(db, 'admin')
      // 2FA not mandatory, no factor: a live session alone is enough…
      const sid = await seedSession(db, admin)
      expect(await seen(db, admin, w, sid)).toEqual(all(w))
      // …until GoTrue deletes it (sign-out / «завершить все сессии»).
      await stepUp(db, admin, sid)
      await db.query(`DELETE FROM auth.sessions WHERE id = $1`, [sid])
      expect(await seen(db, admin, w, sid)).toEqual(none)
      // A session id that never existed.
      expect(await seen(db, admin, w, randomUUID())).toEqual(none)
      // A time-boxed session past its end.
      const late = await seedSession(db, admin, { notAfter: new Date(Date.now() - 60_000) })
      await stepUp(db, admin, late)
      expect(await seen(db, admin, w, late)).toEqual(none)
      // A token without session_id, or a malformed one.
      expect(await seen(db, admin, w, null)).toEqual(none)
      expect(await seen(db, admin, w, 'nosid')).toEqual(none)
    }))

  it('2FA not mandatory: staff WITH a factor (TOTP, passkey or the app_metadata flag) need the step-up; without one — as before', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const plain = await seedStaff(db, 'admin')
      expect(await seen(db, plain, w)).toEqual(all(w))

      const totp = await seedStaff(db, 'admin')
      await db.query(`INSERT INTO public.user_security (user_id, totp_enabled) VALUES ($1, TRUE)`, [totp])
      const passkey = await seedStaff(db, 'super_expert')
      await db.query(`INSERT INTO public.webauthn_credentials (id, user_id, public_key) VALUES ($1, $2, 'pk')`, [randomUUID(), passkey])
      const flagged = await seedStaff(db, 'crm_manager')
      await db.query(`UPDATE auth.users SET raw_app_meta_data = '{"mfa_totp": true}'::jsonb WHERE id = $1`, [flagged])

      for (const [uid, admin] of [[totp, true], [passkey, false], [flagged, false]] as const) {
        const sid = await seedSession(db, uid)
        expect(await seen(db, uid, w, sid)).toEqual(none)
        await stepUp(db, uid, sid)
        expect(await seen(db, uid, w, sid)).toEqual(all(w, admin))
      }
    }))

  it('experts: the same rule over their assigned clients', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await requireMfa(db)
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      await db.query(`INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2)`, [w.ownerA, expert])
      const sid = await seedSession(db, expert)
      const v0 = await seen(db, expert, w, sid)
      expect(v0.survey).toEqual([])
      expect(v0.companies).toEqual([])
      expect(await asUser(db, expert, async () => (await db.query(`SELECT public.is_active_expert() AS e`)).rows[0].e, { sessionId: sid })).toBe(false)

      await stepUp(db, expert, sid)
      const v1 = await seen(db, expert, w, sid)
      expect(v1.companies).toEqual([w.ownerA])
      expect(v1.documents).toEqual([w.ownerA])
      expect(await asUser(db, expert, async () => (await db.query(`SELECT public.is_active_expert() AS e`)).rows[0].e, { sessionId: sid })).toBe(true)

      await db.query(`DELETE FROM auth.sessions WHERE id = $1`, [sid])
      expect((await seen(db, expert, w, sid)).companies).toEqual([])
    }))

  it('regression: clients see their own data exactly as before — no step-up, no session record needed', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await requireMfa(db)
      // The client even has a factor of their own and no record.
      await db.query(`INSERT INTO public.user_security (user_id, totp_enabled) VALUES ($1, TRUE)`, [w.ownerA])
      const own = { companies: [w.ownerA], survey: [w.ownerA], documents: [w.ownerA], diagnostics: [w.ownerA], profiles: [w.ownerA] }
      expect(await seen(db, w.ownerA, w)).toEqual(own)
      // Even a token without session_id (owner policies do not look at it).
      expect(await seen(db, w.ownerA, w, null)).toEqual(own)
      // And writes to their own survey still work.
      const upd = await asUser(db, w.ownerA, () =>
        db.query(`UPDATE public.survey_answers SET answer = '{"value":"z"}' WHERE user_id = $1`, [w.ownerA]),
      )
      expect(upd.rowCount).toBe(1)
    }))

  it('the record table is server-only: API roles neither read nor forge it', () =>
    inRollback(async (db) => {
      const admin = await seedStaff(db, 'admin')
      const sid = await seedSession(db, admin)
      expect(await pgErrorCode(asUser(db, admin, () => db.query(`SELECT * FROM public.staff_mfa_sessions`)))).toBe('42501')
      expect(
        await pgErrorCode(
          asUser(db, admin, () =>
            db.query(
              `INSERT INTO public.staff_mfa_sessions (session_id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
              [sid, admin],
            ),
          ),
        ),
      ).toBe('42501')
      expect(await pgErrorCode(asUser(db, null, () => db.query(`SELECT * FROM public.staff_mfa_sessions`)))).toBe('42501')
    }))

  it('anon and a client never pass staff_session_ok() into staff rights', () =>
    inRollback(async (db) => {
      const client = await seedUser(db, { status: 'approved' })
      const sid = await seedSession(db, client)
      await stepUp(db, client, sid)
      expect(await staffFlag(db, client, sid)).toEqual({ s: false, ok: true })
      expect(await asUser(db, null, async () => (await db.query(`SELECT public.staff_session_ok() AS ok`)).rows[0].ok)).toBe(false)
    }))
})
