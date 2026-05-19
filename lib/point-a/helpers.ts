// ============================================================
// lib/point-a/helpers.ts
// Pure helpers for the Phase 4 Point A aggregator. Split off
// from `aggregator.ts` so the heavy reasoning lives in tiny
// functions that are trivial to unit-test without a DB.
// ============================================================

import type { MetricEntry, MetricValue } from '@/lib/metrics/types'
import type { PointAIntelligence } from '@/types/onboarding'

type ByDepartment = PointAIntelligence['by_department']
type TopStrengths = PointAIntelligence['top_strengths']
type TopGaps = PointAIntelligence['top_gaps']

// ─── Internal utilities ──────────────────────────────────────

function isResolved(v: MetricValue): boolean {
  return v.picked !== null
}

function hasValue(v: MetricValue): number {
  // Treat null numeric or null raw value as no-value.
  if (v.numeric !== null && Number.isFinite(v.numeric)) return 1
  if (v.value !== null && v.value !== undefined && v.value !== '') return 1
  return 0
}

function strengthScore(v: MetricValue): number {
  return (v.confidence ?? 0) * hasValue(v)
}

function findFirstSurveyMissReason(v: MetricValue): string | null {
  const surveyMiss = v.considered.find(
    (a) => a.source.type === 'survey' && a.status === 'miss',
  )
  return surveyMiss?.reason ?? null
}

function hasDeclaredSurveySource(entry: MetricEntry): boolean {
  return entry.sources.some((s) => s.type === 'survey')
}

function asNumberOrNull(v: MetricValue): number | null {
  if (v.numeric !== null && Number.isFinite(v.numeric)) return v.numeric
  return null
}

// ─── Russian source suggestion ───────────────────────────────

/**
 * Returns a Russian-language suggestion for how the owner can
 * fill the missing metric — survey step, document type, or
 * external integration.
 */
export function suggestSourceFor(entry: MetricEntry): string {
  const sources = entry.sources

  const survey = sources.find((s) => s.type === 'survey')
  if (survey) {
    const step = survey.step ?? 0
    return `Ответьте на анкету шаг ${step}: ${entry.label}`
  }

  const document = sources.find((s) => s.type === 'document')
  if (document) {
    const docType = document.doc_type ?? 'отчёт'
    return `Загрузите документ типа ${docType}`
  }

  const external = sources.find((s) => s.type === 'external')
  if (external) {
    const system = external.system ?? 'внешний источник'
    return `Подключите интеграцию с ${system}`
  }

  const prisma = sources.find((s) => s.type === 'prisma')
  if (prisma) {
    return `Активируйте источник Prisma: ${prisma.model ?? ''}.${prisma.field ?? ''}`
  }

  return `Источник для метрики "${entry.label}" пока не определён`
}

// ─── By-department breakdown ─────────────────────────────────

/**
 * Group BIZ metrics by department. For each department:
 *   • coverage = resolved / total in [0..1]
 *   • strongest: up to 3 resolved metrics with highest strengthScore
 *   • weakest:   up to 3 unresolved metrics with a declared survey source
 */
export function buildByDepartment(
  values: MetricValue[],
  entries: MetricEntry[],
): ByDepartment {
  const entryById = new Map<string, MetricEntry>()
  for (const e of entries) entryById.set(e.id, e)

  const grouped = new Map<
    string,
    { values: MetricValue[]; entries: MetricEntry[] }
  >()

  for (const v of values) {
    const entry = entryById.get(v.metricId)
    if (!entry || !entry.department) continue
    const bucket = grouped.get(entry.department) ?? { values: [], entries: [] }
    bucket.values.push(v)
    bucket.entries.push(entry)
    grouped.set(entry.department, bucket)
  }

  const out: ByDepartment = []

  for (const [department, bucket] of grouped) {
    const total = bucket.values.length
    const resolved = bucket.values.filter(isResolved).length
    const coverage =
      total === 0 ? 0 : Math.round((resolved / total) * 100) / 100

    const strongestPool = bucket.values
      .filter(isResolved)
      .sort((a, b) => strengthScore(b) - strengthScore(a))
      .slice(0, 3)
      .map((v) => {
        const entry = entryById.get(v.metricId)!
        return {
          metric_id: v.metricId,
          label: entry.label,
          value: asNumberOrNull(v),
          unit: entry.unit,
          confidence: v.confidence,
        }
      })

    const weakestPool = bucket.values
      .filter((v) => !isResolved(v))
      .filter((v) => {
        const e = entryById.get(v.metricId)
        return e ? hasDeclaredSurveySource(e) : false
      })
      .slice(0, 3)
      .map((v) => {
        const entry = entryById.get(v.metricId)!
        return {
          metric_id: v.metricId,
          label: entry.label,
          value: asNumberOrNull(v),
          unit: entry.unit,
          confidence: v.confidence,
          reason:
            findFirstSurveyMissReason(v) ??
            v.notes ??
            'данные не предоставлены',
        }
      })

    out.push({
      department,
      coverage,
      strongest: strongestPool,
      weakest: weakestPool,
    })
  }

  // Stable order — alphabetical by Russian department name.
  out.sort((a, b) => a.department.localeCompare(b.department, 'ru'))
  return out
}

// ─── Top strengths (across all namespaces) ───────────────────

/**
 * Top 10 resolved metrics company-wide, ordered by strengthScore
 * desc. Includes the namespace so the UI can colour-code them.
 */
export function buildTopStrengths(
  values: MetricValue[],
  entries: MetricEntry[],
): TopStrengths {
  const entryById = new Map<string, MetricEntry>()
  for (const e of entries) entryById.set(e.id, e)

  return values
    .filter(isResolved)
    .filter((v) => hasValue(v) > 0)
    .map((v) => ({ v, entry: entryById.get(v.metricId) }))
    .filter((row): row is { v: MetricValue; entry: MetricEntry } => !!row.entry)
    .sort((a, b) => strengthScore(b.v) - strengthScore(a.v))
    .slice(0, 10)
    .map(({ v, entry }) => ({
      metric_id: v.metricId,
      label: entry.label,
      value: asNumberOrNull(v),
      unit: entry.unit,
      namespace: entry.namespace,
    }))
}

// ─── Top gaps (cheap-to-fix unresolved metrics) ──────────────

/**
 * Top 10 unresolved metrics with a declared survey source.
 * Survey gaps are listed first because they're the cheapest
 * for the owner to close.
 */
export function buildTopGaps(
  values: MetricValue[],
  entries: MetricEntry[],
): TopGaps {
  const entryById = new Map<string, MetricEntry>()
  for (const e of entries) entryById.set(e.id, e)

  const gaps: TopGaps = []

  for (const v of values) {
    if (isResolved(v)) continue
    const entry = entryById.get(v.metricId)
    if (!entry) continue
    if (!hasDeclaredSurveySource(entry)) continue

    const reason =
      findFirstSurveyMissReason(v) ??
      v.notes ??
      'survey answer missing'

    gaps.push({
      metric_id: v.metricId,
      label: entry.label,
      suggested_source: suggestSourceFor(entry),
      reason,
    })

    if (gaps.length >= 10) break
  }

  return gaps
}
