/**
 * Snapshot inputs as lib/reports/versions.ts loads them from the database:
 * a diagnostics row of the rule engine, the session overview, findings of the
 * pipeline agents (one reviewed and one unreviewed model hypothesis) and
 * recommendations (rules, a reviewed model one, an unreviewed model one).
 */
import type { SnapshotInputs } from '@/lib/reports/snapshot'
import type { PointAOverview } from '@/types/point-a-overview'

export const DIAG_ID = '11111111-1111-4111-8111-111111111111'
export const SESSION_ID = '22222222-2222-4222-8222-222222222222'
export const F_QUALITY = '33333333-3333-4333-8333-333333333331'
export const F_AI_REVIEWED = '33333333-3333-4333-8333-333333333332'
export const F_AI_HIDDEN = '33333333-3333-4333-8333-333333333333'
export const F_DISMISSED = '33333333-3333-4333-8333-333333333334'
export const R_RULES = '44444444-4444-4444-8444-444444444441'
export const R_AI_REVIEWED = '44444444-4444-4444-8444-444444444442'
export const R_AI_HIDDEN = '44444444-4444-4444-8444-444444444443'

export const HIDDEN_HYPOTHESIS_TITLE = 'Секретная непроверенная гипотеза о кассовом разрыве'
export const HIDDEN_RECOMMENDATION_TITLE = 'Непроверенное предложение модели уволить отдел продаж'

export function overview(): PointAOverview {
  return {
    companyId: 'co-1', companyName: 'ТОО Ромашка', overallScore: 47, healthIndex: 38,
    maturity: { level: 'early', label: 'Становление' }, griIndex: 6.4, status: 'ready',
    completeness: 0.62, completenessLevel: 'medium', dataGaps: ['Загрузите P&L за последний год'],
    problemZones: [{ area: 'sales', label: 'Продажи', score: 28, status: 'critical', topIssue: 'Нет CRM' }],
    keyRisks: [], strengths: [], criticalGaps: [],
    sources: {
      surveyStepsCompleted: 9, surveyStepsTotal: 12, documentsTotal: 3, documentsProcessed: 2, documentsFailed: 1,
      documentsPending: 0, griAssessments: 1, integrationsConnected: 0, metricsWithValue: 24, metricsTotal: 148, processedSources: 4,
    },
    calculatedAt: '2026-10-05T12:00:00.000Z', lastInputAt: '2026-10-05T11:30:00.000Z', generatedAt: '2026-10-05T12:05:00.000Z',
  }
}

export function inputs(over: Partial<SnapshotInputs> = {}): SnapshotInputs {
  return {
    company: { name: 'ТОО Ромашка', industry: 'Розничная торговля', stage: 'early', size: '11-50' },
    session: { id: SESSION_ID, completed_at: '2026-10-05T12:05:00.000Z', overview: overview() },
    diagnostic: {
      id: DIAG_ID,
      overall_score: '47',
      health_index: '38',
      stage: 'early',
      finance_score: { score: 52, status: 'average', top_issues: ['Нет учёта маржинальности'], recommendations: ['Ввести учёт маржи'] },
      sales_score: { score: 28, status: 'critical', top_issues: ['Нет CRM'], recommendations: ['Внедрить CRM'] },
      operations_score: { score: 61, status: 'average', top_issues: [], recommendations: [] },
      marketing_score: { score: 44, status: 'weak', top_issues: ['Один канал привлечения'], recommendations: [] },
      strategy_score: { score: 73, status: 'strong', top_issues: [], recommendations: [] },
      risks: [{ level: 'critical', area: 'Продажи', text: 'Продажи держатся на собственнике', impact: 'Рост упирается в одного человека' }],
      insights: [{ text: 'Выручка растёт третий год подряд', area: 'Финансы', kind: 'strength' }],
      quick_wins: [],
      data_gaps: [],
      calculated_at: '2026-10-05T12:00:00.000Z',
    },
    findings: [
      {
        id: F_QUALITY, kind: 'inconsistency', area: 'finance', title: '«Выручка за год»: источники расходятся на 60%',
        body: 'Анкета и документ дают разные значения', severity: 'high', provenance_type: 'CALCULATED', confidence: '0.80',
        evidence: [
          { type: 'metric', ref: 'biz.finansy.vyruchka_god', field: 'survey', value: 100000000 },
          { type: 'metric', ref: 'biz.finansy.vyruchka_god', field: 'document', value: 40000000 },
        ],
        produced_by: 'agent:data_quality', model: null, status: 'active', visible_to_client: true, reviewed_at: null,
      },
      {
        id: F_AI_REVIEWED, kind: 'bottleneck', area: 'sales', title: 'Продажи зависят от одного канала привлечения',
        body: 'Нет CRM и единственный канал.', severity: 'high', provenance_type: 'AI_HYPOTHESIS', confidence: '0.70',
        evidence: [{ type: 'diagnostic', ref: DIAG_ID, field: 'sales_score', value: 28, evidence_id: 'b.sales' }],
        produced_by: 'agent:diagnostic:ai', model: 'anthropic/claude-sonnet-4.5', status: 'active', visible_to_client: true,
        reviewed_at: '2026-10-05T13:00:00.000Z',
      },
      {
        id: F_AI_HIDDEN, kind: 'risk', area: 'finance', title: HIDDEN_HYPOTHESIS_TITLE,
        body: 'Модель предполагает', severity: 'critical', provenance_type: 'AI_HYPOTHESIS', confidence: '0.60',
        evidence: [{ type: 'diagnostic', ref: DIAG_ID, field: 'finance_score', value: 52 }],
        produced_by: 'agent:diagnostic:ai', model: 'anthropic/claude-sonnet-4.5', status: 'active', visible_to_client: false, reviewed_at: null,
      },
      {
        id: F_DISMISSED, kind: 'risk', area: 'finance', title: 'Отклонённый сотрудником вывод',
        body: null, severity: 'medium', provenance_type: 'INFERRED', confidence: '0.50',
        evidence: [{ type: 'survey', ref: 's9n_revenue_2024' }],
        produced_by: 'agent:data_quality', model: null, status: 'dismissed', visible_to_client: false, reviewed_at: '2026-10-05T13:00:00.000Z',
      },
    ],
    recommendations: [
      {
        id: R_RULES, area: 'sales', title: 'Внедрить CRM', body: 'Блок «Продажи»: 28/100', expected_impact: null, effort: null,
        priority: 1, horizon_days: 90, provenance_type: 'RECOMMENDATION', confidence: '0.80', produced_by: 'agent:recommendation',
        model: null, status: 'proposed', visible_to_client: true, reviewed_at: null, finding_ids: [],
      },
      {
        id: R_AI_REVIEWED, area: 'sales', title: 'Запустить второй канал привлечения', body: 'Ответственный — РОП',
        expected_impact: 'Снижение зависимости от одного канала', effort: 'medium', priority: 2, horizon_days: 30,
        provenance_type: 'RECOMMENDATION', confidence: '0.65', produced_by: 'agent:recommendation:ai',
        model: 'anthropic/claude-sonnet-4.5', status: 'accepted', visible_to_client: true, reviewed_at: '2026-10-05T13:10:00.000Z',
        finding_ids: [F_AI_REVIEWED, F_AI_HIDDEN],
      },
      {
        id: R_AI_HIDDEN, area: 'team', title: HIDDEN_RECOMMENDATION_TITLE, body: null, expected_impact: null, effort: 'high',
        priority: 1, horizon_days: 30, provenance_type: 'RECOMMENDATION', confidence: '0.55', produced_by: 'agent:recommendation:ai',
        model: 'anthropic/claude-sonnet-4.5', status: 'proposed', visible_to_client: false, reviewed_at: null, finding_ids: [F_AI_HIDDEN],
      },
    ],
    generatedAt: new Date('2026-10-06T12:00:00.000Z'),
    ...over,
  }
}
