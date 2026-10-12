/**
 * lib/data-layer/facts.ts — every observation of every metric, by period
 * and source (spec 2026-10-12 §1.1–1.3).
 *
 * The resolver picks ONE current value per metric; here nothing is picked:
 * the questionnaire (incl. each year column of the step-8 metrics table),
 * every matching document field, manual period overrides and connected
 * integrations each yield a Fact with the calendar period it describes. Facts
 * are what periods are compared on and discrepancies found in
 * (lib/data-layer/reconcile.ts). Pure — no I/O.
 *
 * Not facts: formulas (derived from facts), the GRI assessment (a score, not
 * a measurement), Prisma signals and external systems without a producer.
 */
import { getMetricRegistry } from '@/lib/metrics/registry'
import { documentCandidates, resolveExternalSource, resolveSurveySource } from '@/lib/metrics/source-adapters'
import { isPlausibleFor } from '@/lib/metrics/resolver'
import type { MetricSource } from '@/lib/metrics/format'
import type { MetricEntry, ResolverContext } from '@/lib/metrics/types'
import type { DetectedPeriod } from '@/lib/metrics/period'
import { periodKey, parsePeriodKey } from './period-key'
import { surveyKeyPeriod, tableColumnPeriod } from './survey-periods'
import type { Fact, FactFlag, PeriodRef } from './types'

/** Observed year columns of the step-8 table, oldest first («plan_*» is a target, not a fact). */
const TABLE_FACT_COLUMNS = ['y2023', 'y2024', 'y2025', 'fact_2026'] as const

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n * 100) / 100 : Math.round(n * 1_000_000) / 1_000_000
}

function fact(
  entry: MetricEntry,
  period: PeriodRef | null,
  value: number,
  rest: Pick<Fact, 'sourceKind' | 'sourceRef' | 'confidence' | 'observedAt'> & { flags?: FactFlag[]; current?: boolean; note?: string },
): Fact {
  const flags: FactFlag[] = [...(rest.flags ?? [])]
  if (!isPlausibleFor(entry, value) && !flags.includes('invalid')) flags.push('invalid')
  return {
    metricId: entry.id,
    period,
    periodKey: periodKey(period),
    value: round(value),
    unit: entry.unit,
    sourceKind: rest.sourceKind,
    sourceRef: rest.sourceRef,
    sourceRefs: [rest.sourceRef],
    confidence: Math.round(Math.min(1, Math.max(0, rest.confidence)) * 1000) / 1000,
    flags,
    observedAt: rest.observedAt,
    ...(rest.current ? { current: true } : {}),
    ...(rest.note ? { note: rest.note } : {}),
  }
}

function periodOfDetected(d: DetectedPeriod | null): PeriodRef | null {
  if (!d || d.year === null) return null
  if (d.months === 1 && d.endMonth) return { year: d.year, quarter: Math.ceil(d.endMonth / 3) as 1 | 2 | 3 | 4, month: d.endMonth }
  if (d.months === 3 && d.quarter) return { year: d.year, quarter: Number(d.quarter.slice(1)) as 1 | 2 | 3 | 4, month: null }
  if (d.months === 12) return { year: d.year, quarter: null, month: null }
  // «9 месяцев 2025»: a part of the year — comparable only with the same span.
  return { year: d.year, quarter: null, month: null, ytd: true, months: d.months }
}

/** Table-cell sources expanded to one source per observed year column. */
function surveyVariants(src: MetricSource): Array<{ src: MetricSource; ref: string }> {
  const key = src.key ?? ''
  const c = src.coerce
  if (c?.kind === 'table_cell' && (c.column === undefined || c.column === 'latest' || c.column === 'latest_full_year')) {
    return TABLE_FACT_COLUMNS.map((column) => ({
      src: { ...src, coerce: { ...c, column } },
      ref: `survey:${key}#${c.row}/${column}`,
    }))
  }
  if (c?.kind === 'table_cell') return [{ src, ref: `survey:${key}#${c.row}/${c.column}` }]
  return [{ src, ref: `survey:${key}` }]
}

function surveyFacts(entry: MetricEntry, ctx: ResolverContext, seen: Set<string>): Fact[] {
  const out: Fact[] = []
  for (const declared of entry.sources) {
    if (declared.type !== 'survey' || !declared.key || declared.keys?.length) continue
    for (const { src, ref } of surveyVariants(declared)) {
      if (seen.has(ref)) continue
      seen.add(ref)
      const a = resolveSurveySource(src, ctx, entry)
      if (a.status !== 'hit' || typeof a.numeric !== 'number' || !Number.isFinite(a.numeric)) continue
      // The wizard writes 0 for an empty number field (`Number(x) || 0`): a 0
      // of money or a count from the survey is «not answered», not a value
      // (it produced false «расхождения» against the real figure).
      if (a.numeric === 0 && (entry.unit === '₸' || entry.unit === 'count')) continue
      const key = declared.key
      const answeredAt = ctx.surveyAnsweredAt?.[key] ?? null
      const column = src.coerce?.kind === 'table_cell' && src.coerce.column ? tableColumnPeriod(src.coerce.column) : null
      const fromKey = surveyKeyPeriod(key, answeredAt, ctx.now)
      // An older-form key without a year: its period is unknown (never compared).
      const period = column ?? (declared.legacy && fromKey.basis === 'answered' ? null : fromKey.period)
      const flags: FactFlag[] = a.period && a.period.factor !== 1 ? ['rescaled'] : []
      out.push(
        fact(entry, period, a.numeric, {
          sourceKind: 'survey',
          sourceRef: ref,
          confidence: a.confidence ?? 0.9,
          observedAt: answeredAt,
          flags,
          current: !column && fromKey.basis === 'answered' && !declared.legacy,
        }),
      )
    }
  }
  return out
}

function documentFacts(entry: MetricEntry, ctx: ResolverContext, seen: Set<string>): Fact[] {
  const out: Fact[] = []
  for (const src of entry.sources) {
    if (src.type !== 'document') continue
    const { candidates } = documentCandidates(src, ctx, entry.id, entry)
    for (const c of candidates) {
      const ref = `document:${c.documentId}#${c.fieldKey}`
      if (seen.has(ref)) continue
      seen.add(ref)
      out.push(
        fact(entry, periodOfDetected(c.detected), c.numeric, {
          sourceKind: 'document',
          sourceRef: ref,
          confidence: c.confidence,
          observedAt: c.uploadedAt,
          flags: c.factor !== 1 ? ['rescaled'] : [],
          ...(c.fieldLabel ? { note: c.fieldLabel } : {}),
        }),
      )
    }
  }
  return out
}

function overrideFacts(entry: MetricEntry, ctx: ResolverContext): Fact[] {
  return (ctx.periodOverrides ?? [])
    .filter((o) => o.metricId === entry.id && Number.isFinite(o.value))
    .map((o) => ({
      ...fact(entry, parsePeriodKey(o.periodKey), o.value, {
        sourceKind: 'manual',
        sourceRef: `manual:${o.id}`,
        confidence: 1,
        observedAt: o.setAt ?? null,
        ...(o.note ? { note: o.note } : {}),
      }),
      basis: o.basis ?? null,
    }))
}

function integrationFacts(entry: MetricEntry, ctx: ResolverContext): Fact[] {
  const out: Fact[] = []
  for (const src of entry.sources) {
    if (src.type !== 'external' || !src.system?.startsWith('integration:')) continue
    const a = resolveExternalSource(src, ctx, entry)
    if (a.status !== 'hit' || typeof a.numeric !== 'number' || !a.external) continue
    const end = new Date(`${a.external.period_end}T00:00:00Z`)
    const month = end.getUTCMonth() + 1
    const period: PeriodRef | null = Number.isFinite(end.getTime())
      ? { year: end.getUTCFullYear(), quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4, month }
      : null
    out.push(
      fact(entry, period, a.numeric, {
        sourceKind: 'integration',
        sourceRef: `integration:${a.external.provider}:${src.system.slice('integration:'.length)}`,
        confidence: a.confidence ?? 0.9,
        observedAt: a.external.fetched_at,
        note: a.external.basis,
      }),
    )
  }
  return out
}

/** Every observation of every catalog metric (or of `metricIds` only). */
export function collectFacts(ctx: ResolverContext, metricIds?: ReadonlySet<string>): Fact[] {
  const out: Fact[] = []
  for (const entry of getMetricRegistry()) {
    if (metricIds && !metricIds.has(entry.id)) continue
    const seen = new Set<string>()
    out.push(...overrideFacts(entry, ctx), ...surveyFacts(entry, ctx, seen), ...documentFacts(entry, ctx, seen), ...integrationFacts(entry, ctx))
  }
  return out
}
