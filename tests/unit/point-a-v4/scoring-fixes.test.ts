import { describe, it, expect } from 'vitest'
import { pointAChecks } from '@/lib/point-a-engine'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'

const blocks = effectiveBlocks(DEFAULT_TEMPLATE)
const v4 = (answers: Record<string, unknown>, surveyComplete = true) => calculatePointAV4({ answers, blocks, surveyComplete })
const check = (answers: Record<string, unknown>, block: string, id: string, surveyComplete = true) =>
  v4(answers, surveyComplete).blocks.find((b) => b.key === block)!.checks.find((c) => c.id === id)!
const margin = (answers: Record<string, unknown>) => pointAChecks(answers).finance.find((c) => c.id === 'margin')!

describe('net margin has its own thresholds (interim, for the expert to approve)', () => {
  it('8 % net margin — a normal retail result — is not «низкая маржинальность <30 %»', () => {
    const m = margin({ s9n_net_margin: 8 })
    expect(m.earned).toBe(10)
    expect(m.issue).toBeUndefined()
  })
  it('net margin bands: ≥15 full, 0..8 a finding, ≤0 a loss', () => {
    expect(margin({ s9n_net_margin: 18 }).earned).toBe(15)
    expect(margin({ s9n_net_margin: 5 })).toMatchObject({ earned: 5, issue: 'Чистая маржа 5% — ниже 8%' })
    expect(margin({ s9n_net_margin: -3 })).toMatchObject({ earned: 0, issue: 'Бизнес работает в ноль или в убыток' })
  })
  it('gross margin keeps its bands and an honest text', () => {
    expect(margin({ s2_gross_margin: 35 }).earned).toBe(15)
    expect(margin({ s2_gross_margin: 20 }).earned).toBe(8)
    expect(margin({ s2_gross_margin: 10 })).toMatchObject({ earned: 3, issue: 'Низкая валовая маржа (<15%)' })
  })
  it('gross wins when both are known', () => {
    expect(margin({ s2_gross_margin: 35, s9n_net_margin: 2 }).earned).toBe(15)
  })
})

describe('the customer score is asked on a 10-point scale', () => {
  it('9 of 10 is full points, not «NPS 9 — довольны умеренно»', () => {
    expect(check({ s7_nps_score: 9 }, 'product', 'nps')).toMatchObject({ earned: 20 })
  })
  it('7–8 is half with a finding, below 7 a finding with 0', () => {
    expect(check({ s7_nps_score: 8 }, 'product', 'nps')).toMatchObject({ earned: 10, issue: 'Клиенты оценивают вас на 8/10 — есть недовольные' })
    expect(check({ s7_nps_score: 5 }, 'product', 'nps')).toMatchObject({ earned: 0, issue: 'Клиенты оценивают вас на 5/10 — много недовольных' })
  })
  it('a real NPS (−100..100) keeps the NPS bands', () => {
    expect(check({ s7_nps_score: 60 }, 'product', 'nps').earned).toBe(20)
    expect(check({ s7_nps_score: 35 }, 'product', 'nps')).toMatchObject({ earned: 10, issue: 'NPS 35 — клиенты довольны умеренно' })
    expect(check({ s7_nps_score: -20 }, 'product', 'nps').earned).toBe(0)
  })
})

describe('a form toggle counts by its saved step only after the full questionnaire', () => {
  // Step 4: s4m_hours_on_ops is on another express screen than the org chart toggle.
  const otherScreenOfStep4 = { s4m_hours_on_ops: 3 }
  it('before the full questionnaire an untouched toggle is no data', () => {
    expect(check(otherScreenOfStep4, 'operations', 'org_chart', false).answered).toBe(false)
  })
  it('after the full questionnaire an untouched toggle on a saved step is a deliberate «нет»', () => {
    expect(check(otherScreenOfStep4, 'operations', 'org_chart', true).answered).toBe(true)
  })
  it('a saved toggle is an answer either way', () => {
    expect(check({ s4_has_org_chart: false }, 'operations', 'org_chart', false).answered).toBe(true)
  })
})

describe('health index does not punish missing data', () => {
  const strongOps = { s4_has_org_chart: true, s4_has_dept_kpi: true, s4_has_regular_meetings: true, s4_reporting_tool: 'bi', s4_task_manager: 'notion', s4_management_method: 'kpi' }
  it('bonuses are spread over the key blocks that have a score', () => {
    const r = v4(strongOps)
    // only operations scored (100): 100 × 0.6 + 40 × (10 / 10) = 100
    expect(r.overall).toBe(100)
    expect(r.health_index).toBe(100)
  })
})
