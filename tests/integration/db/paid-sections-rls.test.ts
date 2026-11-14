/**
 * R2-A (ревью H-4), migration 147: the tariff at the database level. With the
 * gates on, a Free client reading his OWN rows of a paid section straight
 * through PostgREST (his JWT + the public anon key) gets nothing; Pro, a
 * per-user override, staff and «gates off» read as before; the free data
 * (questionnaire, documents, company) is untouched; the service role (the
 * express «Снимок», the home tile) still reads everything.
 *
 * Real schema and policies of the disposable test DB; every case runs in a
 * transaction that is rolled back.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

interface World { client: string; company: string }

async function world(db: Db, gates: boolean | null = true): Promise<World> {
  if (gates !== null) {
    await db.query(
      `INSERT INTO public.system_settings (key, value) VALUES ('access_gates', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(gates)],
    )
  } else {
    await db.query(`DELETE FROM public.system_settings WHERE key = 'access_gates'`)
  }
  const client = await seedUser(db, { status: 'approved' })
  const company = await seedCompany(db, client)
  await db.query(`INSERT INTO public.diagnostics (user_id, company_id, overall_score, ai_analysis) VALUES ($1, $2, 61, '{"summary":"paid"}'::jsonb)`, [client, company])
  await db.query(
    `INSERT INTO public.point_a_snapshots (company_id, engine, overall, blocks, inputs_hash, config_version) VALUES ($1, 'v4', 61, '[]'::jsonb, 'h', 'v')`,
    [company],
  )
  await db.query(
    `INSERT INTO public.gri_assessments (user_id, company_id, gri_index, action_plan_90d) VALUES ($1, $2, 6.5, '{"1-30":["paid step"]}'::jsonb)`,
    [client, company],
  )
  await db.query(`INSERT INTO public.action_items (user_id, title, source) VALUES ($1, 'GRI step', 'plan'), ($1, 'Point B step', 'point_b')`, [client])
  await db.query(`INSERT INTO public.market_analysis_answers (user_id, question_key, block, source) VALUES ($1, 'a1', 'A', 'user')`, [client])
  await db.query(`INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer) VALUES ($1, $2, 1, 's1_company_name', '{"value":"x"}')`, [client, company])
  await db.query(
    `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type) VALUES ($1, $2, 'p&l.xlsx', 'https://x/storage/v1/object/a', 'financial_report')`,
    [client, company],
  )
  return { client, company }
}

type Seen = Record<string, number>

/** How many of the client's rows `uid` sees per table, as PostgREST would. */
async function seen(db: Db, uid: string, w: World): Promise<Seen> {
  return asUser(db, uid, async () => {
    const n = async (sql: string, args: unknown[]) => Number((await db.query(sql, args)).rows[0].n)
    return {
      diagnostics: await n(`SELECT count(*) AS n FROM public.diagnostics WHERE user_id = $1`, [w.client]),
      point_a_snapshots: await n(`SELECT count(*) AS n FROM public.point_a_snapshots WHERE company_id = $1`, [w.company]),
      gri_assessments: await n(`SELECT count(*) AS n FROM public.gri_assessments WHERE user_id = $1`, [w.client]),
      action_items_gri: await n(`SELECT count(*) AS n FROM public.action_items WHERE user_id = $1 AND source = 'plan'`, [w.client]),
      action_items_point_b: await n(`SELECT count(*) AS n FROM public.action_items WHERE user_id = $1 AND source = 'point_b'`, [w.client]),
      market: await n(`SELECT count(*) AS n FROM public.market_analysis_answers WHERE user_id = $1`, [w.client]),
      survey_answers: await n(`SELECT count(*) AS n FROM public.survey_answers WHERE user_id = $1`, [w.client]),
      documents: await n(`SELECT count(*) AS n FROM public.documents WHERE user_id = $1`, [w.client]),
      companies: await n(`SELECT count(*) AS n FROM public.companies WHERE id = $1`, [w.company]),
    }
  })
}

const PAID_NONE = { diagnostics: 0, point_a_snapshots: 0, gri_assessments: 0, action_items_gri: 0, action_items_point_b: 0, market: 0 }
const PAID_ALL = { diagnostics: 1, point_a_snapshots: 1, gri_assessments: 1, action_items_gri: 1, action_items_point_b: 1, market: 1 }
const FREE_DATA = { survey_answers: 1, documents: 1, companies: 1 }

describe.skipIf(!dbTestsEnabled)('paid sections at the database level (147)', () => {
  afterAll(closeTestPool)

  it('Free with the gates on: no paid row of his own through PostgREST; the free data stays', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      expect(await seen(db, w.client, w)).toEqual({ ...PAID_NONE, ...FREE_DATA })
    })
  })

  it('Pro reads everything as before', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
      expect(await seen(db, w.client, w)).toEqual({ ...PAID_ALL, ...FREE_DATA })
    })
  })

  it('a per-user override opens one section (and an explicit false closes it for Pro)', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await db.query(`UPDATE public.profiles SET feature_flags = '{"point_a": true, "point_b": true}'::jsonb WHERE id = $1`, [w.client])
      expect(await seen(db, w.client, w)).toMatchObject({ diagnostics: 1, point_a_snapshots: 1, action_items_point_b: 1, gri_assessments: 0, action_items_gri: 0, market: 0 })
      await db.query(`UPDATE public.profiles SET tier = 'pro', feature_flags = '{"gri_full": false}'::jsonb WHERE id = $1`, [w.client])
      expect(await seen(db, w.client, w)).toMatchObject({ diagnostics: 1, gri_assessments: 0, action_items_gri: 0, market: 1 })
    })
  })

  it('gates off (false or no row — the default) → nothing is restricted', async () => {
    await inRollback(async (db) => {
      const w = await world(db, false)
      expect(await seen(db, w.client, w)).toEqual({ ...PAID_ALL, ...FREE_DATA })
    })
    await inRollback(async (db) => {
      const w = await world(db, null)
      expect(await seen(db, w.client, w)).toEqual({ ...PAID_ALL, ...FREE_DATA })
    })
  })

  it('the service role (express «Снимок», home tile) still reads a Free client\'s Point A', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      const n = await asService(db, async () => Number((await db.query(`SELECT count(*) AS n FROM public.point_a_snapshots WHERE company_id = $1`, [w.company])).rows[0].n))
      expect(n).toBe(1)
    })
  })

  it('has_paid_section: staff of the session and an active expert pass; anon and an unknown section never', async () => {
    await inRollback(async (db) => {
      await world(db, true)
      const admin = await seedStaff(db, 'admin')
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      const free = await seedUser(db, { status: 'approved' })
      const fn = async (uid: string | null, section: string) =>
        asUser(db, uid, async () => (await db.query(`SELECT public.has_paid_section($1) AS ok`, [section])).rows[0].ok as boolean)
      expect(await fn(admin, 'point_a')).toBe(true)
      expect(await fn(expert, 'gri_full')).toBe(true)
      expect(await fn(free, 'point_a')).toBe(false)
      expect(await fn(free, 'nonsense')).toBe(false)
    })
  })

  it('a Free client cannot open the section for himself (tier / feature_flags are guarded)', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      const err = await asUser(db, w.client, async () => {
        await db.query('SAVEPOINT up')
        try {
          await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
          return null
        } catch (e) {
          await db.query('ROLLBACK TO SAVEPOINT up')
          return (e as { code?: string }).code ?? 'error'
        }
      })
      expect(err).not.toBeNull()
      expect(await seen(db, w.client, w)).toMatchObject(PAID_NONE)

    })
  })
})
