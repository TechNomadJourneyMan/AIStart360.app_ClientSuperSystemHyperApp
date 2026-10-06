/**
 * Migration 091 on the real database: diagnostics.ai_narrative exists, the
 * one-time move takes legacy narratives out of ai_analysis (and only them),
 * the migration is idempotent, and API roles cannot write either column.
 * Run: TEST_DATABASE_URL=… npx vitest run tests/integration/db/diagnostics-ai-narrative.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'

const MIGRATION = readFileSync(resolve(process.cwd(), 'supabase/migrations/091_diagnostics_ai_narrative.sql'), 'utf8')

const ANALYSIS = { executive_summary: 'Анализ', blocks: { sales: { diagnosis: 'x' } }, strategic_priorities: [], gri: { overall: 6.4 } }
const NARRATIVE = { executive_summary: 'Кратко', strengths_text: 'С', weaknesses_text: 'Сл', risks_text: 'Р', opportunities_text: 'В', next_steps: ['1'] }

async function diagnostic(db: Db, owner: string, company: string, aiAnalysis: unknown, status: string, aiNarrative: unknown = null): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.diagnostics (user_id, company_id, overall_score, is_current, ai_analysis, ai_status, ai_narrative)
     VALUES ($1, $2, 40, FALSE, $3, $4, $5) RETURNING id`,
    [owner, company, aiAnalysis === null ? null : JSON.stringify(aiAnalysis), status, aiNarrative === null ? null : JSON.stringify(aiNarrative)],
  )
  return rows[0].id
}

describe.skipIf(!dbTestsEnabled)('091 diagnostics.ai_narrative', () => {
  afterAll(closeTestPool)

  it('moves legacy narratives out of ai_analysis, leaves analyses alone, and is idempotent', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      const legacy = await diagnostic(db, owner, company, NARRATIVE, 'completed')
      const legacyProcessing = await diagnostic(db, owner, company, NARRATIVE, 'processing')
      const analysis = await diagnostic(db, owner, company, ANALYSIS, 'completed')
      const both = await diagnostic(db, owner, company, NARRATIVE, 'completed', { ...NARRATIVE, executive_summary: 'своя колонка' })

      await db.query(MIGRATION)
      await db.query(MIGRATION) // idempotent

      const row = async (id: string) => (await db.query(`SELECT ai_analysis, ai_narrative, ai_status FROM public.diagnostics WHERE id = $1`, [id])).rows[0]
      expect(await row(legacy)).toEqual({ ai_analysis: null, ai_narrative: NARRATIVE, ai_status: 'none' })
      expect(await row(legacyProcessing)).toEqual({ ai_analysis: null, ai_narrative: NARRATIVE, ai_status: 'processing' })
      expect(await row(analysis)).toEqual({ ai_analysis: ANALYSIS, ai_narrative: null, ai_status: 'completed' })
      // A row that already has its own narrative is not touched.
      expect((await row(both)).ai_analysis).toEqual(NARRATIVE)
      expect((await row(both)).ai_narrative.executive_summary).toBe('своя колонка')
    }))

  it('the owner can read but not write ai_analysis / ai_narrative', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db, { status: 'approved' })
      const company = await seedCompany(db, owner)
      const id = await diagnostic(db, owner, company, ANALYSIS, 'completed')
      const read = await asUser(db, owner, async () => (await db.query(`SELECT ai_narrative FROM public.diagnostics WHERE id = $1`, [id])).rowCount)
      expect(read).toBe(1)
      const write = await asUser(db, owner, async () =>
        (await db.query(`UPDATE public.diagnostics SET ai_narrative = '{"x":1}', ai_analysis = NULL WHERE id = $1`, [id])).rowCount)
      expect(write).toBe(0)
      const { rows } = await db.query(`SELECT ai_analysis, ai_narrative FROM public.diagnostics WHERE id = $1`, [id])
      expect(rows[0]).toEqual({ ai_analysis: ANALYSIS, ai_narrative: null })
    }))
})
