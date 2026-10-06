/**
 * Migration 102 on the real database: exactly the metric rows whose resolver
 * provenance names a REMOVED (metric, source) pair are deleted — in metrics and
 * in metric_value_history — and nothing else; rows of metrics whose unit
 * changed get the new unit. Also checks that the pair list in the migration is
 * the diff of the declarations: every listed pair is absent from the current
 * registry (a pair still declared would delete a legitimate value).
 * Run: npm run test:db:setup && npm run test:db
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { closeTestPool, inRollback, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'
import { getMetricById } from '@/lib/metrics/registry'

const MIGRATION_102 = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/102_metrics_overhaul.sql'), 'utf8')

async function metric(db: Db, company: string, key: string, value: number, picked: Record<string, unknown> | null, source = 'survey', unit = '₸') {
  await db.query(
    `INSERT INTO public.metrics (company_id, metric_key, metric_value, metric_unit, source, confidence, provenance, computed_at)
     VALUES ($1, $2, $3, $4, $5, 0.9, $6, now())`,
    [company, key, value, unit, source, picked ? JSON.stringify({ picked }) : null],
  )
}

function listedPairs(fn: string): string[][] {
  const body = MIGRATION_102.split(`pg_temp.${fn}()`)[1]?.split('$$')[1] ?? ''
  return [...body.matchAll(/\(([^()]+)\)/g)].map((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]))
}

describe('102: the pair list is the diff of the declarations', () => {
  it('no listed (metric, source) pair is still declared by the registry', () => {
    const survey = listedPairs('removed_survey_sources_102')
    const docs = listedPairs('removed_document_sources_102')
    expect(survey.length).toBe(303)
    expect(docs.length).toBe(27)
    const stillDeclared: string[] = []
    for (const [metricKey, key] of survey) {
      const e = getMetricById(metricKey)
      if (e?.sources.some((s) => s.type === 'survey' && s.key === key && !s.coerce)) stillDeclared.push(`${metricKey} ← ${key}`)
    }
    for (const [metricKey, docType, field] of docs) {
      const e = getMetricById(metricKey)
      if (e?.sources.some((s) => s.type === 'document' && s.field === field && (s.doc_type ?? '') === docType)) stillDeclared.push(`${metricKey} ← ${docType}.${field}`)
    }
    expect(stillDeclared).toEqual([])
  })
})

describe.skipIf(!dbTestsEnabled)('102: wrongly-sourced metric values', () => {
  afterAll(closeTestPool)

  it('deletes only the removed pairs (metrics + history), keeps declared sources, fixes units; idempotent', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      // removed sources → deleted
      await metric(db, company, 'goal.01.stoimost_lida_cpl', 3_000_000, { type: 'survey', step: 9, key: 's9n_expense_marketing' })
      await metric(db, company, 'goal.01.raskhody_na_reklamu', 8, { type: 'survey', step: 7, key: 's5_marketing_budget_pct' })
      await metric(db, company, 'biz.prodazhi.win_rate', 420, { type: 'survey', step: 5, key: 's3_deals_2025' }, 'survey', '%')
      await metric(db, company, 'biz.klienty.churn_rate', 810, { type: 'survey', step: 5, key: 's5n_will_return_nps' }, 'survey', '%')
      await metric(db, company, 'biz.finansy.roa', 9_500_000, { type: 'document', doc_type: 'pl_report', field: 'net_profit' }, 'document', '')
      await metric(db, company, 'gri.komanda', 5, { type: 'survey', step: 4, key: 's4_dept_count' }, 'survey', '')
      // still declared / not resolver rows → kept
      await metric(db, company, 'biz.marketing.cac', 15_000, { type: 'survey', step: 8, key: 's8n_metrics_table', coerce: { kind: 'table_cell', row: 'cac' } })
      await metric(db, company, 'biz.finansy.vyruchka_god', 72_000_000, { type: 'document', doc_type: 'pl_report', field: 'revenue' }, 'document')
      await metric(db, company, 'biz.marketing.nps', 42, { type: 'survey', step: 7, key: 's7_nps_score' }, 'survey', '%')
      await metric(db, company, 'goal.01.stoimost_privlecheniya_cac', 20_000, null)

      await db.query(MIGRATION_102)
      await db.query(MIGRATION_102) // idempotent

      const { rows } = await db.query(
        `SELECT metric_key, metric_value::float AS v, metric_unit AS unit FROM public.metrics WHERE company_id = $1 ORDER BY metric_key`, [company])
      expect(rows).toEqual([
        { metric_key: 'biz.finansy.vyruchka_god', v: 72_000_000, unit: '₸' },
        { metric_key: 'biz.marketing.cac', v: 15_000, unit: '₸' },
        { metric_key: 'biz.marketing.nps', v: 42, unit: null }, // NPS is an index, not «%»
        { metric_key: 'goal.01.stoimost_privlecheniya_cac', v: 20_000, unit: '₸' },
      ])
      const { rows: history } = await db.query(
        `SELECT metric_key, value::float AS v FROM public.metric_value_history WHERE company_id = $1 ORDER BY metric_key, v`, [company])
      expect(history).toEqual(rows.map(({ metric_key, v }) => ({ metric_key, v })))
    }))
})
