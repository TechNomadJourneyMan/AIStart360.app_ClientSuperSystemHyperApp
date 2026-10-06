import { describe, it, expect } from 'vitest'
import {
  buildPointAOverview,
  legacyFindings,
  loadPointAOverview,
  type OverviewDiagnosticRow,
  type OverviewFindingRow,
  type PointAOverviewInputs,
} from '@/lib/point-a/overview'
import { calculatePointA } from '@/lib/point-a-engine'
import { CURRENT_FULL_STRONG, CURRENT_TYPICAL } from './fixtures/answer-sets'

const NOW = new Date('2026-10-06T12:00:00Z')
const CALC = '2026-10-05T10:00:00.000Z'

function diagnosticFrom(answers: Record<string, unknown>, calculatedAt = CALC): OverviewDiagnosticRow {
  const pa = calculatePointA(answers)
  return {
    overall_score: pa.overall_score,
    health_index: pa.health_index,
    stage: pa.stage,
    finance_score: pa.blocks.finance,
    sales_score: pa.blocks.sales,
    operations_score: pa.blocks.operations,
    marketing_score: pa.blocks.marketing,
    strategy_score: pa.blocks.strategy,
    risks: pa.risks,
    insights: pa.insights,
    data_gaps: pa.data_gaps,
    calculated_at: calculatedAt,
  }
}

function surveyRows(answers: Record<string, unknown>, answeredAt = '2026-10-04T09:00:00Z') {
  return Object.entries(answers).map(([question_key, value]) => ({ question_key, answer: { value }, answered_at: answeredAt }))
}

function finding(over: Partial<OverviewFindingRow>): OverviewFindingRow {
  return {
    id: over.id ?? `f-${Math.random().toString(36).slice(2)}`,
    kind: 'risk',
    area: 'finance',
    title: 'Кассовый разрыв в марте',
    body: null,
    severity: 'high',
    provenance_type: 'FACT',
    confidence: 0.9,
    produced_by: 'agent:data_quality',
    status: 'active',
    visible_to_client: true,
    ...over,
  }
}

function inputs(over: Partial<PointAOverviewInputs> = {}): PointAOverviewInputs {
  return {
    companyId: 'co-1',
    companyName: 'ИП «Кофейня у дома»',
    now: NOW,
    diagnostic: null,
    findings: [],
    surveyRows: [],
    documents: [],
    gri: { count: 0, currentIndex: null, currentAt: null },
    integrationsConnected: 0,
    metrics: { withValue: 0, total: 148, lastChangedAt: null },
    sessionInFlight: false,
    marketConfirmedCount: 0,
    ...over,
  }
}

describe('buildPointAOverview — empty company', () => {
  it('reports «not started» with nulls and what to fill, never invented numbers', () => {
    const o = buildPointAOverview(inputs())
    expect(o.status).toBe('not_started')
    expect(o.overallScore).toBeNull()
    expect(o.healthIndex).toBeNull()
    expect(o.maturity).toBeNull()
    expect(o.griIndex).toBeNull()
    expect(o.calculatedAt).toBeNull()
    expect(o.lastInputAt).toBeNull()
    expect(o.completeness).toBe(0)
    expect(o.completenessLevel).toBe('low')
    expect(o.problemZones).toEqual([])
    expect(o.keyRisks).toEqual([])
    expect(o.strengths).toEqual([])
    expect(o.criticalGaps).toEqual([])
    expect(o.dataGaps[0]).toMatch(/^Заполните анкету: шаги 1, 2, 3/)
    expect(o.dataGaps.length).toBeLessThanOrEqual(5)
    expect(o.sources).toEqual({
      surveyStepsCompleted: 0, surveyStepsTotal: 12,
      documentsTotal: 0, documentsProcessed: 0, documentsFailed: 0, documentsPending: 0,
      griAssessments: 0, integrationsConnected: 0, metricsWithValue: 0, metricsTotal: 148, processedSources: 0,
    })
    expect(o.generatedAt).toBe(NOW.toISOString())
  })

  it('survey started but never calculated → collecting', () => {
    const o = buildPointAOverview(inputs({ surveyRows: surveyRows({ s1_company_name: 'X' }) }))
    expect(o.status).toBe('collecting')
    expect(o.sources.surveyStepsCompleted).toBe(1)
  })
})

describe('buildPointAOverview — realistic company', () => {
  const findings: OverviewFindingRow[] = [
    finding({ id: 'f-risk', kind: 'risk', severity: 'high', area: 'finance', title: 'Кассовый разрыв в марте' }),
    finding({ id: 'f-ai-hidden', kind: 'risk', severity: 'critical', provenance_type: 'AI_HYPOTHESIS', visible_to_client: false, title: 'Гипотеза модели' }),
    finding({ id: 'f-ai-visible', kind: 'opportunity', severity: 'medium', provenance_type: 'AI_HYPOTHESIS', visible_to_client: true, title: 'Проверенная гипотеза' }),
    finding({ id: 'f-old', status: 'superseded', severity: 'critical', title: 'Старый риск' }),
    finding({ id: 'f-strength', kind: 'strength', severity: 'info', area: 'customers', title: 'NPS 52 — выше рынка', provenance_type: 'FACT' }),
    finding({ id: 'f-gap', kind: 'bottleneck', severity: 'critical', area: 'automation', title: 'Отчётность собирается вручную', provenance_type: 'INFERRED', confidence: 0.7 }),
  ]
  const base = inputs({
    diagnostic: diagnosticFrom(CURRENT_TYPICAL),
    findings,
    surveyRows: surveyRows(CURRENT_TYPICAL),
    documents: [
      { parse_status: 'parsed', fields: [{ key: 'revenue', value: 88_000_000 }], uploaded_at: '2026-09-30T08:00:00Z', doc_type: 'pl_report' },
      { parse_status: 'parsed', fields: [], uploaded_at: '2026-09-30T08:00:00Z', doc_type: 'other' },
      { parse_status: 'error', fields: null, uploaded_at: '2026-09-29T08:00:00Z' },
      { parse_status: 'queued', fields: null, uploaded_at: '2026-09-01T08:00:00Z' }, // stuck for a month
    ],
    gri: { count: 2, currentIndex: 6.43, currentAt: '2026-10-01T08:00:00Z' },
    integrationsConnected: 1,
    metrics: { withValue: 31, total: 148, lastChangedAt: '2026-10-02T08:00:00Z' },
  })

  it('scores, maturity, status and timestamps come from the current diagnostic', () => {
    const o = buildPointAOverview(base)
    const pa = calculatePointA(CURRENT_TYPICAL)
    expect(o.overallScore).toBe(pa.overall_score)
    expect(o.healthIndex).toBe(pa.health_index)
    expect(o.maturity).toEqual({ level: 'seed', label: 'Старт' })
    expect(o.griIndex).toBe(6.43)
    expect(o.status).toBe('ready') // inputs all older than calculated_at; stuck upload ≠ processing
    expect(o.calculatedAt).toBe(CALC)
    expect(o.lastInputAt).toBe('2026-10-04T09:00:00.000Z')
  })

  it('counts sources honestly (processed = parsed with ≥ 1 field)', () => {
    const o = buildPointAOverview(base)
    expect(o.sources).toMatchObject({
      documentsTotal: 4, documentsProcessed: 1, documentsFailed: 1, documentsPending: 1,
      griAssessments: 2, integrationsConnected: 1, metricsWithValue: 31, metricsTotal: 148, processedSources: 5,
    })
    expect(o.sources.surveyStepsCompleted).toBe(5) // steps 1, 2, 4, 9, 12
  })

  it('completeness follows lib/gri/trust + survey fill', () => {
    const o = buildPointAOverview(base)
    expect(o.completeness).toBeGreaterThan(0.3)
    expect(o.completeness).toBeLessThan(1)
    expect(['low', 'medium', 'high']).toContain(o.completenessLevel)
    expect(o.dataGaps[0]).toMatch(/^Заполните анкету: шаги 3, 5, 6, 7, 8, 10, 11/)
    expect(o.dataGaps.join(' ')).toMatch(/Шаг 8: CAC и LTV/)
    expect(o.dataGaps.length).toBeLessThanOrEqual(5)
  })

  it('key risks: severity first, unreviewed AI hypotheses and superseded rows never shown', () => {
    const o = buildPointAOverview(base)
    const ids = o.keyRisks.map((r) => r.id)
    expect(ids).not.toContain('f-ai-hidden')
    expect(ids).not.toContain('f-old')
    expect(o.keyRisks.length).toBeLessThanOrEqual(5)
    const ranks = o.keyRisks.map((r) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(r.severity))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(o.keyRisks[0]).toMatchObject({ severity: 'critical', provenanceType: 'CALCULATED', source: 'engine:point_a_v1' })
    const fact = o.keyRisks.find((r) => r.id === 'f-risk')
    expect(fact).toMatchObject({ provenanceType: 'FACT', source: 'agent:data_quality', confidence: 0.9 })
  })

  it('legacy JSON findings are CALCULATED by engine:point_a_v1 with stable ids', () => {
    const o = buildPointAOverview(base)
    const engine = o.keyRisks.filter((r) => r.source === 'engine:point_a_v1')
    expect(engine.length).toBeGreaterThan(0)
    for (const r of engine) {
      expect(r.provenanceType).toBe('CALCULATED')
      expect(r.id).toMatch(/^engine:point_a_v1:(risks|insights):\d+$/)
    }
  })

  it('problem zones: weakest first, includes a finding-only area, ≤ 5', () => {
    const o = buildPointAOverview(base)
    expect(o.problemZones.length).toBeLessThanOrEqual(5)
    expect(o.problemZones[0].status).toBe('critical')
    const automation = o.problemZones.find((z) => z.area === 'automation')
    expect(automation).toEqual({ area: 'automation', label: 'Автоматизация', score: null, status: 'critical', topIssue: 'Отчётность собирается вручную' })
    const sales = o.problemZones.find((z) => z.area === 'sales')
    expect(sales).toMatchObject({ label: 'Продажи', score: 0, status: 'critical' })
  })

  it('strengths and critical gaps', () => {
    const o = buildPointAOverview(base)
    expect(o.strengths[0]).toMatchObject({ id: 'f-strength', kind: 'strength' })
    expect(o.strengths.length).toBeLessThanOrEqual(3)
    expect(o.criticalGaps[0]).toMatchObject({ id: 'f-gap', severity: 'critical', provenanceType: 'INFERRED' })
    expect(o.criticalGaps.length).toBeLessThanOrEqual(3)
    expect(o.criticalGaps.every((g) => g.kind === 'gap' || g.kind === 'bottleneck')).toBe(true)
  })

  it('a strong company shows strong blocks as strengths and no problem zones', () => {
    const o = buildPointAOverview(inputs({ diagnostic: diagnosticFrom(CURRENT_FULL_STRONG), surveyRows: surveyRows(CURRENT_FULL_STRONG) }))
    expect(o.problemZones).toEqual([])
    expect(o.strengths.map((s) => s.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^Сильный блок «Финансы»: 100\/100$/)]))
    expect(o.maturity).toEqual({ level: 'scale', label: 'Масштабирование' })
  })
})

describe('buildPointAOverview — status transitions', () => {
  const diag = diagnosticFrom(CURRENT_TYPICAL)

  it('stale when a survey answer changed after the calculation', () => {
    const rows = [...surveyRows(CURRENT_TYPICAL), { question_key: 's9n_net_margin', answer: { value: 18 }, answered_at: '2026-10-06T08:00:00Z' }]
    const o = buildPointAOverview(inputs({ diagnostic: diag, surveyRows: rows }))
    expect(o.status).toBe('stale')
    expect(o.lastInputAt).toBe('2026-10-06T08:00:00.000Z')
  })

  it('stale when a metric value changed after the calculation (history), ready otherwise', () => {
    const changed = buildPointAOverview(inputs({ diagnostic: diag, surveyRows: surveyRows(CURRENT_TYPICAL), metrics: { withValue: 3, total: 148, lastChangedAt: '2026-10-05T11:00:00Z' } }))
    expect(changed.status).toBe('stale')
    const same = buildPointAOverview(inputs({ diagnostic: diag, surveyRows: surveyRows(CURRENT_TYPICAL), metrics: { withValue: 3, total: 148, lastChangedAt: '2026-10-05T09:00:00Z' } }))
    expect(same.status).toBe('ready')
  })

  it('staff notes outside the wizard do not make the diagnostic stale', () => {
    const rows = [...surveyRows(CURRENT_TYPICAL), { question_key: 'gri_expert_finance', answer: { value: 'заметка' }, answered_at: '2026-10-06T08:00:00Z' }]
    expect(buildPointAOverview(inputs({ diagnostic: diag, surveyRows: rows })).status).toBe('ready')
  })

  it('processing while a fresh upload is parsed or a session is in flight', () => {
    const uploading = buildPointAOverview(inputs({
      diagnostic: diag,
      surveyRows: surveyRows(CURRENT_TYPICAL),
      documents: [{ parse_status: 'processing', fields: null, uploaded_at: '2026-10-06T11:30:00Z' }],
    }))
    expect(uploading.status).toBe('processing')
    expect(buildPointAOverview(inputs({ diagnostic: diag, sessionInFlight: true })).status).toBe('processing')
  })
})

describe('legacyFindings', () => {
  it('classifies insights of rows stored before insights had a kind', () => {
    const diag = { ...diagnosticFrom({}), insights: [
      { text: 'Выручка растёт на 25% г/г — фиксируйте драйверы роста', area: 'Финансы' },
      { text: 'Единственный канал маркетинга — критическая зависимость', area: 'Маркетинг' },
      { text: 'Продукт-локомотив «X» требует защиты и масштабирования', area: 'Продажи' },
    ] }
    const f = legacyFindings(diag)
    expect(f.find((x) => x.id.endsWith('insights:0'))).toMatchObject({ kind: 'strength', area: 'finance' })
    expect(f.find((x) => x.id.endsWith('insights:1'))).toMatchObject({ kind: 'risk', area: 'marketing' })
    expect(f.find((x) => x.id.endsWith('insights:2'))).toMatchObject({ kind: 'opportunity', area: 'sales' })
  })
})

// ─── Loader with a minimal PostgREST stand-in ─────────────────────────────────

type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null }

function fakeClient(tables: Record<string, Result>) {
  const calls: string[] = []
  return {
    calls,
    from(table: string) {
      calls.push(table)
      const result = tables[table] ?? { data: [], error: null }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'or', 'in', 'not', 'order', 'limit']) builder[m] = () => builder
      builder.maybeSingle = () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error ?? null })
      builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }).then(resolve, reject)
      return builder
    },
  }
}

describe('loadPointAOverview', () => {
  const company = { data: { id: 'co-1', name: 'Кофейня', user_id: '6f1c2c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f' }, error: null }

  it('tolerates the tables of migrations 085 not being applied yet', async () => {
    const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.diagnostic_findings'" } }
    const client = fakeClient({
      companies: company,
      diagnostics: { data: [diagnosticFrom(CURRENT_TYPICAL)] },
      survey_answers: { data: surveyRows(CURRENT_TYPICAL) },
      documents: { data: [] },
      gri_assessments: { data: [{ gri_index: 5.5, is_current: true, created_at: '2026-10-01T08:00:00Z', section_avgs: { team: 6, operations: 0 } }] },
      metrics: { data: [{ metric_key: 'biz.finansy.vyruchka_god', metric_value: 88_000_000 }, { metric_key: 'not.in.registry', metric_value: 1 }] },
      diagnostic_findings: missing,
      metric_value_history: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
      diagnostic_sessions: missing,
      crm_provider_connections: { count: 2 },
      market_analysis_answers: { data: null, error: { code: '42P01' } },
    })
    const o = await loadPointAOverview(client as never, { companyId: 'co-1' }, NOW)
    expect(o.companyName).toBe('Кофейня')
    expect(o.status).toBe('ready')
    expect(o.griIndex).toBe(5.5)
    expect(o.sources.integrationsConnected).toBe(2)
    // registry row + the GRI «Команда» block scored by the assessment (operations = 0 is not a score)
    expect(o.sources.metricsWithValue).toBe(2)
    expect(o.keyRisks.every((r) => r.source === 'engine:point_a_v1')).toBe(true)
  })

  it('fails loudly when a core table errors', async () => {
    const client = fakeClient({ companies: company, diagnostics: { data: null, error: { code: '57014', message: 'timeout' } } })
    await expect(loadPointAOverview(client as never, { companyId: 'co-1' }, NOW)).rejects.toThrow(/diagnostics failed/)
  })
})
