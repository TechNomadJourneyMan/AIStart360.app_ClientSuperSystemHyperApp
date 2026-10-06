/**
 * lib/point-a/overview.ts — the Point A executive overview (level 1 of the
 * Point A screen; contract: types/point-a-overview.ts).
 *
 *   buildPointAOverview(inputs)        pure: rows in → PointAOverview out
 *   loadPointAOverview(client, tenant) gathers the rows with the CALLER's
 *                                      session client, so RLS decides what
 *                                      the caller may see
 *
 * Everything comes from the company's own rows. A missing input yields null /
 * an empty list plus a «что заполнить» item in `dataGaps` — nothing is
 * synthesised for display.
 *
 * Findings: rows of diagnostic_findings (migration 085) keep their own
 * provenance; the legacy JSON on the current diagnostics row (risks,
 * insights, block issues) is the output of the rule engine and is mapped as
 * provenance CALCULATED, source 'engine:point_a_v1'. Model hypotheses
 * (AI_HYPOTHESIS) appear only when marked visible_to_client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DiagnosticStatus,
  FindingSeverity,
  MaturityLevel,
  OverviewFinding,
  OverviewProblemZone,
  OverviewSourceCounts,
  PointAOverview,
  ProvenanceType,
} from '@/types/point-a-overview'
import type { MetricCategoryKey } from '@/types/metric-catalog'
import type { BlockScore, DataGap, Insight, Risk } from '@/types/onboarding'
import type { TenantContext } from '@/lib/tenancy'
import { completedStepsFromRows, isWizardVisibleKey, SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'
import { overallFill, stepFillFromAnswers } from '@/lib/survey/progress'
import { readMetricsTable, metricsTableCell } from '@/lib/survey/metrics-table'
import { computeDataConfidence, dataCompletenessShare, type TrustSignals } from '@/lib/gri/trust'
import { getMetricRegistry } from '@/lib/metrics/registry'
import { GRI_SECTION_BY_LABEL } from '@/lib/metrics/catalog-helpers'
import { getMetricCategory, isMetricCategoryKey } from '@/lib/metrics/taxonomy'
import { POINT_A_ENGINE } from '@/lib/point-a-engine'

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface OverviewDiagnosticRow {
  overall_score: number | string | null
  health_index: number | string | null
  stage: string | null
  finance_score: BlockScore | null
  sales_score: BlockScore | null
  operations_score: BlockScore | null
  marketing_score: BlockScore | null
  strategy_score: BlockScore | null
  risks: Risk[] | null
  insights: Insight[] | null
  data_gaps: DataGap[] | null
  calculated_at: string | null
}

export interface OverviewFindingRow {
  id: string
  kind: string
  area: string
  title: string
  body: string | null
  severity: string
  provenance_type: string
  confidence: number | string
  produced_by: string
  status: string
  visible_to_client: boolean
  created_at?: string | null
}

export interface OverviewSurveyRow {
  question_key: string
  answer: unknown
  answered_at: string | null
  step?: number | string | null
}

export interface OverviewDocumentRow {
  parse_status: string | null
  /** parsed_data.fields (only the field list is needed). */
  fields: unknown
  uploaded_at: string | null
  doc_type?: string | null
}

export interface PointAOverviewInputs {
  companyId: string
  companyName: string | null
  now: Date
  /** Current diagnostics row, or null when Point A was never calculated. */
  diagnostic: OverviewDiagnosticRow | null
  /** diagnostic_findings rows; null when the table does not exist yet (before 085). */
  findings: OverviewFindingRow[] | null
  surveyRows: OverviewSurveyRow[]
  documents: OverviewDocumentRow[]
  gri: { count: number; currentIndex: number | null; currentAt: string | null }
  integrationsConnected: number
  metrics: { withValue: number; total: number; lastChangedAt: string | null }
  /** A diagnostic_sessions row in collecting / processing. */
  sessionInFlight: boolean
  marketConfirmedCount: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Confidence attached to rule-engine findings: they are deterministic, but
 * computed from self-reported survey answers (the resolver's survey prior is
 * 0.9 for a single answer; a rule combines several).
 */
export const ENGINE_FINDING_CONFIDENCE = 0.8

/** Documents still queued / processing after this long are considered stuck, not «processing». */
export const PROCESSING_WINDOW_MS = 24 * 60 * 60 * 1000

const DAY_MS = 86_400_000

const MATURITY_LABELS: Record<MaturityLevel, string> = {
  seed: 'Старт',
  early: 'Становление',
  growth: 'Рост',
  scale: 'Масштабирование',
}

/** Point A blocks → metric category; «Стратегия» lives under Управление. */
const BLOCKS: ReadonlyArray<{ key: keyof Pick<OverviewDiagnosticRow, 'finance_score' | 'sales_score' | 'operations_score' | 'marketing_score' | 'strategy_score'>; area: MetricCategoryKey; label: string }> = [
  { key: 'finance_score', area: 'finance', label: 'Финансы' },
  { key: 'sales_score', area: 'sales', label: 'Продажи' },
  { key: 'operations_score', area: 'operations', label: 'Операции' },
  { key: 'marketing_score', area: 'marketing', label: 'Маркетинг' },
  { key: 'strategy_score', area: 'management', label: 'Стратегия' },
]

/** Russian area labels used by the rule engine → category key. */
const AREA_BY_RU_LABEL: Record<string, MetricCategoryKey> = {
  'Финансы': 'finance',
  'Продажи': 'sales',
  'Операции': 'operations',
  'Маркетинг': 'marketing',
  'Стратегия': 'management',
  'Клиенты': 'customers',
  'Команда': 'team',
  'Продукт': 'product',
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const ZONE_RANK: Record<OverviewProblemZone['status'], number> = { critical: 0, weak: 1, medium: 2, unknown: 3, strong: 4 }
const PROVENANCE: ReadonlySet<string> = new Set(['FACT', 'CALCULATED', 'INFERRED', 'AI_HYPOTHESIS', 'RECOMMENDATION'])
const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low', 'info'])
const FINDING_KINDS: ReadonlySet<string> = new Set(['risk', 'gap', 'bottleneck', 'opportunity', 'strength', 'data_gap', 'anomaly', 'inconsistency'])

/** Revenue answers that count as «financials present» (current and legacy form). */
const REVENUE_KEYS = ['s9n_revenue_2024', 's2_revenue_2024', 's2_revenue_2025', 's1_current_revenue_year']
const FINANCIAL_DOC_TYPES = new Set(['pl_report', 'financial_report', 'balance_sheet'])

// ─── Small helpers ───────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function ts(v: string | null | undefined): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let best: number | null = null
  for (const v of values) {
    const t = ts(v)
    if (t !== null && (best === null || t > best)) best = t
  }
  return best === null ? null : new Date(best).toISOString()
}

function unwrap(answer: unknown): unknown {
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && 'value' in (answer as Record<string, unknown>)) {
    return (answer as { value: unknown }).value
  }
  return answer
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

function areaLabel(area: string): string {
  return isMetricCategoryKey(area) ? getMetricCategory(area).label : area
}

function maturityFromStage(stage: string | null): PointAOverview['maturity'] {
  if (!stage) return null
  const level: MaturityLevel | null =
    stage === 'seed' || stage === 'early' || stage === 'growth' || stage === 'scale' ? stage
    : stage === 'mature' ? 'scale'
    : null
  return level ? { level, label: MATURITY_LABELS[level] } : null
}

function zoneStatus(block: BlockScore): OverviewProblemZone['status'] {
  switch (block.status) {
    case 'critical': return 'critical'
    case 'weak': return 'weak'
    case 'average': return 'medium'
    case 'strong':
    case 'excellent': return 'strong'
    default: return 'unknown'
  }
}

export function isProcessedDocument(d: OverviewDocumentRow): boolean {
  return (d.parse_status === 'parsed' || d.parse_status === 'completed') && Array.isArray(d.fields) && d.fields.length > 0
}

// ─── Findings ────────────────────────────────────────────────────────────────

function engineFinding(
  id: string,
  kind: OverviewFinding['kind'],
  area: string,
  title: string,
  body: string | null,
  severity: FindingSeverity,
): OverviewFinding {
  return {
    id: `${POINT_A_ENGINE}:${id}`,
    kind,
    area,
    title,
    body,
    severity,
    provenanceType: 'CALCULATED',
    confidence: ENGINE_FINDING_CONFIDENCE,
    source: POINT_A_ENGINE,
  }
}

const RISK_SEVERITY: Record<string, FindingSeverity> = { critical: 'critical', important: 'high', moderate: 'medium' }

/** Legacy insight kind: stored on rows since 2026-10; older rows match the engine's own templates. */
function insightKind(i: Insight): 'strength' | 'risk' | 'opportunity' {
  if (i.kind) return i.kind
  if (/^Выручка растёт/.test(i.text)) return 'strength'
  if (/^(Отказы растут|Повторные клиенты|Единственный канал)/.test(i.text)) return 'risk'
  return 'opportunity'
}

/** Map the rule-engine JSON of a diagnostics row to findings (provenance CALCULATED). */
export function legacyFindings(diag: OverviewDiagnosticRow | null): OverviewFinding[] {
  if (!diag) return []
  const out: OverviewFinding[] = []
  ;(diag.risks ?? []).forEach((r, i) => {
    if (!r?.text) return
    out.push(engineFinding(`risks:${i}`, 'risk', AREA_BY_RU_LABEL[r.area] ?? r.area, r.text, r.impact || null, RISK_SEVERITY[r.level] ?? 'medium'))
  })
  ;(diag.insights ?? []).forEach((ins, i) => {
    if (!ins?.text) return
    const kind = insightKind(ins)
    out.push(engineFinding(`insights:${i}`, kind, AREA_BY_RU_LABEL[ins.area] ?? ins.area, ins.text, null, kind === 'risk' ? 'medium' : 'info'))
  })
  for (const b of BLOCKS) {
    const block = diag[b.key]
    if (!block || typeof block.score !== 'number') continue
    if (block.status === 'critical' && block.top_issues?.[0]) {
      out.push(engineFinding(`blocks:${b.area}`, 'gap', b.area, block.top_issues[0], `Блок «${b.label}»: ${block.score}/100`, 'high'))
    }
    if (block.status === 'excellent' || block.status === 'strong') {
      out.push(engineFinding(`blocks:${b.area}:strength`, 'strength', b.area, `Сильный блок «${b.label}»: ${block.score}/100`, null, 'info'))
    }
  }
  return out
}

/** Rows of diagnostic_findings → findings. Unreviewed model hypotheses are dropped. */
export function tableFindings(rows: OverviewFindingRow[] | null): OverviewFinding[] {
  if (!rows) return []
  const out: OverviewFinding[] = []
  for (const r of rows) {
    if (r.status !== 'active') continue
    if (!PROVENANCE.has(r.provenance_type) || !FINDING_KINDS.has(r.kind)) continue
    if (r.provenance_type === 'AI_HYPOTHESIS' && !r.visible_to_client) continue
    const confidence = num(r.confidence)
    out.push({
      id: r.id,
      kind: r.kind as OverviewFinding['kind'],
      area: r.area,
      title: r.title,
      body: r.body,
      severity: (SEVERITIES.has(r.severity) ? r.severity : 'medium') as FindingSeverity,
      provenanceType: r.provenance_type as ProvenanceType,
      confidence: confidence === null ? 0 : Math.min(1, Math.max(0, confidence)),
      source: r.produced_by,
    })
  }
  return out
}

function bySeverityThenConfidence(a: OverviewFinding, b: OverviewFinding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence
}

// ─── Builder ─────────────────────────────────────────────────────────────────

const TRUST_GAP_TEXT: Record<string, string> = {
  'Финансовые данные': 'Укажите выручку и расходы (анкета, шаг 9) или загрузите P&L',
  'Документы': 'Загрузите финансовые документы (P&L, баланс, выгрузку CRM) — сейчас нет ни одного обработанного',
  'CRM': 'Подключите CRM (Bitrix24 или amoCRM), чтобы продажи считались по фактическим сделкам',
  'Метрики': 'Пересчитайте метрики: значения появятся из анкеты и документов',
  'История GRI': 'Пройдите GRI-оценку готовности к росту',
  'Рыночные данные': 'Подтвердите рыночный анализ',
}

export function buildPointAOverview(inputs: PointAOverviewInputs): PointAOverview {
  const { diagnostic, now } = inputs

  // Survey
  const wizardRows = inputs.surveyRows.filter((r) => isWizardVisibleKey(r.question_key))
  const answers: Record<string, unknown> = {}
  for (const r of wizardRows) answers[r.question_key] = unwrap(r.answer)
  const completedSteps = completedStepsFromRows(wizardRows).length
  const fill = stepFillFromAnswers(answers)
  const surveyFill = fill.reduce((s, f) => s + (f.total > 0 ? f.filled / f.total : 0), 0) / SURVEY_TOTAL_STEPS
  const missingSteps = overallFill(fill).missingSteps

  // Documents
  const processedDocs = inputs.documents.filter(isProcessedDocument)
  const pending = inputs.documents.filter((d) => d.parse_status === 'queued' || d.parse_status === 'processing')
  const recentPending = pending.filter((d) => {
    const t = ts(d.uploaded_at)
    return t !== null && now.getTime() - t <= PROCESSING_WINDOW_MS
  })

  const sources: OverviewSourceCounts = {
    surveyStepsCompleted: completedSteps,
    surveyStepsTotal: SURVEY_TOTAL_STEPS,
    documentsTotal: inputs.documents.length,
    documentsProcessed: processedDocs.length,
    documentsFailed: inputs.documents.filter((d) => d.parse_status === 'error').length,
    documentsPending: pending.length,
    griAssessments: inputs.gri.count,
    integrationsConnected: inputs.integrationsConnected,
    metricsWithValue: inputs.metrics.withValue,
    metricsTotal: inputs.metrics.total,
    processedSources: [
      completedSteps > 0,
      processedDocs.length > 0,
      inputs.gri.count > 0,
      inputs.integrationsConnected > 0,
      inputs.metrics.withValue > 0,
    ].filter(Boolean).length,
  }

  // Timeline + status
  const calculatedAt = diagnostic?.calculated_at ? maxIso([diagnostic.calculated_at]) : null
  const lastInputAt = maxIso([
    ...wizardRows.filter((r) => hasValue(unwrap(r.answer))).map((r) => r.answered_at),
    ...inputs.documents.map((d) => d.uploaded_at),
    inputs.gri.currentAt,
    inputs.metrics.lastChangedAt,
  ])
  let status: DiagnosticStatus
  if (!diagnostic && completedSteps === 0 && inputs.documents.length === 0) status = 'not_started'
  else if (inputs.sessionInFlight || recentPending.length > 0) status = 'processing'
  else if (!diagnostic) status = 'collecting'
  else if (lastInputAt && calculatedAt && Date.parse(lastInputAt) > Date.parse(calculatedAt)) status = 'stale'
  else status = 'ready'

  // Completeness (lib/gri/trust signals + survey fill)
  const table = readMetricsTable(answers.s8n_metrics_table)
  const hasFinancials =
    REVENUE_KEYS.some((k) => hasValue(answers[k])) ||
    metricsTableCell(table, 'sales_amount') !== null ||
    processedDocs.some((d) => FINANCIAL_DOC_TYPES.has(String(d.doc_type ?? '')))
  const calcTs = ts(calculatedAt)
  const signals: TrustSignals = {
    surveyCompletion: wizardRows.length > 0 ? surveyFill : null,
    hasFinancials,
    financialsConsistent: null,
    documentsCount: processedDocs.length,
    hasCrm: inputs.integrationsConnected > 0,
    hasMetrics: inputs.metrics.withValue > 0,
    griHistoryCount: inputs.gri.count,
    dataFreshnessDays: calcTs === null ? null : Math.max(0, Math.floor((now.getTime() - calcTs) / DAY_MS)),
    marketConfirmedCount: inputs.marketConfirmedCount,
  }
  const share = dataCompletenessShare(signals)
  const confidence = computeDataConfidence(signals)
  const completeness = Math.round(share * 100) / 100
  const completenessLevel = confidence?.level ?? (share >= 0.67 ? 'high' : share >= 0.34 ? 'medium' : 'low')

  // «Что заполнить», most valuable first (survey 30%, financials 20%, then the
  // engine's own gaps, then documents / CRM 10% each, then the 5% signals).
  const gapItems: string[] = []
  if (missingSteps.length > 0) {
    gapItems.push(`Заполните анкету: шаг${missingSteps.length > 1 ? 'и' : ''} ${missingSteps.join(', ')} (начато ${SURVEY_TOTAL_STEPS - missingSteps.length} из ${SURVEY_TOTAL_STEPS})`)
  }
  if (!hasFinancials) gapItems.push(TRUST_GAP_TEXT['Финансовые данные'])
  for (const g of diagnostic?.data_gaps ?? []) {
    if (g?.impact) gapItems.push(`Шаг ${g.step}: ${g.impact}`)
  }
  for (const m of ['Документы', 'CRM', 'Метрики', 'История GRI', 'Рыночные данные']) {
    const missing =
      m === 'Документы' ? processedDocs.length === 0
      : m === 'CRM' ? !signals.hasCrm
      : m === 'Метрики' ? !signals.hasMetrics
      : m === 'История GRI' ? inputs.gri.count === 0
      : inputs.marketConfirmedCount === 0
    if (missing) gapItems.push(TRUST_GAP_TEXT[m])
  }
  const dataGaps = Array.from(new Set(gapItems)).slice(0, 5)

  // Findings
  const findings = [...tableFindings(inputs.findings), ...legacyFindings(diagnostic)]

  const keyRisks = findings
    .filter((f) => f.kind === 'risk' || f.kind === 'anomaly' || f.kind === 'inconsistency')
    .sort(bySeverityThenConfidence)
    .slice(0, 5)

  const strengths = findings
    .filter((f) => f.kind === 'strength')
    // diagnostic_findings first (they carry evidence), then engine insights, then strong blocks
    .sort((a, b) => Number(a.source === POINT_A_ENGINE) - Number(b.source === POINT_A_ENGINE) || b.confidence - a.confidence)
    .slice(0, 3)

  const criticalGaps = findings
    .filter((f) => (f.kind === 'gap' || f.kind === 'bottleneck') && SEVERITY_RANK[f.severity] <= SEVERITY_RANK.high)
    .sort(bySeverityThenConfidence)
    .slice(0, 3)

  // Problem zones: weak blocks of the current diagnostic + areas of high-severity findings.
  const zones: OverviewProblemZone[] = []
  for (const b of BLOCKS) {
    const block = diagnostic?.[b.key]
    if (!block || typeof block.score !== 'number') continue
    const s = zoneStatus(block)
    if (s === 'strong') continue
    zones.push({ area: b.area, label: b.label, score: Math.round(block.score), status: s, topIssue: block.top_issues?.[0] ?? null })
  }
  for (const f of findings) {
    if (f.source === POINT_A_ENGINE) continue
    if (!['risk', 'gap', 'bottleneck'].includes(f.kind) || SEVERITY_RANK[f.severity] > SEVERITY_RANK.high) continue
    if (zones.some((z) => z.area === f.area)) continue
    zones.push({ area: f.area, label: areaLabel(f.area), score: null, status: f.severity === 'critical' ? 'critical' : 'weak', topIssue: f.title })
  }
  zones.sort((a, b) => ZONE_RANK[a.status] - ZONE_RANK[b.status] || (a.score ?? 101) - (b.score ?? 101))

  const overall = num(diagnostic?.overall_score)
  const health = num(diagnostic?.health_index)
  const gri = inputs.gri.currentIndex

  return {
    companyId: inputs.companyId,
    companyName: inputs.companyName,
    overallScore: overall === null ? null : Math.round(overall),
    healthIndex: health === null ? null : Math.round(health),
    maturity: diagnostic ? maturityFromStage(diagnostic.stage) : null,
    griIndex: gri !== null && gri > 0 ? Math.round(gri * 100) / 100 : null,
    status,
    completeness,
    completenessLevel,
    dataGaps,
    problemZones: zones.slice(0, 5),
    keyRisks,
    strengths,
    criticalGaps,
    sources,
    calculatedAt,
    lastInputAt,
    generatedAt: now.toISOString(),
  }
}

// ─── Loader (caller's session client; RLS applies) ───────────────────────────

type PgError = { code?: string; message?: string } | null

/** Table not created yet (migration not applied): Postgres 42P01 / PostgREST PGRST205. */
export function isMissingRelation(error: PgError): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '')
}

function failOn(error: PgError, what: string): void {
  if (error) throw new Error(`point-a overview: ${what} failed (${error.code ?? 'unknown'})`)
}

/**
 * Gather every input of the overview for `tenant.companyId`. Core tables
 * (companies, diagnostics, survey_answers, documents) must answer; optional
 * ones (findings, history, sessions, CRM, market) degrade to «absent».
 */
export async function loadPointAOverview(
  client: SupabaseClient,
  tenant: Pick<TenantContext, 'companyId'>,
  now: Date = new Date(),
): Promise<PointAOverview> {
  const companyId = tenant.companyId

  const company = await client.from('companies').select('id, name, user_id').eq('id', companyId).maybeSingle()
  failOn(company.error, 'companies')
  if (!company.data) throw new Error('point-a overview: company not visible')
  const ownerId = (company.data.user_id as string | null | undefined) ?? null
  // Rows of this company, plus older rows that carry only the primary owner's
  // user_id (company_id was not always stamped). Ids go into a PostgREST `or`
  // filter, so only plain id characters are accepted there.
  const safe = (v: string) => /^[A-Za-z0-9_-]+$/.test(v)
  const scope = ownerId && safe(ownerId) && safe(companyId)
    ? `company_id.eq.${companyId},user_id.eq.${ownerId}`
    : `company_id.eq.${safe(companyId) ? companyId : '00000000-0000-0000-0000-000000000000'}`

  const diagColumns =
    'overall_score, health_index, stage, finance_score, sales_score, operations_score, marketing_score, strategy_score, risks, insights, data_gaps, calculated_at'

  const [diag, survey, docs, gri, metricRows] = await Promise.all([
    client.from('diagnostics').select(diagColumns).or(scope).eq('is_current', true)
      .order('calculated_at', { ascending: false }).limit(1),
    ownerId
      ? client.from('survey_answers').select('question_key, answer, answered_at, step').eq('user_id', ownerId)
      : client.from('survey_answers').select('question_key, answer, answered_at, step').eq('company_id', companyId),
    client.from('documents').select('parse_status, uploaded_at, doc_type, fields:parsed_data->fields').or(scope),
    client.from('gri_assessments').select('gri_index, is_current, created_at, section_avgs').or(scope)
      .order('created_at', { ascending: false }),
    client.from('metrics').select('metric_key, metric_value').eq('company_id', companyId).not('metric_value', 'is', null),
  ])
  failOn(diag.error, 'diagnostics')
  failOn(survey.error, 'survey_answers')
  failOn(docs.error, 'documents')

  const [findings, history, sessions, crm, market] = await Promise.all([
    client.from('diagnostic_findings')
      .select('id, kind, area, title, body, severity, provenance_type, confidence, produced_by, status, visible_to_client, created_at')
      .eq('company_id', companyId).eq('status', 'active').order('created_at', { ascending: false }).limit(100),
    client.from('metric_value_history').select('recorded_at').eq('company_id', companyId)
      .order('recorded_at', { ascending: false }).limit(1),
    client.from('diagnostic_sessions').select('id').eq('company_id', companyId)
      .in('status', ['collecting', 'processing']).limit(1),
    ownerId
      ? client.from('crm_provider_connections').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).eq('is_active', true)
      : Promise.resolve({ count: 0, error: null }),
    ownerId
      ? client.from('market_analysis_answers').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).eq('status', 'confirmed')
      : Promise.resolve({ count: 0, error: null }),
  ])
  if (findings.error && !isMissingRelation(findings.error)) failOn(findings.error, 'diagnostic_findings')

  // Metrics with a value: registry keys with a non-null row + GRI blocks scored by the assessment.
  const registry = getMetricRegistry()
  const registryIds = new Set(registry.map((e) => e.id))
  const valued = new Set<string>()
  if (!metricRows.error) {
    for (const r of (metricRows.data ?? []) as Array<{ metric_key: string }>) {
      if (registryIds.has(r.metric_key)) valued.add(r.metric_key)
    }
  }
  const griRows = gri.error
    ? []
    : ((gri.data ?? []) as Array<{ gri_index: number | string | null; is_current: boolean; created_at: string; section_avgs: Record<string, unknown> | null }>)
  const currentGri = griRows.find((r) => r.is_current) ?? griRows[0] ?? null
  if (currentGri) {
    const avgs = currentGri.section_avgs
    if (avgs && typeof avgs === 'object') {
      for (const e of registry) {
        if (e.namespace !== 'gri' || valued.has(e.id)) continue
        const sectionId = GRI_SECTION_BY_LABEL[e.label]
        if (sectionId && (num(avgs[sectionId]) ?? 0) > 0) valued.add(e.id)
      }
    }
  }

  const diagRow = ((diag.data ?? [])[0] ?? null) as OverviewDiagnosticRow | null

  return buildPointAOverview({
    companyId,
    companyName: (company.data?.name as string | null | undefined) ?? null,
    now,
    diagnostic: diagRow,
    findings: findings.error ? null : ((findings.data ?? []) as OverviewFindingRow[]),
    surveyRows: (survey.data ?? []) as OverviewSurveyRow[],
    documents: (docs.data ?? []) as OverviewDocumentRow[],
    gri: {
      count: griRows.length,
      currentIndex: currentGri ? num(currentGri.gri_index) : null,
      currentAt: currentGri?.created_at ?? null,
    },
    integrationsConnected: crm.error ? 0 : (crm.count ?? 0),
    metrics: {
      withValue: valued.size,
      total: registry.length,
      lastChangedAt: history.error ? null : ((history.data?.[0] as { recorded_at?: string } | undefined)?.recorded_at ?? null),
    },
    sessionInFlight: !sessions.error && (sessions.data ?? []).length > 0,
    marketConfirmedCount: market.error ? 0 : (market.count ?? 0),
  })
}
