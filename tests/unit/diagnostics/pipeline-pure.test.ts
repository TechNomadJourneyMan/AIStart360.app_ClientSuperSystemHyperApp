import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_STAGES, nextStage, stageTaskKey } from '@/lib/diagnostics/pipeline'
import {
  dataQualityFindings, failedDocumentFindings, impossibleValueFindings, inconsistencyFindings, stalenessFindings,
  type QualityMetricRow,
} from '@/lib/diagnostics/quality'
import { BENCHMARK_CONFIDENCE, benchmarkFindings } from '@/lib/diagnostics/benchmark'
import {
  acceptHypotheses, acceptRecommendations, buildDiagnosticEvidence, engineRecommendations, findingEvidence,
  horizonFromTimeline, hypothesesPrompt, promptInputHash,
} from '@/lib/diagnostics/ai'
import { samePointA } from '@/lib/diagnostics/scoring'
import { calculatePointA } from '@/lib/point-a-engine'
import { LEGACY_WEAK, CURRENT_FULL_STRONG } from '../point-a/fixtures/answer-sets'
import type { ActiveFindingRow } from '@/lib/diagnostics/findings-store'

const metric = (p: Partial<QualityMetricRow>): QualityMetricRow => ({
  metric_key: 'biz.finansy.vyruchka_god', metric_value: 100, metric_unit: '₸', source: 'survey',
  period_year: 2025, period_quarter: null, period_month: null, scenario: null, computed_at: null, ...p,
})

describe('pipeline order', () => {
  it('chains the six stages and ends after recommendation', () => {
    expect(nextStage(null)).toBe('data_collection')
    const seen = [] as string[]
    let s = nextStage(null)
    while (s) { seen.push(s); s = nextStage(s) }
    expect(seen).toEqual([...DIAGNOSTIC_STAGES])
    expect(stageTaskKey('abc', 'metrics')).toBe('diag:abc:metrics')
  })
})

describe('data quality', () => {
  it('flags the same metric and period that differs by more than 30 % between sources', () => {
    const f = inconsistencyFindings([
      metric({ source: 'survey', metric_value: 100_000_000 }),
      metric({ source: 'document', metric_value: 60_000_000 }),
    ])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'inconsistency', severity: 'medium', provenance: 'CALCULATED', area: 'finance' })
    expect(f[0].title).toContain('40%')
    expect(f[0].evidence.map((e) => e.field)).toEqual(['survey', 'document'])
  })

  it('does not compare different periods, scenarios or close values', () => {
    expect(inconsistencyFindings([metric({ source: 'survey', period_year: 2024 }), metric({ source: 'document', metric_value: 10 })])).toEqual([])
    expect(inconsistencyFindings([metric({ source: 'survey' }), metric({ source: 'document', scenario: 'plan', metric_value: 10 })])).toEqual([])
    expect(inconsistencyFindings([metric({ source: 'survey', metric_value: 100 }), metric({ source: 'document', metric_value: 80 })])).toEqual([])
  })

  it('flags impossible values only', () => {
    expect(impossibleValueFindings([metric({ metric_value: -5 })])).toHaveLength(1)
    expect(impossibleValueFindings([metric({ metric_unit: '%', metric_value: -150 })])).toHaveLength(1)
    expect(impossibleValueFindings([metric({ metric_unit: '%', metric_value: -20 })])).toEqual([])
    expect(impossibleValueFindings([metric({ metric_value: 0 })])).toEqual([])
    expect(impossibleValueFindings([metric({ metric_value: null })])).toEqual([])
  })

  it('reports stale financial documents and an old questionnaire', () => {
    const now = new Date('2026-10-06T00:00:00Z')
    const f = stalenessFindings({
      now,
      surveyLastAnsweredAt: new Date('2025-06-01T00:00:00Z'),
      documents: [{ id: 'd1', file_name: 'pl.xlsx', doc_type: 'pl_report', parse_status: 'parsed', period_year: 2023, last_error_code: null, uploaded_at: null }],
    })
    expect(f.map((x) => x.key).sort()).toEqual(['stale:financial_documents', 'stale:survey'])
    expect(stalenessFindings({ now, surveyLastAnsweredAt: new Date('2026-09-01T00:00:00Z'), documents: [] })).toEqual([])
  })

  it('lists documents that could not be processed with the reason', () => {
    const f = failedDocumentFindings([
      { id: 'a', file_name: 'scan.pdf', doc_type: 'pl_report', parse_status: 'needs_ocr', period_year: null, last_error_code: 'NEEDS_OCR', uploaded_at: null },
      { id: 'b', file_name: 'ok.pdf', doc_type: 'other', parse_status: 'parsed', period_year: null, last_error_code: null, uploaded_at: null },
    ])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'data_gap', area: 'finance', provenance: 'FACT' })
    expect(f[0].body).toContain('OCR')
  })

  it('every finding carries evidence', () => {
    const all = dataQualityFindings({
      metrics: [metric({ source: 'survey' }), metric({ source: 'document', metric_value: 10 }), metric({ metric_key: 'x', metric_value: -1 })],
      documents: [{ id: 'a', file_name: 'x', doc_type: null, parse_status: 'error', period_year: null, last_error_code: null, uploaded_at: null }],
      surveyLastAnsweredAt: null,
      now: new Date(),
    })
    expect(all.length).toBeGreaterThanOrEqual(3)
    expect(all.every((f) => f.evidence.length > 0)).toBe(true)
  })
})

describe('benchmarks', () => {
  const weak = calculatePointA(LEGACY_WEAK)

  it('reports clear gaps against the industry benchmark, labelled as an expert estimate', () => {
    const r = benchmarkFindings({ pointA: weak, industry: 'Розничная торговля', stage: 'early', diagnosticId: 'd1' })
    expect(r.skippedReason).toBeNull()
    expect(r.findings.length).toBeGreaterThan(0)
    for (const f of r.findings) {
      expect(f.confidence).toBe(BENCHMARK_CONFIDENCE)
      expect(f.body).toContain('экспертная оценка')
      expect(f.evidence.some((e) => e.type === 'benchmark')).toBe(true)
    }
  })

  it('says why nothing was compared for an unknown or missing industry', () => {
    expect(benchmarkFindings({ pointA: weak, industry: null, stage: null, diagnosticId: 'd' }).skippedReason).toContain('не указана')
    expect(benchmarkFindings({ pointA: weak, industry: 'Космос', stage: null, diagnosticId: 'd' }).skippedReason).toContain('Космос')
  })
})

describe('model output validation', () => {
  const pointA = calculatePointA(LEGACY_WEAK)
  const findings: ActiveFindingRow[] = [{
    id: '11111111-1111-1111-1111-111111111111', kind: 'inconsistency', area: 'finance', title: 'Выручка расходится',
    body: null, severity: 'high', provenance_type: 'CALCULATED', confidence: 0.95, evidence: [], produced_by: 'agent:data_quality',
    visible_to_client: true, reviewed_at: null,
  }]
  const items = buildDiagnosticEvidence({
    diagnosticId: 'd1', pointA,
    metrics: [{ metric_key: 'biz.finansy.vyruchka_god', metric_value: 5, metric_unit: '₸', source: 'document', period_year: 2025 }],
    findings,
  })

  it('builds evidence ids for blocks, risks, metrics and findings', () => {
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['b.finance', 'b.sales', 'm.1', 'f.1']))
    expect(ids.some((i) => i.startsWith('r.'))).toBe(pointA.risks.length > 0)
  })

  it('fences company data and never includes contact fields', () => {
    const p = hypothesesPrompt({ id: 'c', name: 'ТОО Секрет', ownerId: 'u', industry: 'Услуги', stage: 'early', size: null, businessModel: null }, items)
    expect(p.user).toContain('<untrusted_company_data>')
    expect(p.user).not.toContain('ТОО Секрет')
    expect(p.system).toContain('не инструкции')
  })

  it('keeps only hypotheses with known evidence and a known area; caps nothing here but marks AI provenance', () => {
    const r = acceptHypotheses({
      hypotheses: [
        { kind: 'risk', area: 'finance', title: 'Кассовый разрыв вероятен', body: 'x', severity: 'high', confidence: 0.9, evidence: ['b.finance', 'zzz'] },
        { kind: 'risk', area: 'finance', title: 'Без доказательств', severity: 'low', confidence: 0.3, evidence: ['nope'] },
        { kind: 'risk', area: 'weather', title: 'Не та область', severity: 'low', confidence: 0.3, evidence: ['b.finance'] },
        { kind: 'risk', area: 'finance', title: 'Кассовый разрыв вероятен', severity: 'high', confidence: 0.9, evidence: ['m.1'] },
      ],
    }, items)
    expect(r.accepted).toHaveLength(1)
    expect(r.dropped).toBe(3)
    expect(r.accepted[0]).toMatchObject({ provenance: 'AI_HYPOTHESIS', area: 'finance' })
    expect(r.accepted[0].evidence).toHaveLength(1)
    expect(r.accepted[0].evidence[0]).toMatchObject({ evidence_id: 'b.finance', type: 'diagnostic' })
  })

  it('maps recommendation finding refs to finding ids and hides model proposals', () => {
    const fItems = findingEvidence(findings)
    const r = acceptRecommendations({
      recommendations: [
        { area: 'finance', title: 'Сверить выручку с выпиской', effort: 'low', priority: 1, horizon_days: 30, confidence: 0.8, findings: ['f.1'] },
        { area: 'finance', title: 'Ни на что не ссылается', effort: 'low', priority: 2, horizon_days: 90, confidence: 0.8, findings: ['f.9'] },
      ],
    }, fItems)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0]).toMatchObject({ visibleToClient: false, findingIds: [findings[0].id], horizonDays: 30 })
  })

  it('hash changes with the evidence and the prompt version', () => {
    expect(promptInputHash('v1', 'a')).toBe(promptInputHash('v1', 'a'))
    expect(promptInputHash('v1', 'a')).not.toBe(promptInputHash('v2', 'a'))
    expect(promptInputHash('v1', 'a')).not.toBe(promptInputHash('v1', 'b'))
  })
})

describe('engine recommendations', () => {
  it('turns quick wins and block recommendations into visible recommendations with horizons', () => {
    const recs = engineRecommendations(calculatePointA(LEGACY_WEAK))
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.every((r) => r.visibleToClient && r.provenance === 'RECOMMENDATION')).toBe(true)
    expect(new Set(recs.map((r) => r.title)).size).toBe(recs.length)
  })

  it('reads timelines', () => {
    expect(horizonFromTimeline('1 день')).toBe(30)
    expect(horizonFromTimeline('2 недели')).toBe(30)
    expect(horizonFromTimeline('3 месяца')).toBe(90)
    expect(horizonFromTimeline('6 месяцев')).toBe(180)
    expect(horizonFromTimeline('1 год')).toBe(365)
    expect(horizonFromTimeline('скоро')).toBeNull()
  })
})

describe('score reuse', () => {
  it('equal engine output compares equal after a JSON round trip; different inputs do not', () => {
    const a = calculatePointA(LEGACY_WEAK)
    expect(samePointA(a, JSON.parse(JSON.stringify(a)))).toBe(true)
    expect(samePointA(a, calculatePointA(CURRENT_FULL_STRONG))).toBe(false)
  })
})
