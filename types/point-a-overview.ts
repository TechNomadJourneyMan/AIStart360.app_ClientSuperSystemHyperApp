/**
 * Contract of GET /api/v1/point-a/overview — the Point A executive overview
 * (level 1 of the Point A screen, docs/platform/04-point-a.md).
 *
 * Every number here is computed from the company's own rows; when an input is
 * missing the field is null and `dataGaps` says what to fill. Nothing is
 * synthesised for display.
 */
import type { MetricCategoryKey } from './metric-catalog'

export type ProvenanceType = 'FACT' | 'CALCULATED' | 'INFERRED' | 'AI_HYPOTHESIS' | 'RECOMMENDATION'

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Maturity ladder derived from the Point A score (and GRI when present). */
export type MaturityLevel = 'seed' | 'early' | 'growth' | 'scale'

export type DiagnosticStatus =
  | 'not_started'      // no survey answers yet
  | 'collecting'       // survey in progress / not yet calculated
  | 'processing'       // a diagnostic session or file processing is running
  | 'ready'            // a current diagnostic exists
  | 'stale'            // inputs changed after the last calculation

export interface OverviewFinding {
  id: string                     // diagnostic_findings.id or `${source}:${index}` for legacy JSON findings
  kind: 'risk' | 'gap' | 'bottleneck' | 'opportunity' | 'strength' | 'data_gap' | 'anomaly' | 'inconsistency'
  area: MetricCategoryKey | string
  title: string
  body: string | null
  severity: FindingSeverity
  provenanceType: ProvenanceType
  confidence: number             // 0..1
  source: string                 // 'engine:point_a_v1' | 'agent:diagnostic' | 'staff:…'
}

export interface OverviewProblemZone {
  area: MetricCategoryKey | string
  label: string                  // Russian label, e.g. «Финансы»
  score: number | null           // 0..100 block score when known
  status: 'critical' | 'weak' | 'medium' | 'strong' | 'unknown'
  topIssue: string | null
}

export interface OverviewSourceCounts {
  surveyStepsCompleted: number   // 0..12
  surveyStepsTotal: number       // 12
  documentsTotal: number
  documentsProcessed: number     // parse_status in (parsed, completed) with ≥1 extracted field
  documentsFailed: number
  documentsPending: number       // queued / processing
  griAssessments: number         // 0 or more (current counts as 1)
  integrationsConnected: number  // crm_provider_connections active
  metricsWithValue: number
  metricsTotal: number
  /** Number of distinct source kinds that contributed at least one input. */
  processedSources: number
}

export interface PointAOverview {
  companyId: string
  companyName: string | null
  /** 0..100, null when no diagnostic has been calculated yet. */
  overallScore: number | null
  healthIndex: number | null
  maturity: { level: MaturityLevel; label: string } | null
  griIndex: number | null        // 0..10 from the current GRI assessment
  status: DiagnosticStatus
  /** 0..1 — share of the inputs Point A needs that are present (lib/gri/trust + survey fill). */
  completeness: number
  completenessLevel: 'low' | 'medium' | 'high'
  /** What to add to raise completeness, most valuable first (Russian, ≤ 5 items). */
  dataGaps: string[]
  problemZones: OverviewProblemZone[]       // weakest first, ≤ 5
  keyRisks: OverviewFinding[]               // severity ≥ high first, ≤ 5
  strengths: OverviewFinding[]              // ≤ 3
  criticalGaps: OverviewFinding[]           // ≤ 3 (kind gap/bottleneck with severity ≥ high)
  sources: OverviewSourceCounts
  /** ISO timestamps. */
  calculatedAt: string | null               // current diagnostics.calculated_at
  lastInputAt: string | null                // newest survey answer / document / GRI / metric
  generatedAt: string
}

export interface PointAOverviewResponse {
  ok: true
  data: PointAOverview
}
