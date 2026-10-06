/**
 * lib/diagnostics/quality.ts — deterministic data-quality checks (agent
 * `data_quality`, no LLM).
 *
 *   inconsistency  the same metric, period and scenario differs by > 30 %
 *                  between two sources (survey vs document vs CRM / manual)
 *   anomaly        an impossible value (negative money or count, a percent
 *                  below −100, a flag that is not 0/1)
 *   data_gap       stale inputs (financial documents older than last year,
 *                  questionnaire not updated for a year) and documents that
 *                  could not be processed
 *
 * Pure: rows in → FindingDraft[] out. Every finding names the rows it is based
 * on (evidence), so a reviewer can check it.
 */
import { prisma } from '@/lib/db'
import { getMetricById } from '@/lib/metrics/registry'
import { categoryForMetric } from '@/lib/metrics/taxonomy'
import type { FindingDraft, Severity } from './findings-store'

export interface QualityMetricRow {
  metric_key: string
  metric_value: number | null
  metric_unit: string | null
  source: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
  scenario: string | null
  computed_at: Date | null
}

export interface QualityDocumentRow {
  id: string
  file_name: string | null
  doc_type: string | null
  parse_status: string | null
  period_year: number | null
  last_error_code: string | null
  uploaded_at: Date | null
}

export interface QualityInputs {
  metrics: QualityMetricRow[]
  documents: QualityDocumentRow[]
  surveyLastAnsweredAt: Date | null
  now: Date
}

export const INCONSISTENCY_THRESHOLD = 0.3
const FINANCIAL_DOC_TYPES = new Set(['pl_report', 'financial_report', 'balance_sheet'])
const MONEY_UNITS = new Set(['₸', 'kzt', 'тг', 'тенге', 'руб', '$', 'usd'])
const COUNT_UNITS = new Set(['count', 'шт', 'чел', 'клиентов', 'сделок'])
const SOURCE_LABELS: Record<string, string> = {
  survey: 'анкета', document: 'документ', manual: 'ручной ввод', external: 'внешняя система', prisma: 'CRM', calculated: 'расчёт',
}
const DOC_FAILURE_LABELS: Record<string, string> = {
  error: 'ошибка обработки', needs_ocr: 'скан без текстового слоя — нужен OCR', rejected: 'отклонён проверкой безопасности',
}

function metricArea(key: string): string {
  const entry = getMetricById(key)
  return entry ? categoryForMetric(entry) : 'management'
}

function metricLabel(key: string): string {
  return getMetricById(key)?.label ?? key
}

function fmt(v: number): string {
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ru-RU') : String(Math.round(v * 100) / 100)
}

function periodKey(m: QualityMetricRow): string {
  return [m.period_year ?? '', m.period_quarter ?? '', m.period_month ?? '', m.scenario ?? 'fact'].join('|')
}

function periodLabel(m: QualityMetricRow): string {
  const parts = [m.period_year, m.period_quarter, m.period_month ? `мес. ${m.period_month}` : null].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

export function inconsistencyFindings(metrics: QualityMetricRow[]): FindingDraft[] {
  const groups = new Map<string, QualityMetricRow[]>()
  for (const m of metrics) {
    if (m.metric_value === null || !Number.isFinite(m.metric_value) || !m.source) continue
    const k = `${m.metric_key}#${periodKey(m)}`
    groups.set(k, [...(groups.get(k) ?? []), m])
  }
  const out: FindingDraft[] = []
  for (const rows of groups.values()) {
    const bySource = new Map<string, QualityMetricRow>()
    for (const r of rows) if (!bySource.has(r.source as string)) bySource.set(r.source as string, r)
    const list = [...bySource.values()]
    if (list.length < 2) continue
    let worst: { a: QualityMetricRow; b: QualityMetricRow; diff: number } | null = null
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].metric_value as number
        const b = list[j].metric_value as number
        const scale = Math.max(Math.abs(a), Math.abs(b))
        if (scale === 0) continue
        const diff = Math.abs(a - b) / scale
        if (diff > INCONSISTENCY_THRESHOLD && (!worst || diff > worst.diff)) worst = { a: list[i], b: list[j], diff }
      }
    }
    if (!worst) continue
    const { a, b, diff } = worst
    const key = a.metric_key
    const label = metricLabel(key)
    const severity: Severity = diff > 0.5 ? 'high' : 'medium'
    out.push({
      key: `inconsistency:${key}:${periodKey(a)}`,
      kind: 'inconsistency',
      area: metricArea(key),
      title: `«${label}»${periodLabel(a)}: источники расходятся на ${Math.round(diff * 100)}%`,
      body: `${SOURCE_LABELS[a.source as string] ?? a.source}: ${fmt(a.metric_value as number)}; ${SOURCE_LABELS[b.source as string] ?? b.source}: ${fmt(b.metric_value as number)}. Уточните верное значение — от него зависят расчёты.`,
      severity,
      provenance: 'CALCULATED',
      confidence: 0.95,
      evidence: [a, b].map((m) => ({ type: 'metric', ref: m.metric_key, field: m.source ?? undefined, value: m.metric_value })),
    })
  }
  return out
}

export function impossibleValueFindings(metrics: QualityMetricRow[]): FindingDraft[] {
  const out: FindingDraft[] = []
  for (const m of metrics) {
    if (m.metric_value === null || !Number.isFinite(m.metric_value)) continue
    const entry = getMetricById(m.metric_key)
    const unit = (m.metric_unit ?? entry?.unit ?? '').trim().toLowerCase()
    const v = m.metric_value
    let problem: string | null = null
    if (v < 0 && (MONEY_UNITS.has(unit) || COUNT_UNITS.has(unit))) problem = 'отрицательное значение для денежной или количественной метрики'
    else if (unit === '%' && v < -100) problem = 'процент ниже −100%'
    else if (entry?.valueKind === 'flag' && v !== 0 && v !== 1) problem = 'флаг «есть / нет» должен быть 0 или 1'
    if (!problem) continue
    out.push({
      key: `anomaly:${m.metric_key}:${m.source ?? ''}:${periodKey(m)}`,
      kind: 'anomaly',
      area: metricArea(m.metric_key),
      title: `«${metricLabel(m.metric_key)}»: невозможное значение ${fmt(v)}`,
      body: `Источник: ${SOURCE_LABELS[m.source ?? ''] ?? m.source ?? 'не указан'}; ${problem}. Проверьте источник и исправьте значение — расчёты, которые его используют, сейчас неверны.`,
      severity: 'high',
      provenance: 'CALCULATED',
      confidence: 0.99,
      evidence: [{ type: 'metric', ref: m.metric_key, field: m.source ?? undefined, value: v }],
    })
  }
  return out
}

export function stalenessFindings(inp: Pick<QualityInputs, 'documents' | 'surveyLastAnsweredAt' | 'now'>): FindingDraft[] {
  const out: FindingDraft[] = []
  const year = inp.now.getUTCFullYear()
  const financial = inp.documents.filter((d) =>
    d.doc_type && FINANCIAL_DOC_TYPES.has(d.doc_type) && (d.parse_status === 'parsed' || d.parse_status === 'completed') && d.period_year)
  if (financial.length) {
    const newest = financial.reduce((best, d) => ((d.period_year ?? 0) > (best.period_year ?? 0) ? d : best))
    if ((newest.period_year ?? 0) < year - 1) {
      out.push({
        key: 'stale:financial_documents',
        kind: 'data_gap',
        area: 'finance',
        title: `Финансовые документы устарели: последний период — ${newest.period_year} год`,
        body: `Загрузите P&L или баланс за ${year - 1}–${year} год, чтобы финансовый блок отражал текущее состояние.`,
        severity: 'medium',
        provenance: 'CALCULATED',
        confidence: 1,
        evidence: [{ type: 'document', ref: newest.id, field: 'period_year', value: newest.period_year }],
      })
    }
  }
  if (inp.surveyLastAnsweredAt && inp.now.getTime() - inp.surveyLastAnsweredAt.getTime() > 365 * 86_400_000) {
    out.push({
      key: 'stale:survey',
      kind: 'data_gap',
      area: 'management',
      title: 'Анкета не обновлялась больше года',
      body: 'Ответы могли устареть: обновите ключевые цифры (выручка, клиенты, команда).',
      severity: 'medium',
      provenance: 'CALCULATED',
      confidence: 1,
      evidence: [{ type: 'survey', ref: 'last_answered_at', value: inp.surveyLastAnsweredAt.toISOString() }],
    })
  }
  return out
}

export function failedDocumentFindings(documents: QualityDocumentRow[]): FindingDraft[] {
  return documents
    .filter((d) => d.parse_status === 'error' || d.parse_status === 'needs_ocr' || d.parse_status === 'rejected')
    .slice(0, 5)
    .map((d) => ({
      key: `document_failed:${d.id}`,
      kind: 'data_gap' as const,
      area: d.doc_type && FINANCIAL_DOC_TYPES.has(d.doc_type) ? 'finance' : 'management',
      title: `Документ «${(d.file_name ?? 'без названия').slice(0, 120)}» не обработан`,
      body: `Причина: ${DOC_FAILURE_LABELS[d.parse_status as string] ?? d.parse_status}${d.last_error_code ? ` (${d.last_error_code})` : ''}. Данные из него не участвуют в диагностике.`,
      severity: d.parse_status === 'rejected' ? 'low' as const : 'medium' as const,
      provenance: 'FACT' as const,
      confidence: 1,
      evidence: [{ type: 'document', ref: d.id, field: 'parse_status', value: d.parse_status }],
    }))
}

export function dataQualityFindings(inp: QualityInputs): FindingDraft[] {
  return [
    ...impossibleValueFindings(inp.metrics),
    ...inconsistencyFindings(inp.metrics),
    ...stalenessFindings(inp),
    ...failedDocumentFindings(inp.documents),
  ]
}

export async function loadQualityInputs(companyId: string, now = new Date()): Promise<QualityInputs> {
  const [metrics, documents, survey] = await Promise.all([
    prisma.$queryRaw<Array<Omit<QualityMetricRow, 'metric_value'> & { metric_value: string | null }>>`
      SELECT metric_key, metric_value::text AS metric_value, metric_unit, source, period_year, period_quarter,
             period_month, scenario, computed_at
      FROM public.metrics WHERE company_id = ${companyId}
      ORDER BY metric_key, source, period_year NULLS FIRST, period_quarter NULLS FIRST, period_month NULLS FIRST`,
    prisma.$queryRaw<QualityDocumentRow[]>`
      SELECT id::text, file_name, doc_type, parse_status, period_year, last_error_code, uploaded_at
      FROM public.documents WHERE company_id = ${companyId}
      ORDER BY uploaded_at DESC, id LIMIT 200`,
    prisma.$queryRaw<Array<{ t: Date | null }>>`
      SELECT max(sa.answered_at) AS t FROM public.survey_answers sa
      JOIN public.companies c ON c.user_id = sa.user_id
      WHERE c.id = ${companyId} AND sa.step > 0`,
  ])
  return {
    metrics: metrics.map((m) => ({ ...m, metric_value: m.metric_value === null ? null : Number(m.metric_value) })),
    documents,
    surveyLastAnsweredAt: survey[0]?.t ?? null,
    now,
  }
}
