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
 *
 * R2-C, migration 148: (Q3) a member of a company inherits the paid rights of
 * the company's owner — the same rule as the portal (paid-access-one-rule.test.ts);
 * (M-4) the expert's report, review, comments and the findings are Точка А.
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

describe.skipIf(!dbTestsEnabled)('paid sections at the database level (147, 148)', () => {
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

  // ─── R2-C, migration 148 ──────────────────────────────────────────────────

  /** A Free member of the client's company (company_members, migration 084). */
  async function member(db: Db, w: World, opts: { role?: string; status?: string; flags?: Record<string, boolean> } = {}): Promise<string> {
    const uid = await seedUser(db, { status: 'approved' })
    await db.query(`INSERT INTO public.company_members (company_id, user_id, role, status) VALUES ($1, $2, $3, $4)`, [w.company, uid, opts.role ?? 'member', opts.status ?? 'active'])
    if (opts.flags) await db.query(`UPDATE public.profiles SET feature_flags = $2::jsonb WHERE id = $1`, [uid, JSON.stringify(opts.flags)])
    return uid
  }
  const sectionsOf = async (db: Db, uid: string) =>
    asUser(db, uid, async () => {
      const out: Record<string, boolean> = {}
      for (const s of ['point_a', 'point_b', 'market', 'gri_full']) out[s] = (await db.query(`SELECT public.has_paid_section($1) AS ok`, [s])).rows[0].ok as boolean
      return out
    })
  const ALL_OPEN = { point_a: true, point_b: true, market: true, gri_full: true }
  const ALL_CLOSED = { point_a: false, point_b: false, market: false, gri_full: false }

  it('Q3: a Free member of a Pro company inherits every paid section and reads the company\'s paid rows', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
      for (const role of ['admin', 'member', 'viewer', 'owner']) {
        const m = await member(db, w, { role })
        expect(await sectionsOf(db, m), role).toEqual(ALL_OPEN)
      }
      const m = await member(db, w)
      // the tenant policies of 084 let a member read the company rows; the paid policy no longer hides them
      expect(await seen(db, m, w)).toMatchObject({ diagnostics: 1, point_a_snapshots: 1, gri_assessments: 1 })
    })
  })

  it('Q3: a member of a Free company gets nothing; an invited / removed membership gives nothing', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      const m = await member(db, w)
      expect(await sectionsOf(db, m)).toEqual(ALL_CLOSED)
      expect(await seen(db, m, w)).toMatchObject({ diagnostics: 0, point_a_snapshots: 0, gri_assessments: 0 })
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
      for (const status of ['invited', 'removed']) {
        const x = await member(db, w, { status })
        expect(await sectionsOf(db, x), status).toEqual(ALL_CLOSED)
      }
    })
  })

  it('Q3: the member\'s own explicit false still closes a section; the owner\'s override is inherited per section', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
      const m = await member(db, w, { flags: { market: false } })
      expect(await sectionsOf(db, m)).toEqual({ ...ALL_OPEN, market: false })
      // a Free owner with Точка А opened individually: the member inherits exactly that section
      await db.query(`UPDATE public.profiles SET tier = 'free', feature_flags = '{"point_a": true}'::jsonb WHERE id = $1`, [w.client])
      expect(await sectionsOf(db, m)).toEqual({ ...ALL_CLOSED, point_a: true })
      // the owner's own explicit false is not inherited as «open» either
      await db.query(`UPDATE public.profiles SET tier = 'pro', feature_flags = '{"gri_full": false}'::jsonb WHERE id = $1`, [w.client])
      expect(await sectionsOf(db, m)).toEqual({ ...ALL_OPEN, market: false, gri_full: false })
    })
  })

  it('Q3: company_inherited_rights answers only about the caller himself (service role: anybody)', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
      const m = await member(db, w)
      const stranger = await seedUser(db, { status: 'approved' })
      const rights = async (asUid: string | 'service', about: string) => {
        const q = async () => (await db.query(`SELECT public.company_inherited_rights($1) AS r`, [about])).rows[0].r as Record<string, boolean>
        return asUid === 'service' ? asService(db, q) : asUser(db, asUid, q)
      }
      expect(await rights(m, m)).toMatchObject({ point_a: true, market: true, gri_full: true, gri_full_unlimited: true })
      expect(await rights(stranger, m)).toMatchObject({ point_a: false, point_b: false, market: false, gri_full: false })
      expect(await rights('service', m)).toMatchObject({ point_a: true, gri_full_unlimited: true })
      // the owner inherits nothing from his own company
      expect(await rights(w.client, w.client)).toMatchObject({ point_a: false })
      // anon may not call it at all
      const anon = await asUser(db, null, async () => {
        await db.query('SAVEPOINT anon_call')
        try {
          await db.query(`SELECT public.company_inherited_rights($1)`, [m])
          return null
        } catch (e) {
          await db.query('ROLLBACK TO SAVEPOINT anon_call')
          return (e as { code?: string }).code ?? 'error'
        }
      })
      expect(anon).toBe('42501')
    })
  })

  /** A published report with a review, an expert comment and a finding visible to the client. */
  async function report(db: Db, w: World): Promise<void> {
    const expert = await seedUser(db, { role: 'expert', status: 'approved' })
    await db.query(
      `INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by, published_at)
       VALUES ($1, 'point_a', 1, 'published', 'Точка А', '{"findings":[]}'::jsonb, '{}'::jsonb, 'h', 'test', now())`,
      [w.company],
    )
    await db.query(`INSERT INTO public.expert_reviews (user_id, author_id, status, title, published_at) VALUES ($1, $2, 'published', 'Разбор', now())`, [w.client, expert])
    await db.query(`INSERT INTO public.expert_comments (client_id, author_id, text, status, published_at) VALUES ($1, $2, 'paid note', 'published', now())`, [w.client, expert])
    await db.query(
      `INSERT INTO public.diagnostic_findings (company_id, kind, area, title, provenance_type, confidence, produced_by)
       VALUES ($1, 'risk', 'sales', 'paid finding', 'CALCULATED', 0.9, 'engine:test')`,
      [w.company],
    )
  }
  const reportSeen = async (db: Db, uid: string, w: World) =>
    asUser(db, uid, async () => {
      const n = async (sql: string, args: unknown[]) => Number((await db.query(sql, args)).rows[0].n)
      return {
        report_versions: await n(`SELECT count(*) AS n FROM public.report_versions WHERE company_id = $1`, [w.company]),
        expert_reviews: await n(`SELECT count(*) AS n FROM public.expert_reviews WHERE user_id = $1`, [w.client]),
        expert_comments: await n(`SELECT count(*) AS n FROM public.expert_comments WHERE client_id = $1`, [w.client]),
        diagnostic_findings: await n(`SELECT count(*) AS n FROM public.diagnostic_findings WHERE company_id = $1`, [w.company]),
      }
    })
  const REPORT_ALL = { report_versions: 1, expert_reviews: 1, expert_comments: 1, diagnostic_findings: 1 }
  const REPORT_NONE = { report_versions: 0, expert_reviews: 0, expert_comments: 0, diagnostic_findings: 0 }

  it('M-4: Free does not read his published report, the expert\'s review / comments or the findings; Pro does', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await report(db, w)
      expect(await reportSeen(db, w.client, w)).toEqual(REPORT_NONE)
      await db.query(`UPDATE public.profiles SET feature_flags = '{"point_a": true}'::jsonb WHERE id = $1`, [w.client])
      expect(await reportSeen(db, w.client, w)).toEqual(REPORT_ALL)
      await db.query(`UPDATE public.profiles SET tier = 'pro', feature_flags = '{}'::jsonb WHERE id = $1`, [w.client])
      expect(await reportSeen(db, w.client, w)).toEqual(REPORT_ALL)
    })
    await inRollback(async (db) => {
      const w = await world(db, false) // gates off → as before
      await report(db, w)
      expect(await reportSeen(db, w.client, w)).toEqual(REPORT_ALL)
    })
  })

  it('M-4: staff and the service role (review flow, PDFs, the home card) still read the report of a Free client', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await report(db, w)
      const admin = await seedStaff(db, 'admin')
      // an expert reads the clients assigned to him (scope of 140) — the paid policy does not hide them
      const expert = await seedUser(db, { role: 'expert', status: 'approved' })
      await db.query(`INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2)`, [w.client, expert])
      for (const staff of [admin, expert]) {
        expect(await asUser(db, staff, async () => Number((await db.query(`SELECT count(*) AS n FROM public.report_versions WHERE company_id = $1`, [w.company])).rows[0].n))).toBe(1)
        expect(await asUser(db, staff, async () => Number((await db.query(`SELECT count(*) AS n FROM public.diagnostic_findings WHERE company_id = $1`, [w.company])).rows[0].n))).toBe(1)
      }
      // the expert's comments of a Free client: the platform admin and the assigned expert (expert_read_all)
      for (const staff of [admin, expert]) {
        expect(await asUser(db, staff, async () => Number((await db.query(`SELECT count(*) AS n FROM public.expert_comments WHERE client_id = $1`, [w.client])).rows[0].n))).toBe(1)
      }
      const n = await asService(db, async () => Number((await db.query(`SELECT count(*) AS n FROM public.report_versions WHERE company_id = $1`, [w.company])).rows[0].n))
      expect(n).toBe(1)
    })
  })

  it('M-4 + Q3: a member of a Pro company reads the company report', async () => {
    await inRollback(async (db) => {
      const w = await world(db, true)
      await report(db, w)
      const m = await member(db, w)
      expect(await reportSeen(db, m, w)).toMatchObject({ report_versions: 0, diagnostic_findings: 0 })
      await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = $1`, [w.client])
      expect(await reportSeen(db, m, w)).toMatchObject({ report_versions: 1, diagnostic_findings: 1 })
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
