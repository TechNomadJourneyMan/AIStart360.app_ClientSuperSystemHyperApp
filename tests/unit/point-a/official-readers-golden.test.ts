/**
 * I2 (R-033 + R-032) — golden case of the 2026-11-02 audit, through the
 * readers moved to the official Point A: the FULL questionnaire is sent and
 * only «Операции» has answers. Before: «100/100, масштаб» from operations
 * alone (v4 r1), «Финансы 0 — критично» from the v1 row (unanswered = 0).
 * After: operations keeps its score; no overall, no stage, no health; blocks
 * without data are «нет данных» (null) — never 0 — in every path below.
 */
import { describe, expect, it } from 'vitest'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { snapshotView } from '@/lib/point-a/v4/state'
import { officialDiagnosticRow, officialPointA, officialRedBlocks, pointAFromOfficial } from '@/lib/point-a/official'
import { buildReviewContext } from '@/lib/expert-review/ai-draft'
import { buildPointAReportContent, narrativeInputText } from '@/lib/reports/snapshot'
import { calculatePointB } from '@/lib/point-b-engine'
import { calculatePointBV2 } from '@/lib/point-b/engine'
import { diagToPointA } from '@/lib/point-b/adapters'
import { pointAStatHint } from '@/lib/user-dashboard/point-a-hint'
import { inputs } from '../reports/fixtures'

const OPS_ONLY = { s4_has_org_chart: true, s4_has_dept_kpi: true, s4_has_regular_meetings: true, s4_reporting_tool: 'bi', s4_task_manager: 'notion', s4_management_method: 'kpi' }
const v4 = calculatePointAV4({ answers: OPS_ONLY, blocks: effectiveBlocks(DEFAULT_TEMPLATE), surveyComplete: true })

/** What the database may still hold from before R-032/R-033 (old rules, v1 zeros). */
const zero = { score: 0, status: 'critical', top_issues: ['Нет данных о выручке'], recommendations: [] }
const LEGACY_ROW = {
  id: 'd1', overall_score: 100, health_index: 100, stage: 'scale',
  finance_score: zero, sales_score: zero, marketing_score: zero, strategy_score: zero,
  operations_score: { score: 100, status: 'excellent', top_issues: [], recommendations: [] },
  risks: [], insights: [], quick_wins: [], data_gaps: [],
}
const OLD_SNAPSHOT = { engine: 'v4', config_version: 'default@1/r1|v4', blocks: v4.blocks, v4: { assessment: 'full', health_index: 100 }, overall: 100, stage: 'scale', diagnostic_id: 'd1' }
const NEW_SNAPSHOT = { ...OLD_SNAPSHOT, engine: 'v1', config_version: 'default@1/r2|v4', overall: v4.overall, stage: v4.stage }

describe('golden (audit 2026-11-02): full questionnaire, answers on «Операции» only', () => {
  it('the engine: operations 100, NO overall / stage / health (R-032)', () => {
    expect(v4.blocks.find((b) => b.key === 'operations')!.score).toBe(100)
    expect([v4.overall, v4.stage, v4.health_index]).toEqual([null, null, null])
  })

  for (const [name, snap] of [['a snapshot written under the OLD rules (100/100 «scale»)', OLD_SNAPSHOT], ['a new snapshot', NEW_SNAPSHOT]] as const) {
    describe(name, () => {
      const o = officialPointA(LEGACY_ROW, snap)
      const row = officialDiagnosticRow(LEGACY_ROW, o)

      it('official reader: no_score, operations 100, others «нет данных», no red zones from missing data', () => {
        expect(o.state).toBe('no_score')
        expect([o.overall, o.stage, o.health_index]).toEqual([null, null, null])
        expect(o.blocks.find((b) => b.key === 'operations')!.score).toBe(100)
        for (const k of ['finance', 'sales', 'marketing', 'strategy']) expect(o.blocks.find((b) => b.key === k)).toMatchObject({ score: null, status: 'no_data' })
        expect(officialRedBlocks(o)).toEqual([])
        expect(pointAFromOfficial(o)).toBeNull() // no paid AI analysis / no Point B on a missing score
      })

      it('official row (APIs, expert / GIGA screens, MCP, bots): no overall, null blocks, no zeros', () => {
        expect(row).toMatchObject({ overall_score: null, health_index: null, stage: null, finance_score: null, sales_score: null, operations_score: { score: 100 } })
        expect(JSON.stringify(row)).not.toMatch(/"score":0\b/)
      })

      it('expert AI draft context: «нет данных», no «Финансы: 0», no overall', () => {
        const ctx = buildReviewContext({ surveyRows: [], diagnostic: row, gri: null, pointB: null, expertPointB: null })
        expect(ctx.text).toMatch(/Общий балл: нет/)
        expect(ctx.text).toMatch(/Финансы: нет данных/)
        expect(ctx.text).not.toMatch(/Финансы: 0|из 100 \(|Общий балл: 100/)
        expect(ctx.text).toMatch(/Операции: 100/)
      })

      it('report / PDF content: no index, only the block with data', () => {
        const base = inputs()
        const content = buildPointAReportContent({ ...base, diagnostic: { ...row, calculated_at: base.diagnostic.calculated_at } as never, generatedAt: new Date('2026-11-14T00:00:00Z') }).content
        expect(content.diagnostic.overall_score).toBeNull()
        expect(content.diagnostic.health_index).toBeNull()
        expect(content.diagnostic.blocks.map((b) => [b.key, b.score])).toEqual([['operations', 100]])
        expect(narrativeInputText(content)).not.toMatch(/Индекс Точки А|: 0\/100/)
      })

      it('Point B (legacy and v2): no target built on a zero of a block without data', () => {
        const pa = diagToPointA(row)
        const without = o.blocksWithoutData
        const legacy = calculatePointB(pa, {}, { blocksWithoutData: without })
        expect(Object.keys(legacy.target_blocks)).toEqual(['operations'])
        expect(legacy.gap_analysis.map((g) => g.block)).toEqual(['operations'])
        const v2 = calculatePointBV2(pa, {}, { blocksWithoutData: without })
        // target overall over the scored block only (operations 100 → 100), not dragged down by zeros
        expect(v2.target_overall_score).toBe(100)
      })

      it('client home hint: «Балл появится, когда данных хватит»', () => {
        expect(pointAStatHint({ calculatedAt: '2026-11-14T00:00:00Z', overallScore: o.state === 'scored' ? o.overall : null }, (s) => s)).toBe('Балл появится, когда данных хватит')
      })

      it('Point A page (v4 state): no overall / stage / health', () => {
        const view = snapshotView({ id: 's1', created_at: '2026-11-14', ...snap })
        expect([view.overall, view.stage, view.healthIndex]).toEqual([null, null, null])
        expect(view.blocks.find((b) => b.key === 'operations')!.score).toBe(100)
      })
    })
  }
})
