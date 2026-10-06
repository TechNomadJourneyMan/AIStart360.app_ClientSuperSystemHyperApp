/**
 * Point A engine rebase (2026-10, docs/platform D9):
 *  - blocks are earned / possible × 100 over the checks the platform can collect,
 *  - legacy keys are still read; current wizard keys (incl. the step-8 metrics
 *    table) fill the inputs the wizard no longer asks under the old keys,
 *  - no rewards for answer length on numeric criteria.
 */
import { describe, it, expect } from 'vitest'
import { calculatePointA } from '@/lib/point-a-engine'
import { CURRENT_FULL_STRONG, CURRENT_TYPICAL, LEGACY_STRONG, LEGACY_WEAK } from './fixtures/answer-sets'

const BLOCKS = ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const

describe('current wizard can reach the top of every block', () => {
  it('a fully filled strong questionnaire scores ≥ 85 in each block', () => {
    const pa = calculatePointA(CURRENT_FULL_STRONG)
    for (const b of BLOCKS) {
      expect(pa.blocks[b].score, b).toBeGreaterThanOrEqual(85)
      expect(pa.blocks[b].status, b).toBe('excellent')
    }
    expect(pa.overall_score).toBeGreaterThanOrEqual(85)
    expect(pa.stage).toBe('scale')
    // Nothing invented: no data gaps and no «CAC или LTV не указаны».
    expect(pa.data_gaps).toEqual([])
    expect(JSON.stringify(pa.blocks)).not.toMatch(/CAC или LTV не указаны/)
  })

  it('only the loyalty check (no wizard question) is excluded from the denominator', () => {
    const pa = calculatePointA(CURRENT_FULL_STRONG)
    expect(pa.blocks.sales.excluded_checks).toEqual(['loyalty'])
    expect(pa.blocks.marketing.excluded_checks).toEqual(['loyalty'])
    expect(pa.blocks.finance.excluded_checks).toEqual([])
    expect(pa.blocks.sales.possible).toBe(70) // 80 − 10 (loyalty)
    expect(pa.blocks.marketing.possible).toBe(60) // 70 − 10 (loyalty)
  })

  it('reads revenue by year, CAC/LTV and new vs repeat sales from the step-8 metrics table', () => {
    const base = { s8n_metrics_table: CURRENT_FULL_STRONG.s8n_metrics_table, s9n_net_margin: 34 }
    const pa = calculatePointA(base)
    // growth 2023→2024 (+23.7%) 20 + margin 15 + LTV/CAC 4.3 15 + trend 2025 ≥ 2024 15 = 65 of 85
    expect(pa.blocks.finance.earned).toBe(65)
    expect(pa.blocks.finance.top_issues.join(' ')).not.toMatch(/CAC или LTV/)
    expect(pa.insights.map((i) => i.text).join(' ')).toMatch(/Выручка растёт на 24% г\/г/)
    // repeat share 230 / 610 = 38% → full points, no «Повторных клиентов …» issue
    expect(pa.blocks.sales.top_issues.join(' ')).not.toMatch(/Повторных клиентов/)
  })
})

describe('legacy answers are still read', () => {
  // Earned points per block equal the old additive v1 points (v1 clamped them
  // to 0..100 and capped blocks at 85/80/80/70/60); the score is now
  // earned / possible. Strategy differs on purpose: v1 gave 0 for the 12-month
  // goal «Выручка 400 млн ₸» because it is shorter than 20 characters.
  it('strong legacy company — same earned points and issues as v1', () => {
    const pa = calculatePointA(LEGACY_STRONG)
    expect(BLOCKS.map((b) => pa.blocks[b].earned)).toEqual([85, 80, 80, 70, 60])
    expect(BLOCKS.map((b) => pa.blocks[b].possible)).toEqual([85, 80, 80, 70, 60])
    expect(BLOCKS.map((b) => pa.blocks[b].excluded_checks)).toEqual([[], [], [], [], []])
    expect(pa.risks).toEqual([])
    // v1: overall 77, health 86, growth; now every block is complete.
    expect(pa.overall_score).toBe(100)
    expect(pa.health_index).toBe(100)
  })

  it('weak legacy company — v1 earned points, issues and risks unchanged', () => {
    const pa = calculatePointA(LEGACY_WEAK)
    // v1 block scores were F3 S0 O5 M7 St15 (raw points, no exclusions in v1).
    expect(pa.blocks.finance.earned).toBe(3)
    expect(pa.blocks.sales.earned).toBe(0)
    expect(pa.blocks.operations.earned).toBe(5)
    expect(pa.blocks.marketing.earned).toBe(7)
    expect(pa.blocks.finance.top_issues).toEqual([
      'Выручка не растёт или падает',
      'Низкая маржинальность (<30%)',
      'LTV/CAC = 1.5 — маркетинг убыточен',
    ])
    expect(pa.risks.map((r) => r.text)).toEqual([
      'Нет CRM-системы — потери лидов ~30%',
      'LTV/CAC = 1.5 (норма > 3)',
      'Отчётность в Excel — слепые зоны в данных',
      'Ручное управление — высокий операционный риск',
      'Маркетинговый бюджет ниже нормы или не определён',
      'Точка безубыточности неизвестна',
    ])
    expect(BLOCKS.map((b) => pa.blocks[b].score)).toEqual([4, 0, 6, 12, 38])
    expect(pa.overall_score).toBe(8)
    expect(pa.stage).toBe('seed')
  })

  it('a legacy loyalty answer is scored (not excluded)', () => {
    const yes = calculatePointA({ ...CURRENT_TYPICAL, s3_has_loyalty: true })
    const no = calculatePointA({ ...CURRENT_TYPICAL, s3_has_loyalty: false })
    expect(yes.blocks.sales.excluded_checks).toEqual([])
    expect(yes.blocks.sales.possible).toBe(80)
    expect(yes.blocks.sales.earned! - no.blocks.sales.earned!).toBe(10)
  })
})

describe('no rewards for answer length on numeric criteria', () => {
  const longVague = 'Стать заметной и уважаемой компанией на рынке, расти и развиваться вместе с командой и клиентами'

  it('a measurable short goal beats a long goal without numbers', () => {
    const vague = calculatePointA({ s2n_goal_3y_what: longVague, s2n_goal_12m_what: longVague })
    const measurable = calculatePointA({ s2n_goal_3y_what: '1 млрд ₸', s2n_goal_12m_what: '300 млн' })
    expect(measurable.blocks.strategy.earned).toBe(35)
    expect(vague.blocks.strategy.earned).toBe(18) // 10 + 8: a goal is named but not measurable
    expect(vague.blocks.strategy.top_issues).toContain('Цель на 3 года не выражена в цифрах')
  })

  it('a numeric revenue target from step 1 makes the goal measurable', () => {
    const pa = calculatePointA({ s1_goal_3y_revenue_year: 2_000_000_000, s1_goal_12m_revenue_year: 600_000_000 })
    expect(pa.blocks.strategy.earned).toBe(35)
  })

  it('presence criteria do not depend on length (ICP, USP, main pain)', () => {
    const short = calculatePointA({ s5_target_audience: 'B2B', s5_usp: 'SLA 4ч', s6_main_pain: 'Кадры' })
    const long = calculatePointA({ s5_target_audience: longVague, s5_usp: longVague, s6_main_pain: longVague })
    expect(short.blocks.marketing.earned).toBe(long.blocks.marketing.earned)
    expect(short.blocks.strategy.earned).toBe(long.blocks.strategy.earned)
    // «нет» is not an answer.
    expect(calculatePointA({ s6_main_pain: 'нет' }).blocks.strategy.earned).toBe(0)
  })
})

describe('unanswered questions earn nothing', () => {
  it('an empty questionnaire scores 0 everywhere', () => {
    const pa = calculatePointA({})
    for (const b of BLOCKS) expect(pa.blocks[b].score, b).toBe(0)
    expect(pa.overall_score).toBe(0)
  })

  it('missing debt, deal cycle and refusals are not free points', () => {
    const pa = calculatePointA({ s3_deals_2024: 100 })
    // v1 gave +10 (debt «none» by default), +8 (cycle 0 ≤ 60) and +10 (0 refusals).
    expect(pa.blocks.finance.earned).toBe(0)
    expect(pa.blocks.sales.earned).toBe(10) // pipeline > 50 only
    expect(pa.blocks.sales.top_issues).toEqual(expect.arrayContaining(['Цикл сделки не указан']))
  })

  it('an unanswered CRM question is not reported as «нет CRM»', () => {
    const pa = calculatePointA({ s1_company_name: 'X' })
    expect(pa.risks.map((r) => r.text)).not.toContain('Нет CRM-системы — потери лидов ~30%')
    expect(pa.quick_wins.map((q) => q.action)).not.toContain('Внедрить CRM (amoCRM базовый)')
    expect(pa.data_gaps.map((g) => g.field)).toContain('s12_crm_tool')
  })

  it('no fake «LTV/CAC = 0.0» risk when LTV/CAC is unknown', () => {
    const pa = calculatePointA(CURRENT_TYPICAL)
    expect(pa.risks.map((r) => r.text).join(' ')).not.toMatch(/LTV\/CAC/)
  })
})

describe('resolved metric values (second argument) win over the survey', () => {
  it('document LTV/CAC is used before survey answers and closes the data gap', () => {
    const survey = calculatePointA({ s2_ltv: 60_000, s2_cac: 40_000 })
    expect(survey.blocks.finance.top_issues).toContain('LTV/CAC = 1.5 — маркетинг убыточен')
    const resolved = calculatePointA({ s2_ltv: 60_000, s2_cac: 40_000 }, { ltv: 400_000, cac: 100_000 })
    expect(resolved.blocks.finance.earned! - survey.blocks.finance.earned!).toBe(15)
    expect(calculatePointA({}, { ltvCacRatio: 3.2 }).data_gaps.map((g) => g.field)).not.toContain('s8n_metrics_table')
  })

  it('CAC/LTV gap is reported against the step-8 table when no source has them', () => {
    const gap = calculatePointA(CURRENT_TYPICAL).data_gaps.find((g) => g.field === 's8n_metrics_table')
    expect(gap).toMatchObject({ step: 8 })
    expect(gap?.impact).toMatch(/CAC и LTV/)
  })

  it('data gaps point at questions the current wizard asks', () => {
    const fields = calculatePointA({}).data_gaps.map((g) => g.field)
    expect(fields).toEqual(['s9n_revenue_2024', 's2n_goal_12m_what', 's9n_net_margin', 's8n_metrics_table', 's12_crm_tool'])
  })
})

describe('insights carry their meaning', () => {
  it('growth is a strength, a single channel is a risk', () => {
    const pa = calculatePointA({ s2_revenue_2023: 100, s2_revenue_2024: 150, s5_marketing_channels: ['SEO'] })
    expect(pa.insights).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'strength', area: 'Финансы' }),
      expect.objectContaining({ kind: 'risk', text: 'Единственный канал маркетинга — критическая зависимость' }),
    ]))
  })
})
