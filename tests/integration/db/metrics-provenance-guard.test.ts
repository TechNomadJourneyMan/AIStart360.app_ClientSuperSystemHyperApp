/**
 * Migration 088 on the real database: public.metrics is written only by the
 * service role. A company owner (or staff, or anon) can no longer insert,
 * update or delete metric rows through their session — so a value cannot be
 * forged with source='document' / confidence 1.0 — while service-role writes
 * (materialisation after tenant authorisation) still land and are still
 * recorded in metric_value_history.
 * Run: npm run test:db:setup && npm run test:db
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'

/** The upsert lib/metrics/materialize.ts sends (ON CONFLICT on metrics_unique_idx). */
const UPSERT = `
  INSERT INTO public.metrics (company_id, metric_key, metric_value, metric_unit, source, confidence, provenance, computed_at)
  VALUES ($1, $2, $3, '₸', $4, $5, $6, now())
  ON CONFLICT (company_id, metric_key, period_year, period_quarter, period_month, scenario, source)
  DO UPDATE SET metric_value = EXCLUDED.metric_value, confidence = EXCLUDED.confidence,
                provenance = EXCLUDED.provenance, computed_at = EXCLUDED.computed_at
  RETURNING id`

async function world(db: Db) {
  const owner = await seedUser(db, { status: 'approved' })
  const company = await seedCompany(db, owner)
  const { rows } = await db.query(
    `INSERT INTO public.metrics (company_id, metric_key, metric_value, source, confidence)
     VALUES ($1, 'biz.marketing.cac', 15000, 'survey', 0.85) RETURNING id`,
    [company],
  )
  return { owner, company, metricId: rows[0].id as string }
}

describe.skipIf(!dbTestsEnabled)('088 metrics provenance guard', () => {
  afterAll(closeTestPool)

  it('an owner cannot insert a metric for their own company (no forged source / confidence)', () =>
    inRollback(async (db) => {
      const { owner, company } = await world(db)
      const forge = asUser(db, owner, () =>
        db.query(UPSERT, [company, 'biz.finansy.vyruchka_god', 999_000_000, 'document', 1.0, JSON.stringify({ picked: { type: 'document' } })]),
      )
      expect(await pgErrorCode(forge)).toBe('42501')
    }))

  it('an owner cannot update or delete existing metric rows', () =>
    inRollback(async (db) => {
      const { owner, metricId } = await world(db)
      const update = asUser(db, owner, () =>
        db.query(`UPDATE public.metrics SET source = 'document', confidence = 1, metric_value = 1 WHERE id = $1`, [metricId]),
      )
      expect(await pgErrorCode(update)).toBe('42501')
      const del = asUser(db, owner, () => db.query(`DELETE FROM public.metrics WHERE id = $1`, [metricId]))
      expect(await pgErrorCode(del)).toBe('42501')
      const { rows } = await db.query(`SELECT metric_value::float AS v, source, confidence::float AS c FROM public.metrics WHERE id = $1`, [metricId])
      expect(rows[0]).toEqual({ v: 15000, source: 'survey', c: 0.85 })
    }))

  it('platform staff and anon cannot write through a session either', () =>
    inRollback(async (db) => {
      const { company, metricId } = await world(db)
      const admin = await seedUser(db, { status: 'approved', role: 'super_admin' })
      expect(await pgErrorCode(asUser(db, admin, () =>
        db.query(`UPDATE public.metrics SET metric_value = 1 WHERE id = $1`, [metricId]),
      ))).toBe('42501')
      expect(await pgErrorCode(asUser(db, null, () =>
        db.query(UPSERT, [company, 'x', 1, 'manual', 1, '{}']),
      ))).toBe('42501')
    }))

  it('the owner still reads their metrics', () =>
    inRollback(async (db) => {
      const { owner, company } = await world(db)
      const rows = await asUser(db, owner, async () =>
        (await db.query(`SELECT metric_key FROM public.metrics WHERE company_id = $1`, [company])).rows,
      )
      expect(rows).toEqual([{ metric_key: 'biz.marketing.cac' }])
    }))

  it('service-role writes land and history records each value change', () =>
    inRollback(async (db) => {
      const { owner, company } = await world(db)
      const provenance = JSON.stringify({ picked: { type: 'survey', key: 's8n_metrics_table' } })
      await asService(db, async () => {
        await db.query(UPSERT, [company, 'biz.prodazhi.sredniy_chek', 45_000, 'survey', 0.85, provenance])
        await db.query(UPSERT, [company, 'biz.prodazhi.sredniy_chek', 45_000, 'survey', 0.85, provenance]) // no-op re-materialisation
        await db.query(UPSERT, [company, 'biz.prodazhi.sredniy_chek', 50_000, 'survey', 0.85, provenance])
      })
      const { rows: current } = await db.query(
        `SELECT metric_value::float AS v FROM public.metrics WHERE company_id = $1 AND metric_key = 'biz.prodazhi.sredniy_chek'`,
        [company],
      )
      expect(current).toEqual([{ v: 50_000 }])
      // The tenant reads the history (can_read_company) — two points, the no-op was not recorded.
      const history = await asUser(db, owner, async () =>
        (await db.query(
          `SELECT value::float AS v, source FROM public.metric_value_history
           WHERE company_id = $1 AND metric_key = 'biz.prodazhi.sredniy_chek' ORDER BY id`,
          [company],
        )).rows,
      )
      expect(history).toEqual([{ v: 45_000, source: 'survey' }, { v: 50_000, source: 'survey' }])
    }))

  it('API roles cannot truncate metrics or their history', () =>
    inRollback(async (db) => {
      const { owner } = await world(db)
      expect(await pgErrorCode(asUser(db, owner, () => db.query(`TRUNCATE public.metrics`)))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => db.query(`TRUNCATE public.metric_value_history`)))).toBe('42501')
    }))
})
