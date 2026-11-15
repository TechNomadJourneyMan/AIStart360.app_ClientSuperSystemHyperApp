/**
 * R3-PA (П5, N7 / R-071): «Минимум для Точки А» is the RULE of the official
 * score (R-032: ≥ 60 % of the blocks' weight with a score, «Финансы» or
 * «Продажи» among them; a block scores at 40 % of its checks) — the old
 * minimum (a list of key questions) could be closed with no score at all.
 */
import { describe, expect, it } from 'vitest'
import { pointAScorePath, scorePathSummary, scoreRuleText, itemsToScore, type ScorePathInputBlock } from '@/lib/point-a/v4/score-path'
import { MIN_OVERALL_WEIGHT_COVERAGE, overallAllowed } from '@/lib/point-a/v4/config'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { computePointAMinimum } from '@/lib/survey/point-a-minimum'
import { stepForQuestionKey } from '@/lib/survey/steps'

/** A block with `answered` of `n` equal checks (max 10 each). */
function block(key: string, weight: number, n: number, answered: number, score: number | null = answered / n >= 0.4 ? 70 : null): ScorePathInputBlock {
  return {
    key, weight, score,
    checks: Array.from({ length: n }, (_, i) => ({ id: `${key}_${i}`, max: 10, answered: i < answered, missing: `Ответить: ${key} ${i}` })),
  }
}

describe('pointAScorePath — the rule of the score', () => {
  it('enough weight and finance scored → data is enough; the survey still has to be sent', () => {
    const p = pointAScorePath([block('finance', 0.4, 5, 3), block('sales', 0.3, 5, 3), block('marketing', 0.3, 5, 0)], { surveySent: false })
    expect(p).toMatchObject({ dataEnough: true, toFill: [], itemsLeft: 0, hasRequired: true, reachable: true })
    expect(p.weightShare).toBeCloseTo(0.7)
    expect(scorePathSummary(p)).toBe('Данных для оценки хватает — осталось отправить анкету.')
    expect(scorePathSummary({ ...p, surveySent: true })).toBeNull()
  })

  it('60 % of the weight but neither finance nor sales → NOT enough: the cheapest required block is named', () => {
    const p = pointAScorePath([
      block('finance', 0.2, 5, 0), block('sales', 0.2, 10, 0), block('marketing', 0.3, 5, 3), block('operations', 0.3, 5, 3),
    ], { surveySent: true })
    expect(p.dataEnough).toBe(false)
    expect(p.hasRequired).toBe(false)
    // finance needs 2 of 5 (40 %), sales 4 of 10 — the rule takes the cheaper one
    expect(p.toFill.map((b) => [b.key, b.items, b.required])).toEqual([['finance', 2, true]])
    expect(p.itemsLeft).toBe(2)
    expect(p.toFill[0].needs).toEqual(['Ответить: finance 0', 'Ответить: finance 1'])
    expect(scorePathSummary(p)).toBe('До оценки осталось 2 пункта: «Финансы» — 2.')
  })

  it('too little weight → the cheapest SET of blocks reaching 60 %, and «отправить анкету» when not sent', () => {
    const p = pointAScorePath([
      block('finance', 0.25, 4, 2), block('sales', 0.25, 5, 0), block('marketing', 0.25, 10, 0), block('operations', 0.25, 5, 1),
    ], { surveySent: false })
    expect(p.dataEnough).toBe(false)
    // 25 % scored; +sales (2 items) + operations (1 item) = 75 % — cheaper than marketing (4)
    expect(p.toFill.map((b) => b.key).sort()).toEqual(['operations', 'sales'])
    expect(p.itemsLeft).toBe(3)
    expect(scorePathSummary(p)).toMatch(/^До оценки осталось 3 пункта: .*— и отправить анкету\.$/)
  })

  it('a block whose checks can never reach 40 % is not offered; nothing reachable → said so', () => {
    expect(itemsToScore({ key: 'x', weight: 1, score: null, checks: [{ id: 'a', max: 10, answered: false, excluded: true }] })).toBeNull()
    const p = pointAScorePath([block('finance', 0.7, 5, 0), { key: 'sales', weight: 0.3, score: null, checks: [] }], { surveySent: true })
    expect(p.reachable).toBe(true)
    expect(p.toFill.map((b) => b.key)).toEqual(['finance'])
    // 50 / 50 with sales impossible: finance alone is not 60 % → unreachable, said so
    const half = pointAScorePath([block('finance', 0.5, 5, 0), { key: 'sales', weight: 0.5, score: null, checks: [] }], { surveySent: true })
    expect(half.reachable).toBe(false)
    const none = pointAScorePath([{ key: 'finance', weight: 0.5, score: null, checks: [] }, { key: 'sales', weight: 0.5, score: null, checks: [] }], { surveySent: true })
    expect(none.reachable).toBe(false)
    expect(scorePathSummary(none)).toMatch(/^До оценки не хватает данных/)
  })

  it('informational blocks do not count; no weighted blocks (legacy rows) → nothing to judge by', () => {
    const p = pointAScorePath([{ ...block('team', 0, 5, 0), informational: true }, block('finance', 1, 5, 3)], { surveySent: true })
    expect(p.dataEnough).toBe(true)
    expect(pointAScorePath([], { surveySent: true }).dataEnough).toBe(true)
  })

  it('the rule text names the threshold and the required blocks', () => {
    const p = pointAScorePath([block('finance', 1, 5, 3)], { surveySent: true })
    expect(scoreRuleText(p)).toBe(`оценка появляется, когда блоки с данными покрывают не меньше ${MIN_OVERALL_WEIGHT_COVERAGE * 100} % веса и среди них есть «Финансы» или «Продажи»`)
  })
})

describe('the path agrees with the engine (the score really appears)', () => {
  it('a client who closed the old «минимум» but has no finance / sales data: the old counter says done, the rule says what is missing', () => {
    // The old key questions: operations / marketing / strategy toggles and texts — no finance, no sales numbers.
    const answers: Record<string, unknown> = {
      s4_has_org_chart: true, s4_has_dept_kpi: true, s4_has_regular_meetings: true, s4_reporting_tool: 'excel', s4_task_manager: 'trello',
      s5_marketing_budget_pct: 5, s5_marketing_channels: ['instagram'], s5_target_audience: 'b2c', s5_has_competitor_analysis: true, s5_usp: 'скорость',
      s6_goal_3years: 'x', s6_goal_12months: 'y', s6_main_pain: 'z', s6_growth_blockers: 'w', s3_has_loyalty: true, s2_knows_breakeven: true,
    }
    const old = computePointAMinimum(answers, (k) => stepForQuestionKey(k))
    expect(old.answered).toBeGreaterThan(0)
    const v4 = calculatePointAV4({ answers, blocks: effectiveBlocks(DEFAULT_TEMPLATE), surveyComplete: true })
    const path = pointAScorePath(v4.blocks, { surveySent: true })
    // the path's verdict is the engine's own rule
    expect(path.dataEnough).toBe(v4.overall !== null)
    expect(path.dataEnough).toBe(overallAllowed(v4.blocks.filter((b) => !b.informational)))
    if (!path.dataEnough) expect(path.itemsLeft).toBeGreaterThan(0)
  })

  it('answering exactly the named items gives the block a score', () => {
    const b = block('finance', 0.5, 7, 1, null)
    const need = itemsToScore(b)!
    const filled = { ...b, checks: b.checks.map((c, i) => (i < 1 + need.items ? { ...c, answered: true } : c)) }
    const answered = filled.checks.filter((c) => c.answered).length
    expect(answered / 7).toBeGreaterThanOrEqual(0.4)
    expect((answered - 1) / 7).toBeLessThan(0.4)
  })
})
