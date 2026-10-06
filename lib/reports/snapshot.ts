/**
 * lib/reports/snapshot.ts — the frozen Point A report snapshot (pure).
 *
 *   buildPointAReportContent(inputs)  rows in → report_versions.content out
 *   reportDataHash(content)           sha256 of the data part of the content
 *   narrativePrompt(content)          what the optional narrative model sees
 *   acceptNarrative(output, prompt)   validation of the model's narrative
 *
 * What a client-facing snapshot contains (docs/platform/04-point-a.md §2.5):
 *   • the Point A score of the session's diagnostics row (blocks, maturity) and
 *     the rule-engine risks / insights / block findings (CALCULATED);
 *   • active findings of the pipeline agents that are visible to the client;
 *     model hypotheses only after a staff review (AI_HYPOTHESIS);
 *   • recommendations visible to the client; model proposals only after review;
 *   • completeness, gaps, the inputs used, the calculation date.
 * Unreviewed model output is never part of the content; only its count goes to
 * the staff part of provenance.
 *
 * Determinism: the same rows give the same content (canonical ordering), and
 * the hash leaves out `generated_at` and the narrative, so assembling the same
 * data again — or adding a narrative — never makes a "new" version.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { fenceUntrusted, UNTRUSTED_DATA_RULES } from '@/lib/ai/gateway'
import { stableStringify } from '@/lib/agents/tools'
import { maskPii } from '@/lib/assistant/mascot/sanitize'
import { getMetricCategory, isMetricCategoryKey } from '@/lib/metrics/taxonomy'
import { legacyFindings, type OverviewDiagnosticRow } from '@/lib/point-a/overview'
import type { PointAOverview } from '@/types/point-a-overview'
import type { BlockScore, QuickWin } from '@/types/onboarding'
import {
  producerLabel,
  REPORT_CONTENT_SCHEMA,
  type PointAReportContent,
  type ReportBlock,
  type ReportEvidence,
  type ReportFinding,
  type ReportNarrative,
  type ReportProvenanceType,
  type ReportRecommendation,
  type ReportSeverity,
  type ReportSource,
} from './types'

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface SnapshotDiagnosticRow extends OverviewDiagnosticRow {
  id: string
  quick_wins?: QuickWin[] | null
}

export interface SnapshotFindingRow {
  id: string
  kind: string
  area: string
  title: string
  body: string | null
  severity: string
  provenance_type: string
  confidence: number | string
  evidence: unknown
  produced_by: string
  model: string | null
  status: string
  visible_to_client: boolean
  reviewed_at: string | null
}

export interface SnapshotRecommendationRow {
  id: string
  area: string
  title: string
  body: string | null
  expected_impact: string | null
  effort: string | null
  priority: number | string
  horizon_days: number | string | null
  provenance_type: string
  confidence: number | string
  produced_by: string
  model: string | null
  status: string
  visible_to_client: boolean
  reviewed_at: string | null
  finding_ids: string[] | null
}

export interface SnapshotInputs {
  company: { name: string | null; industry: string | null; stage: string | null; size: string | null } | null
  session: { id: string; completed_at: string | null; overview: PointAOverview | null }
  diagnostic: SnapshotDiagnosticRow
  /** Active findings of the company — ALL of them; the builder decides what the client may see. */
  findings: SnapshotFindingRow[]
  /** Recommendations of the company (any status); the builder filters. */
  recommendations: SnapshotRecommendationRow[]
  generatedAt: Date
}

export interface SnapshotResult {
  content: PointAReportContent
  dataHash: string
  /** Report confidence: completeness of the inputs (0..1), null when unknown. */
  confidence: number | null
  excluded: { hiddenHypotheses: number; unreviewedModelRecommendations: number }
  /** Rows the snapshot rests on (provenance.sources). */
  sourceRefs: Array<{ type: string; ref: string }>
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_REPORT_FINDINGS = 60
export const MAX_REPORT_RECOMMENDATIONS = 40
const MAX_EVIDENCE = 8

const BLOCKS: ReadonlyArray<{ key: ReportBlock['key']; column: keyof SnapshotDiagnosticRow; label: string }> = [
  { key: 'finance', column: 'finance_score', label: 'Финансы' },
  { key: 'sales', column: 'sales_score', label: 'Продажи' },
  { key: 'operations', column: 'operations_score', label: 'Операции' },
  { key: 'marketing', column: 'marketing_score', label: 'Маркетинг' },
  { key: 'strategy', column: 'strategy_score', label: 'Стратегия' },
]

const SEVERITY_RANK: Record<ReportSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SEVERITIES = new Set<string>(Object.keys(SEVERITY_RANK))
const PROVENANCE = new Set<string>(['FACT', 'CALCULATED', 'INFERRED', 'AI_HYPOTHESIS', 'RECOMMENDATION'])
const VISIBLE_RECOMMENDATION_STATUSES = new Set(['proposed', 'accepted', 'done'])

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const clamp01 = (v: number | null): number => (v === null ? 0 : Math.min(1, Math.max(0, v)))
const round2 = (v: number): number => Math.round(v * 100) / 100
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

function areaLabel(area: string): string {
  return isMetricCategoryKey(area) ? getMetricCategory(area).label : area
}

function severityOf(v: string): ReportSeverity {
  return (SEVERITIES.has(v) ? v : 'medium') as ReportSeverity
}

/** Model output: a hypothesis, or anything produced by a `…:ai` producer / with a model id. */
function isModelOutput(r: { provenance_type: string; produced_by: string; model: string | null }): boolean {
  return r.provenance_type === 'AI_HYPOTHESIS' || r.produced_by.endsWith(':ai') || Boolean(r.model)
}

function normalizeEvidence(raw: unknown): ReportEvidence[] {
  if (!Array.isArray(raw)) return []
  const out: ReportEvidence[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const type = str(o.type, 30)
    const ref = str(o.ref, 200)
    if (!type || !ref) continue
    const value = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : str(o.value, 200)
    out.push({
      type,
      ref,
      field: str(o.field, 100),
      value: value ?? null,
      quote: str(o.quote, 300) ?? str(o.label, 300),
    })
    if (out.length >= MAX_EVIDENCE) break
  }
  return out
}

function byFinding(a: ReportFinding, b: ReportFinding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.source.localeCompare(b.source) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

function byRecommendation(a: ReportRecommendation, b: ReportRecommendation): number {
  return a.priority - b.priority || (a.horizon_days ?? 999) - (b.horizon_days ?? 999)
    || a.source.localeCompare(b.source) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

function isoOrNull(v: string | Date | null | undefined): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ─── Builder ─────────────────────────────────────────────────────────────────

function engineFindings(diag: SnapshotDiagnosticRow): ReportFinding[] {
  return legacyFindings(diag).map((f) => {
    const path = f.id.slice(f.id.indexOf(':', f.id.indexOf(':') + 1) + 1) // drop the 'engine:point_a_v1:' prefix
    return {
      id: f.id,
      kind: f.kind,
      area: String(f.area),
      area_label: areaLabel(String(f.area)),
      title: f.title.slice(0, 300),
      body: f.body,
      severity: f.severity,
      provenance_type: f.provenanceType,
      confidence: round2(f.confidence),
      source: f.source,
      model: null,
      reviewed_at: null,
      evidence: [{ type: 'diagnostic', ref: diag.id, field: path, value: null, quote: null }],
    }
  })
}

function tableFinding(r: SnapshotFindingRow): ReportFinding | null {
  if (r.status !== 'active' || !r.visible_to_client) return null
  if (!PROVENANCE.has(r.provenance_type)) return null
  if (isModelOutput(r) && !r.reviewed_at) return null
  return {
    id: r.id,
    kind: r.kind,
    area: r.area,
    area_label: areaLabel(r.area),
    title: r.title.slice(0, 300),
    body: r.body ? r.body.slice(0, 2000) : null,
    severity: severityOf(r.severity),
    provenance_type: r.provenance_type as ReportProvenanceType,
    confidence: round2(clamp01(num(r.confidence))),
    source: r.produced_by,
    model: r.model ?? null,
    reviewed_at: isoOrNull(r.reviewed_at),
    evidence: normalizeEvidence(r.evidence),
  }
}

function tableRecommendation(r: SnapshotRecommendationRow, findingIds: Set<string>): ReportRecommendation | null {
  if (!VISIBLE_RECOMMENDATION_STATUSES.has(r.status) || !r.visible_to_client) return null
  if (!PROVENANCE.has(r.provenance_type)) return null
  if (isModelOutput(r) && !r.reviewed_at) return null
  const effort = r.effort === 'low' || r.effort === 'medium' || r.effort === 'high' ? r.effort : null
  return {
    id: r.id,
    area: r.area,
    area_label: areaLabel(r.area),
    title: r.title.slice(0, 300),
    body: r.body ? r.body.slice(0, 2000) : null,
    expected_impact: r.expected_impact ? r.expected_impact.slice(0, 300) : null,
    effort,
    priority: Math.min(5, Math.max(1, Math.round(num(r.priority) ?? 3))),
    horizon_days: num(r.horizon_days),
    provenance_type: r.provenance_type as ReportProvenanceType,
    confidence: round2(clamp01(num(r.confidence))),
    source: r.produced_by,
    model: r.model ?? null,
    reviewed_at: isoOrNull(r.reviewed_at),
    status: r.status,
    // Only references the client can follow inside this report.
    finding_ids: (r.finding_ids ?? []).filter((id) => findingIds.has(id)).sort(),
  }
}

function blocksOf(diag: SnapshotDiagnosticRow): ReportBlock[] {
  const out: ReportBlock[] = []
  for (const b of BLOCKS) {
    const block = diag[b.column] as BlockScore | null | undefined
    if (!block || typeof block.score !== 'number') continue
    out.push({
      key: b.key,
      label: b.label,
      score: block.score,
      status: String(block.status ?? ''),
      top_issues: (block.top_issues ?? []).filter((x) => typeof x === 'string').slice(0, 5),
      recommendations: (block.recommendations ?? []).filter((x) => typeof x === 'string').slice(0, 5),
    })
  }
  return out
}

function sourcesOf(overview: PointAOverview | null, diag: SnapshotDiagnosticRow, producers: string[]): ReportSource[] {
  const out: ReportSource[] = []
  const s = overview?.sources
  if (s) {
    out.push({ kind: 'survey', label: 'Анкета', detail: `заполнено шагов: ${s.surveyStepsCompleted} из ${s.surveyStepsTotal}`, ref: null })
    out.push({
      kind: 'documents', label: 'Документы',
      detail: s.documentsTotal ? `обработано: ${s.documentsProcessed} из ${s.documentsTotal}` : 'не загружены', ref: null,
    })
    out.push({ kind: 'gri', label: 'GRI-оценка', detail: s.griAssessments ? `оценок: ${s.griAssessments}` : 'не пройдена', ref: null })
    out.push({
      kind: 'integrations', label: 'Интеграции (CRM)',
      detail: s.integrationsConnected ? `подключено: ${s.integrationsConnected}` : 'не подключены', ref: null,
    })
    out.push({ kind: 'metrics', label: 'Метрики', detail: `со значением: ${s.metricsWithValue} из ${s.metricsTotal}`, ref: null })
  }
  out.push({ kind: 'diagnostic', label: 'Расчёт Точки А', detail: 'индекс и баллы блоков по правилам методики', ref: diag.id })
  const labels: string[] = []
  for (const p of producers) {
    const label = producerLabel(p)
    if (!labels.includes(label)) labels.push(label)
  }
  if (labels.length) out.push({ kind: 'agents', label: 'Выводы и рекомендации', detail: labels.join('; '), ref: null })
  return out
}

export function buildPointAReportContent(inputs: SnapshotInputs): SnapshotResult {
  const { diagnostic: diag, session } = inputs
  const overview = session.overview

  const fromTable: ReportFinding[] = []
  let hiddenHypotheses = 0
  for (const r of inputs.findings) {
    const f = tableFinding(r)
    if (f) fromTable.push(f)
    else if (r.status === 'active' && isModelOutput(r)) hiddenHypotheses += 1
  }
  const findings = [...engineFindings(diag), ...fromTable].sort(byFinding).slice(0, MAX_REPORT_FINDINGS)
  const findingIds = new Set(findings.map((f) => f.id))

  const recommendations: ReportRecommendation[] = []
  let unreviewedModelRecommendations = 0
  for (const r of inputs.recommendations) {
    const rec = tableRecommendation(r, findingIds)
    if (rec) recommendations.push(rec)
    else if (r.status === 'proposed' && isModelOutput(r) && !r.reviewed_at) unreviewedModelRecommendations += 1
  }
  recommendations.sort(byRecommendation)
  const recs = recommendations.slice(0, MAX_REPORT_RECOMMENDATIONS)

  const producers = [...new Set([...findings.map((f) => f.source), ...recs.map((r) => r.source)])].sort()
  const completeness = overview ? round2(clamp01(overview.completeness)) : null
  const calculatedAt = isoOrNull(diag.calculated_at)

  const content: PointAReportContent = {
    schema: REPORT_CONTENT_SCHEMA,
    report_type: 'point_a',
    title: `Точка А: ${inputs.company?.name?.trim() || 'компания'}`,
    company: {
      name: inputs.company?.name ?? null,
      industry: inputs.company?.industry ?? null,
      stage: inputs.company?.stage ?? null,
      size: inputs.company?.size ?? null,
    },
    session: { id: session.id, completed_at: isoOrNull(session.completed_at) },
    diagnostic: {
      id: diag.id,
      calculated_at: calculatedAt,
      overall_score: num(diag.overall_score),
      health_index: num(diag.health_index),
      maturity: overview?.maturity ? { level: overview.maturity.level, label: overview.maturity.label } : null,
      gri_index: overview?.griIndex ?? null,
      blocks: blocksOf(diag),
    },
    problem_zones: (overview?.problemZones ?? []).slice(0, 5).map((z) => ({
      area: String(z.area), label: z.label, score: z.score, status: z.status, top_issue: z.topIssue,
    })),
    findings,
    recommendations: recs,
    data: {
      completeness,
      completeness_level: overview?.completenessLevel ?? null,
      gaps: (overview?.dataGaps ?? []).slice(0, 5),
      sources: overview?.sources
        ? {
            survey_steps_completed: overview.sources.surveyStepsCompleted,
            survey_steps_total: overview.sources.surveyStepsTotal,
            documents_total: overview.sources.documentsTotal,
            documents_processed: overview.sources.documentsProcessed,
            gri_assessments: overview.sources.griAssessments,
            integrations_connected: overview.sources.integrationsConnected,
            metrics_with_value: overview.sources.metricsWithValue,
            metrics_total: overview.sources.metricsTotal,
          }
        : null,
      last_input_at: isoOrNull(overview?.lastInputAt ?? null),
    },
    sources: sourcesOf(overview, diag, producers),
    calculated_at: calculatedAt,
    generated_at: inputs.generatedAt.toISOString(),
    narrative: null,
  }

  const sourceRefs = [
    { type: 'diagnostic_session', ref: session.id },
    { type: 'diagnostic', ref: diag.id },
    ...fromTable.filter((f) => findingIds.has(f.id)).map((f) => ({ type: 'finding', ref: f.id })),
    ...recs.map((r) => ({ type: 'recommendation', ref: r.id })),
  ]

  return {
    content,
    dataHash: reportDataHash(content),
    confidence: completeness,
    excluded: { hiddenHypotheses, unreviewedModelRecommendations },
    sourceRefs,
  }
}

/**
 * sha256 of the canonical serialisation of the content's DATA: everything but
 * `generated_at` (when it was assembled) and `narrative` (a model's wording of
 * the same data). Equal hash ⇒ the client would see the same facts.
 */
export function reportDataHash(content: PointAReportContent): string {
  const { generated_at: _generatedAt, narrative: _narrative, ...data } = content
  return createHash('sha256').update(stableStringify(data)).digest('hex')
}

// ─── Optional executive narrative (model) ───────────────────────────────────

export const NARRATIVE_PROMPT_VERSION = 'report-narrative@1'

export const NarrativeSchema = z.object({
  summary: z.string().min(40).max(2500),
  key_points: z.array(z.string().min(5).max(300)).min(1).max(6),
})
export type NarrativeOutput = z.infer<typeof NarrativeSchema>

const PROVENANCE_RU: Record<string, string> = {
  FACT: 'факт', CALCULATED: 'расчёт', INFERRED: 'вывод по правилам', AI_HYPOTHESIS: 'гипотеза ИИ (проверена)', RECOMMENDATION: 'рекомендация',
}

/**
 * The text the narrative model sees: only the snapshot's data. No company
 * name, no people, no evidence values or quotes (they can contain document
 * text), no data-gap items (they name files); e-mails, links and phones are
 * masked anyway. Fenced as untrusted data.
 */
export function narrativeInputText(content: PointAReportContent): string {
  const lines: string[] = []
  const c = content.company
  if (c.industry) lines.push(`Отрасль: ${c.industry}`)
  if (c.stage) lines.push(`Стадия: ${c.stage}`)
  if (c.size) lines.push(`Размер: ${c.size}`)
  const d = content.diagnostic
  if (d.overall_score !== null) lines.push(`Индекс Точки А: ${d.overall_score}/100`)
  if (d.maturity) lines.push(`Зрелость: ${d.maturity.label}`)
  if (content.data.completeness !== null) lines.push(`Полнота данных: ${Math.round(content.data.completeness * 100)}%`)
  for (const b of d.blocks) {
    lines.push(`Блок «${b.label}»: ${b.score}/100${b.top_issues.length ? `; проблемы: ${b.top_issues.slice(0, 2).join('; ')}` : ''}`)
  }
  lines.push('', 'Выводы:')
  for (const f of content.findings.filter((x) => x.kind !== 'data_gap').slice(0, 25)) {
    lines.push(`- [${PROVENANCE_RU[f.provenance_type] ?? f.provenance_type}, ${f.severity}, ${f.area_label}] ${f.title}`)
  }
  lines.push('', 'Рекомендации:')
  for (const r of content.recommendations.slice(0, 15)) {
    lines.push(`- [приоритет ${r.priority}${r.horizon_days ? `, ${r.horizon_days} дней` : ''}] ${r.title}`)
  }
  return maskPii(lines.join('\n'))
}

export function narrativePrompt(content: PointAReportContent): { system: string; user: string; text: string } {
  const text = narrativeInputText(content)
  const system = [
    'Ты — старший консультант AIStart360. Напиши краткое резюме диагностики для собственника бизнеса.',
    'Используй только данные из блока. Не добавляй фактов, чисел и расчётов, которых там нет; любые числа бери дословно из данных.',
    'Не выдавай гипотезы за факты: пункты с пометкой «гипотеза ИИ» называй предположениями.',
    'Не упоминай людей, название компании и контактные данные.',
    'Ответ — только JSON: {"summary": "3–6 предложений", "key_points": ["2–5 главных пунктов"]}. Язык — русский.',
    UNTRUSTED_DATA_RULES,
  ].join('\n')
  const user = `Снимок диагностики:\n${fenceUntrusted('report_snapshot', text)}\n\nНапиши резюме.`
  return { system, user, text }
}

/** Numbers as written: «1 500», «42%», «0,7» → '1500', '42', '0.7'. */
function numberTokens(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\d+(?:[  ]\d{3})*(?:[.,]\d+)?/g)) {
    const t = m[0].replace(/[  ]/g, '').replace(',', '.')
    out.push(String(Number(t)))
  }
  return out
}

export type NarrativeCheck =
  | { ok: true; narrative: Omit<ReportNarrative, 'model' | 'generated_at'> }
  | { ok: false; reason: string }

/**
 * Accept a model narrative only when every number it states appears in the
 * data it was given (no invented figures). Text is trimmed and PII-masked.
 */
export function acceptNarrative(out: NarrativeOutput, inputText: string): NarrativeCheck {
  const allowed = new Set(numberTokens(inputText))
  const all = [out.summary, ...out.key_points].join('\n')
  const unknown = [...new Set(numberTokens(all).filter((n) => !allowed.has(n)))]
  if (unknown.length) return { ok: false, reason: `в тексте числа, которых нет в данных: ${unknown.slice(0, 5).join(', ')}` }
  return {
    ok: true,
    narrative: {
      summary: maskPii(out.summary.trim()),
      key_points: out.key_points.map((p) => maskPii(p.trim())).filter(Boolean),
      provenance_type: 'AI_HYPOTHESIS',
      prompt_version: NARRATIVE_PROMPT_VERSION,
    },
  }
}
