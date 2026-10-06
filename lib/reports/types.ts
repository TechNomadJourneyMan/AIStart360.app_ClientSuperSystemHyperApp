/**
 * lib/reports/types.ts — the frozen report snapshot stored in
 * report_versions.content (migration 085) and everything that renders it.
 *
 * A report version is self-contained: the UI, the API and the PDF read only
 * this object, never live tables, so a published version never changes when
 * the company's data changes afterwards.
 *
 * Every item that states something about the business carries its
 * provenance (FACT / CALCULATED / INFERRED / AI_HYPOTHESIS / RECOMMENDATION),
 * a confidence 0..1, who produced it and the evidence it rests on.
 */

export const REPORT_TYPES = ['point_a', 'full', 'gri', 'point_b'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const REPORT_STATUSES = ['draft', 'ready', 'published', 'superseded', 'failed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export type ReportProvenanceType = 'FACT' | 'CALCULATED' | 'INFERRED' | 'AI_HYPOTHESIS' | 'RECOMMENDATION'
export type ReportSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Badge labels used by the PDF and the GIGA preview (docs/platform/04-point-a.md §2.5). */
export const PROVENANCE_LABELS: Record<ReportProvenanceType, string> = {
  FACT: 'Факт',
  CALCULATED: 'Расчёт',
  INFERRED: 'Вывод по правилам',
  AI_HYPOTHESIS: 'Гипотеза ИИ',
  RECOMMENDATION: 'Рекомендация',
}

export const SEVERITY_LABELS: Record<ReportSeverity, string> = {
  critical: 'Критично',
  high: 'Высокая важность',
  medium: 'Средняя важность',
  low: 'Низкая важность',
  info: 'Информация',
}

const PRODUCER_LABELS: Array<[RegExp, string]> = [
  [/^engine:/, 'правила методики Точки А'],
  [/^agent:data_quality$/, 'проверка качества данных'],
  [/^agent:benchmark$/, 'сравнение с ориентирами отрасли'],
  [/^agent:diagnostic:ai$/, 'гипотезы ИИ, проверенные сотрудником'],
  [/^agent:recommendation$/, 'рекомендации по правилам методики'],
  [/^agent:recommendation:ai$/, 'рекомендации ИИ, проверенные сотрудником'],
  [/^staff:/, 'эксперт AIStart360'],
]

/** Who produced an item, in client words («правила методики», «проверка качества данных» …). */
export function producerLabel(source: string): string {
  return PRODUCER_LABELS.find(([re]) => re.test(source))?.[1] ?? 'агент диагностики'
}

export const REPORT_CONTENT_SCHEMA = 'point_a_report@1'

export interface ReportEvidence {
  /** survey | document | metric | diagnostic | benchmark | finding | platform */
  type: string
  ref: string
  field: string | null
  value: string | number | null
  quote: string | null
}

export interface ReportFinding {
  /** diagnostic_findings.id, or `engine:point_a_v1:<path>` for rule-engine items of the diagnostics row. */
  id: string
  kind: string
  area: string
  area_label: string
  title: string
  body: string | null
  severity: ReportSeverity
  provenance_type: ReportProvenanceType
  confidence: number
  /** 'engine:point_a_v1' | 'agent:<key>' | 'agent:<key>:ai' | 'staff:<id>' */
  source: string
  /** Model id for reviewed model output, else null. */
  model: string | null
  /** When a person checked it (model output is included only after a review). */
  reviewed_at: string | null
  evidence: ReportEvidence[]
}

export interface ReportRecommendation {
  id: string
  area: string
  area_label: string
  title: string
  body: string | null
  expected_impact: string | null
  effort: 'low' | 'medium' | 'high' | null
  priority: number
  horizon_days: number | null
  provenance_type: ReportProvenanceType
  confidence: number
  source: string
  model: string | null
  reviewed_at: string | null
  /** proposed | accepted | done */
  status: string
  /** Findings of this report the recommendation addresses. */
  finding_ids: string[]
}

export interface ReportBlock {
  key: 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy'
  label: string
  score: number
  status: string
  top_issues: string[]
  recommendations: string[]
}

export interface ReportProblemZone {
  area: string
  label: string
  score: number | null
  status: string
  top_issue: string | null
}

export interface ReportSourceCounts {
  survey_steps_completed: number
  survey_steps_total: number
  documents_total: number
  documents_processed: number
  gri_assessments: number
  integrations_connected: number
  metrics_with_value: number
  metrics_total: number
}

/** One input the report rests on, in words the client understands. */
export interface ReportSource {
  kind: 'survey' | 'documents' | 'gri' | 'integrations' | 'metrics' | 'diagnostic' | 'agents'
  label: string
  detail: string
  /** Row id when the source is one row (diagnostic). */
  ref: string | null
}

export interface ReportNarrative {
  summary: string
  key_points: string[]
  provenance_type: 'AI_HYPOTHESIS'
  model: string
  prompt_version: string
  generated_at: string
}

/**
 * report_versions.content for report_type 'point_a'.
 *
 * `generated_at` and `narrative` are excluded from data_hash (see
 * reportDataHash): the same data must give the same hash, whenever and
 * however many times it is assembled.
 */
export interface PointAReportContent {
  schema: typeof REPORT_CONTENT_SCHEMA
  report_type: 'point_a'
  title: string
  company: {
    name: string | null
    industry: string | null
    stage: string | null
    size: string | null
  }
  session: { id: string; completed_at: string | null }
  diagnostic: {
    id: string
    calculated_at: string | null
    overall_score: number | null
    health_index: number | null
    maturity: { level: string; label: string } | null
    gri_index: number | null
    blocks: ReportBlock[]
  }
  problem_zones: ReportProblemZone[]
  findings: ReportFinding[]
  recommendations: ReportRecommendation[]
  data: {
    completeness: number | null
    completeness_level: 'low' | 'medium' | 'high' | null
    gaps: string[]
    sources: ReportSourceCounts | null
    last_input_at: string | null
  }
  sources: ReportSource[]
  /** Calculation date of the Point A score the report is built on. */
  calculated_at: string | null
  /** When this snapshot was assembled (not part of data_hash). */
  generated_at: string
  /** Optional executive narrative by the model (not part of data_hash). */
  narrative: ReportNarrative | null
}

export type ReportContent = PointAReportContent

/** report_versions.provenance */
export interface ReportProvenance {
  agent_key: string
  run_ids: string[]
  model: string | null
  prompt_version: string | null
  tools: string[]
  sources: Array<{ type: string; ref: string }>
  data_hash: string
  generated_at: string
  /**
   * Staff-only details. Client API responses strip this key. RLS is
   * row-level, so a published row's provenance is readable by the tenant
   * through PostgREST — keep only counts and states here, never content.
   */
  staff?: {
    hidden_hypotheses: number
    unreviewed_model_recommendations: number
    narrative: { state: string; reason: string | null }
  }
}
