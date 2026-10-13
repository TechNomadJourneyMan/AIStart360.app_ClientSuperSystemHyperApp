import { describe, it, expect } from 'vitest'
import { calculatePointA } from '@/lib/point-a-engine'
import { calculatePointAV4, toCompatPointA } from '@/lib/point-a/v4/engine'
import { CODE_TEMPLATES, DEFAULT_TEMPLATE, configVersion, effectiveBlocks, pickTemplate } from '@/lib/point-a/v4/config'
import { CURRENT_FULL_STRONG, CURRENT_TYPICAL } from '../point-a/fixtures/answer-sets'

const blocks = effectiveBlocks(DEFAULT_TEMPLATE)
const v4 = (answers: Record<string, unknown>, extra: Partial<Parameters<typeof calculatePointAV4>[0]> = {}) =>
  calculatePointAV4({ answers, blocks, ...extra })

describe('block configuration', () => {
  it('default template: 7 blocks, weights sum to 1', () => {
    expect(blocks.map((b) => b.key)).toEqual(['finance', 'sales', 'operations', 'marketing', 'strategy', 'team', 'product'])
    expect(blocks.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 3)
    for (const t of CODE_TEMPLATES) expect(t.blocks.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 3)
  })

  it('picks an industry template, default otherwise', () => {
    expect(pickTemplate('Интернет-магазин одежды').key).toBe('ecommerce')
    expect(pickTemplate('Производство мебели').key).toBe('production')
    expect(pickTemplate('Кофейня').key).toBe('default')
    expect(pickTemplate(null).key).toBe('default')
  })

  it('expert weights and switches; the client hides and reorders but never weighs', () => {
    const eb = effectiveBlocks(DEFAULT_TEMPLATE, {
      expertOverrides: { product: { enabled: false }, finance: { weight: 0.5 } },
      clientView: { hidden: ['strategy'], order: ['team', 'finance'] },
    })
    expect(eb.find((b) => b.key === 'product')).toBeUndefined()
    expect(eb[0].key).toBe('team')
    expect(eb.find((b) => b.key === 'strategy')).toMatchObject({ hiddenForClient: true })
    expect(eb.find((b) => b.key === 'strategy')!.weight).toBeGreaterThan(0)
    expect(eb.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 3)
    expect(eb.find((b) => b.key === 'finance')!.weight).toBeGreaterThan(eb.find((b) => b.key === 'sales')!.weight)
  })

  it('a block the client adds that the template does not weigh is informational', () => {
    const tpl = { ...DEFAULT_TEMPLATE, blocks: DEFAULT_TEMPLATE.blocks.map((b) => (b.key === 'product' ? { ...b, enabled: false, weight: 0 } : b)) }
    const eb = effectiveBlocks(tpl, { clientView: { added: ['product'] } })
    expect(eb.find((b) => b.key === 'product')).toMatchObject({ informational: true, weight: 0, origin: 'client' })
  })

  it('config version', () => {
    expect(configVersion(DEFAULT_TEMPLATE, { version: 3 })).toBe('default@1/r1')
  })
})

describe('calculatePointAV4', () => {
  it('no answers: no score, every block lacks data, nothing silently 0', () => {
    const r = v4({})
    expect(r.overall).toBeNull()
    expect(r.blocks_without_data).toHaveLength(7)
    expect(r.blocks.every((b) => b.status === 'insufficient_data' && b.score === null)).toBe(true)
    expect(r.upload_checklist.length).toBeGreaterThan(0)
    expect(r.confidence).toBe(0)
  })

  it('an unanswered question is not a 0: v1 punishes it, v4 leaves it out', () => {
    const answers = { s9n_revenue_2024: 100_000_000, s9n_change_vs_2023: '+25%', s9n_net_margin: 35, s9n_debts_amount: 0, s9n_breakeven_point: 5_000_000 }
    const v1 = calculatePointA(answers)
    const r = v4(answers)
    const fin = r.blocks.find((b) => b.key === 'finance')!
    expect(fin.status).toBe('ok')
    expect(fin.score).toBeGreaterThan(v1.blocks.finance.score)
    expect(fin.coverage).toBeLessThan(1)
    expect(fin.needs.length).toBeGreaterThan(0)
    // only finance has data → the overall equals it
    expect(r.overall).toBe(fin.score)
  })

  it('a full questionnaire scores every v1 block and stays close to v1', () => {
    const r = v4(CURRENT_FULL_STRONG)
    const v1 = calculatePointA(CURRENT_FULL_STRONG)
    for (const k of ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const) {
      const b = r.blocks.find((x) => x.key === k)!
      expect(b.status).toBe('ok')
      expect(b.score!).toBeGreaterThanOrEqual(v1.blocks[k].score)
    }
    expect(r.overall).not.toBeNull()
    expect(r.confidence).toBeGreaterThan(0.4)
  })

  it('an open discrepancy of a block metric lowers its confidence, not its score', () => {
    const a = v4(CURRENT_TYPICAL)
    const b = v4(CURRENT_TYPICAL, { conflictMetrics: new Set(['biz.finansy.vyruchka_god']) })
    const fa = a.blocks.find((x) => x.key === 'finance')!
    const fb = b.blocks.find((x) => x.key === 'finance')!
    expect(fb.score).toBe(fa.score)
    expect(fb.confidence).toBeLessThan(fa.confidence)
    expect(fb.conflicts).toEqual(['biz.finansy.vyruchka_god'])
  })

  it('expert weights change the overall; a hidden block does not', () => {
    const base = v4(CURRENT_TYPICAL).overall
    const hidden = calculatePointAV4({ answers: CURRENT_TYPICAL, blocks: effectiveBlocks(DEFAULT_TEMPLATE, { clientView: { hidden: ['finance', 'sales'] } }) }).overall
    expect(hidden).toBe(base)
    const reweighted = calculatePointAV4({ answers: CURRENT_TYPICAL, blocks: effectiveBlocks(DEFAULT_TEMPLATE, { expertOverrides: { strategy: { weight: 5 } } }) }).overall
    expect(reweighted).not.toBe(base)
  })

  it('team and product blocks read step 4 / step 3–5 answers', () => {
    const r = v4({
      s4n_structure_matches: true, s4m_delegation_readiness: 8, s4m_hours_on_ops: 3, s4m_planning_team_or_solo: 'team',
      s1_employee_count: 24, s3_product_count: 3, s5n_product_locomotive: 'Курс', s7_nps_score: 60, s3n_cannot_copy: 'Методика',
    })
    const team = r.blocks.find((b) => b.key === 'team')!
    const product = r.blocks.find((b) => b.key === 'product')!
    expect(team.status).toBe('ok')
    expect(team.score!).toBeGreaterThan(80)
    expect(product.status).toBe('ok')
  })

  it('a saved step makes its untouched toggles a deliberate «нет»', () => {
    const touched = v4({ s4m_control_method: 'fire_fighting', s4m_report_automated: 'excel', s12_project_mgmt: 'none' })
    const ops = touched.blocks.find((b) => b.key === 'operations')!
    expect(ops.checks.find((c) => c.id === 'org_chart')!.answered).toBe(true)
  })

  it('compat row: the five v1 columns from v4 blocks, v1 lists kept', () => {
    const v1 = calculatePointA(CURRENT_TYPICAL)
    const r = v4(CURRENT_TYPICAL)
    const row = toCompatPointA(r, v1)
    expect(row.overall_score).toBe(r.overall ?? 0)
    expect(row.risks).toEqual(v1.risks)
    expect(Object.keys(row.blocks).sort()).toEqual(['finance', 'marketing', 'operations', 'sales', 'strategy'])
  })
})

describe('review fixes: answered or not', () => {
  it('M1: «нет» on loyalty is an answer (a weakness), not a gap', () => {
    const r = calculatePointAV4({ answers: { ...CURRENT_FULL_STRONG, s3_has_loyalty: false }, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
    const loyalty = r.blocks.find((b) => b.key === 'sales')!.checks.find((c) => c.id === 'loyalty')!
    expect(loyalty.answered).toBe(true)
  })
  it('M2: a cleared number field (0) is not an answer', () => {
    const r = calculatePointAV4({ answers: { s5_marketing_budget_pct: 0 }, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
    expect(r.blocks.find((b) => b.key === 'marketing')!.checks.find((c) => c.id === 'budget')!.answered).toBe(false)
  })
  it('compat: a block without a v4 score keeps its v1 block; no score at all → v1 row', () => {
    const v1 = calculatePointA({ s6_main_pain: 'x' })
    const r = calculatePointAV4({ answers: { s6_main_pain: 'x' }, blocks: effectiveBlocks(DEFAULT_TEMPLATE) })
    expect(toCompatPointA(r, v1)).toEqual(v1)
  })
})

describe('pickTemplate — deterministic', () => {
  const mk = (key: string, industries: string[]) => ({ key, title: key, industries, version: 1, blocks: [{ key: 'finance' as const, weight: 1, enabled: true }] })
  const all = [mk('default', []), mk('services', ['it', 'услуг']), mk('metal', ['металл']), mk('production', ['завод'])]

  it('a short token matches a whole word only', () => {
    expect(pickTemplate('IT-компания', all).key).toBe('services')
    expect(pickTemplate('Digital-агентство', all).key).toBe('default')
  })
  it('the most specific match wins, whatever the order of rows', () => {
    expect(pickTemplate('Завод металлоконструкций', all).key).toBe('metal')
    expect(pickTemplate('Завод металлоконструкций', [...all].reverse()).key).toBe('metal')
  })
})
