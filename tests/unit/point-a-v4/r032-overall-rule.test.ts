/**
 * R-032 (PO 2026-11-14): the overall score and stage of Point A appear only
 * when (a) the full questionnaire is sent, (b) the scored blocks cover
 * ≥ MIN_OVERALL_WEIGHT_COVERAGE of the block weight and (c) «Финансы» or
 * «Продажи» is among them. Otherwise overall / stage / health are null and
 * the blocks with data keep their scores. Thresholds: lib/point-a/v4/config.ts
 * (temporary until the expert approves them).
 */
import { describe, expect, it } from 'vitest'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, MIN_OVERALL_WEIGHT_COVERAGE, OVERALL_REQUIRED_ANY_OF, effectiveBlocks } from '@/lib/point-a/v4/config'
import { officialDiagnosticRow, officialPointA } from '@/lib/point-a/official'
import { CURRENT_FULL_STRONG, CURRENT_TYPICAL, LEGACY_STRONG, LEGACY_WEAK } from '../point-a/fixtures/answer-sets'

const blocks = effectiveBlocks(DEFAULT_TEMPLATE)
const v4 = (answers: Record<string, unknown>, surveyComplete = true) => calculatePointAV4({ answers, blocks, surveyComplete })

/** The audit example: the full questionnaire sent, answers on «Операции» only. */
export const OPS_ONLY = { s4_has_org_chart: true, s4_has_dept_kpi: true, s4_has_regular_meetings: true, s4_reporting_tool: 'bi', s4_task_manager: 'notion', s4_management_method: 'kpi' }
const FIN_ONLY = { s9n_revenue_2024: 100_000_000, s9n_change_vs_2023: '+25%', s9n_net_margin: 35, s9n_debts_amount: 0, s9n_breakeven_point: 5_000_000 }
const MARKETING = { s5_marketing_channels: ['SEO', 'Контекстная реклама', 'Email-рассылка'], s5_marketing_budget_pct: 6, s5_has_competitor_analysis: true }

describe('R-032: when Point A has an overall score', () => {
  it('the thresholds are named constants (temporary, until the expert approves)', () => {
    expect(MIN_OVERALL_WEIGHT_COVERAGE).toBe(0.6)
    expect(OVERALL_REQUIRED_ANY_OF).toEqual(['finance', 'sales'])
  })

  it('GOLDEN: 6 answers on «Операции» only → operations 100, NO overall, NO stage, NO health (was 100/100 «масштаб»)', () => {
    const r = v4(OPS_ONLY)
    expect(r.assessment).toBe('full')
    expect(r.blocks.find((b) => b.key === 'operations')!.score).toBe(100)
    expect(r.overall).toBeNull()
    expect(r.stage).toBeNull()
    expect(r.health_index).toBeNull()
    // The official reader: «no score», the block with data keeps its score, no zeros.
    const o = officialPointA({ id: 'd', overall_score: null, health_index: null, stage: null }, { engine: 'v1', config_version: 'default@1/r2|v4', blocks: r.blocks, v4: { assessment: 'full' }, overall: r.overall, stage: r.stage })
    expect(o.state).toBe('no_score')
    expect(o.overall).toBeNull()
    expect(o.blocks.find((b) => b.key === 'operations')!.score).toBe(100)
    expect(o.blocks.filter((b) => b.key !== 'operations').every((b) => b.score === null && b.status === 'no_data')).toBe(true)
    const row = officialDiagnosticRow({ overall_score: 100, stage: 'scale', finance_score: { score: 0 }, operations_score: { score: 100 } }, o)
    expect(row).toMatchObject({ overall_score: null, stage: null, finance_score: null, operations_score: { score: 100 } })
  })

  it('coverage below 60 % with finance → no overall (finance + operations = 40 %)', () => {
    expect(v4({ ...FIN_ONLY, ...OPS_ONLY }).overall).toBeNull()
  })

  it('≥ 60 % but neither finance nor sales → no overall', () => {
    const noFinSales = calculatePointAV4({
      answers: { ...OPS_ONLY, ...MARKETING, s2n_goal_12m_what: 'Вторая точка', s2n_goal_3y_what: 'Сеть', s6_main_pain: 'Нет системы' },
      // finance and sales present in the configuration, but without data
      blocks: effectiveBlocks(DEFAULT_TEMPLATE, { expertOverrides: { operations: { weight: 0.9 } } }),
    })
    const scored = noFinSales.blocks.filter((b) => !b.informational && b.score !== null)
    expect(scored.some((b) => b.key === 'finance' || b.key === 'sales')).toBe(false)
    expect(scored.reduce((s, b) => s + b.weight, 0)).toBeGreaterThanOrEqual(0.6)
    expect(noFinSales.overall).toBeNull()
  })

  it('≥ 60 % with finance → an overall over the scored blocks only', () => {
    const r = v4({ ...CURRENT_TYPICAL, ...MARKETING })
    expect(r.blocks.find((b) => b.key === 'sales')!.score).toBeNull()
    expect(r.overall).not.toBeNull()
    expect(r.stage).not.toBeNull()
  })

  it('before the full questionnaire → never an overall', () => {
    expect(v4(CURRENT_FULL_STRONG, false).overall).toBeNull()
  })

  // Typical scenarios (default template) — the I2 report counts them.
  it.each([
    ['CURRENT_FULL_STRONG (every step)', CURRENT_FULL_STRONG, true],
    ['LEGACY_STRONG', LEGACY_STRONG, true],
    ['LEGACY_WEAK', LEGACY_WEAK, true],
    ['CURRENT_TYPICAL (steps 1, 2, 4, 9, 12 — no sales, no marketing)', CURRENT_TYPICAL, false],
    ['operations only', OPS_ONLY, false],
    ['finance only', FIN_ONLY, false],
    ['finance + operations', { ...FIN_ONLY, ...OPS_ONLY }, false],
  ] as const)('%s → overall %s', (_name, answers, scored) => {
    expect(v4(answers as Record<string, unknown>).overall !== null).toBe(scored)
  })
})
