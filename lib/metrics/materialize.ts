// ============================================================
// lib/metrics/materialize.ts
// DB-touching layer:
//   • gatherResolverContext(supabase, { userId, companyId, ... })
//     pre-fetches all signals the resolver needs.
//   • materializeMetric / materializeAll
//     resolve + upsert into public.metrics with provenance.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetricSource } from './descriptions'
import { resolveAllMetrics, resolveMetric } from './resolver'
import { getMetricById } from './registry'
import type {
  MaterializedRow,
  MetricValue,
  PeriodQuarter,
  ResolverContext,
  ResolverDocument,
} from './types'

// ─── Context gatherer ────────────────────────────────────────

export interface GatherContextOptions {
  /** Whose survey answers to read — the company's primary owner (companies.user_id). */
  userId: string
  companyId: string
  /**
   * 'user' (default, original behaviour): documents uploaded by `userId`.
   * 'company': documents of the company (company_id) plus older ones that
   * carry only the owner's user_id — what a multi-member company uploaded.
   */
  documentsScope?: 'user' | 'company'
  preferPeriodYear?: number
  preferPeriodQuarter?: PeriodQuarter
  prismaSignals?: Record<string, unknown>
  externalSignals?: Record<string, unknown>
  manualOverrides?: Record<string, unknown>
  /** Inject a clock — defaults to now(). */
  now?: Date
}

const PLAIN_ID = /^[A-Za-z0-9_-]+$/

function documentsQuery(supabase: SupabaseClient, opts: GatherContextOptions) {
  const q = supabase
    .from('documents')
    .select('id, doc_type, parsed_data, period_year, period_quarter, uploaded_at, parse_status')
  if (opts.documentsScope === 'company' && PLAIN_ID.test(opts.companyId) && PLAIN_ID.test(opts.userId)) {
    return q.or(`company_id.eq.${opts.companyId},user_id.eq.${opts.userId}`)
  }
  return q.eq('user_id', opts.userId)
}

export async function gatherResolverContext(
  supabase: SupabaseClient,
  opts: GatherContextOptions,
): Promise<ResolverContext> {
  const [surveyResult, docsResult] = await Promise.all([
    supabase
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', opts.userId),
    documentsQuery(supabase, opts)
      .eq('parse_status', 'parsed')
      .order('uploaded_at', { ascending: false }),
  ])

  const surveyAnswers: Record<string, unknown> = {}
  for (const row of surveyResult.data ?? []) {
    const ans = row.answer as { value?: unknown } | null
    if (ans && 'value' in ans) {
      surveyAnswers[row.question_key as string] = ans.value
    } else {
      surveyAnswers[row.question_key as string] = ans
    }
  }

  const documents: ResolverDocument[] = (docsResult.data ?? []).map((d) => ({
    id: d.id as string,
    docType: d.doc_type as string,
    parsedData: (d.parsed_data as ResolverDocument['parsedData']) ?? null,
    periodYear: (d.period_year as number | null) ?? null,
    periodQuarter: (d.period_quarter as PeriodQuarter | null) ?? null,
    uploadedAt: d.uploaded_at as string,
  }))

  return {
    companyId: opts.companyId,
    userId: opts.userId,
    surveyAnswers,
    documents,
    prismaSignals: opts.prismaSignals,
    externalSignals: opts.externalSignals,
    manualOverrides: opts.manualOverrides,
    preferPeriodYear: opts.preferPeriodYear,
    preferPeriodQuarter: opts.preferPeriodQuarter,
    now: opts.now ?? new Date(),
  }
}

// ─── Row mapping ─────────────────────────────────────────────

function pickedSourceLabel(picked: MetricSource | null): string {
  if (!picked) return 'resolver'
  switch (picked.type) {
    case 'survey':     return 'survey'
    case 'document':   return 'document'
    case 'prisma':     return 'prisma'
    case 'external':   return 'external'
    case 'manual':     return 'manual'
    case 'missing':    return 'resolver'
  }
}

export function toMaterializedRow(
  value: MetricValue,
  companyId: string,
): MaterializedRow {
  return {
    company_id: companyId,
    metric_key: value.metricId,
    metric_value: value.numeric,
    metric_unit: value.unit || null,
    period_year: value.periodYear,
    period_quarter: value.periodQuarter,
    source: pickedSourceLabel(value.picked),
    confidence: value.picked ? value.confidence : null,
    provenance: {
      picked: value.picked,
      considered: value.considered,
      notes: value.notes,
      raw_value: value.value,
    },
    computed_at: value.computedAt,
  }
}

// ─── Stale rows (sources that are no longer declared) ─────────

/**
 * Identity of a metric source: what a stored `provenance.picked` is compared
 * with. Labels / notes are presentation and are ignored; the coercion rule is
 * part of the identity only where it selects a different number (table row /
 * column of the step-8 metrics table).
 */
export function sourceIdentity(src: unknown): string | null {
  if (!src || typeof src !== 'object') return null
  const s = src as Partial<MetricSource>
  if (typeof s.type !== 'string' || s.type === 'missing') return null
  const c = s.coerce && typeof s.coerce === 'object' ? (s.coerce as { kind?: string; row?: string; column?: string }) : null
  return [
    s.type,
    s.key ?? (Array.isArray(s.keys) ? s.keys.join('+') : ''),
    s.doc_type ?? '',
    s.field ?? '',
    s.model ?? '',
    s.system ?? '',
    c ? [c.kind ?? '', c.row ?? '', c.column ?? ''].join(':') : '',
  ].join('|')
}

export interface StoredMetricRow {
  id: string
  metric_key: string
  picked: unknown
}

/**
 * Rows the resolver wrote from a source the metric no longer declares (e.g.
 * «CAC» once resolved from the whole marketing budget, s9n_expense_marketing,
 * before that source was removed from lib/metrics/descriptions.ts). Such a
 * value is not a measurement of the metric and must not keep being served as
 * its latest value.
 *
 * Only rows that carry resolver provenance (`provenance.picked` with a source
 * type) of a metric that is still in the registry are judged; rows of unknown
 * metric keys or without provenance are never touched.
 */
export function staleMetricRowIds(rows: ReadonlyArray<StoredMetricRow>): string[] {
  const declared = new Map<string, Set<string>>()
  const out: string[] = []
  for (const r of rows) {
    const picked = sourceIdentity(r.picked)
    if (picked === null) continue
    const entry = getMetricById(r.metric_key)
    if (!entry) continue
    let ids = declared.get(entry.id)
    if (!ids) {
      ids = new Set(entry.sources.map(sourceIdentity).filter((x): x is string => x !== null))
      declared.set(entry.id, ids)
    }
    if (!ids.has(picked)) out.push(r.id)
  }
  return out
}

const PRUNE_BATCH = 100

/** Delete the company's rows whose picked source is no longer declared (see staleMetricRowIds). */
export async function pruneStaleMetricRows(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ pruned: number; error: string | null }> {
  const { data, error } = await supabase
    .from('metrics')
    .select('id, metric_key, picked:provenance->picked')
    .eq('company_id', companyId)
  if (error) return { pruned: 0, error: error.message }
  const ids = staleMetricRowIds((data ?? []) as StoredMetricRow[])
  let pruned = 0
  for (let i = 0; i < ids.length; i += PRUNE_BATCH) {
    const batch = ids.slice(i, i + PRUNE_BATCH)
    const del = await supabase.from('metrics').delete().eq('company_id', companyId).in('id', batch)
    if (del.error) return { pruned, error: del.error.message }
    pruned += batch.length
  }
  return { pruned, error: null }
}

// ─── Upsert ──────────────────────────────────────────────────

export interface MaterializeResult {
  total: number
  written: number
  skipped: number
  /** Rows removed because their source is no longer declared for the metric. */
  pruned: number
  errors: Array<{ metricId: string; error: string }>
}

/**
 * Resolves every metric in the catalog and upserts the result
 * to public.metrics. Skips rows where the resolver found no
 * source — those would just be NULL noise. Rows the resolver wrote
 * earlier from a source the metric no longer declares are deleted
 * first (pruneStaleMetricRows).
 *
 * The unique index on `(company_id, metric_key, period_year,
 * period_quarter, source)` is honored via on_conflict.
 */
// Must match the live unique index metrics_unique_idx (NULLS NOT DISTINCT):
// (company_id, metric_key, period_year, period_quarter, period_month, scenario, source).
// The resolver never sets period_month / scenario, so they stay NULL and still
// collide on re-materialization.
const METRICS_CONFLICT_TARGET = 'company_id,metric_key,period_year,period_quarter,period_month,scenario,source'

export async function materializeAll(
  supabase: SupabaseClient,
  ctx: ResolverContext,
): Promise<{ result: MaterializeResult; values: MetricValue[] }> {
  const values = resolveAllMetrics(ctx)
  const rows: MaterializedRow[] = []
  const errors: MaterializeResult['errors'] = []

  for (const v of values) {
    if (v.picked === null || v.numeric === null) continue
    rows.push(toMaterializedRow(v, ctx.companyId))
  }

  // Before the upsert: a stale row can share the unique key of a fresh one
  // (same metric / period / source label), and the upsert must win then.
  const prune = await pruneStaleMetricRows(supabase, ctx.companyId)
  if (prune.error) errors.push({ metricId: '*prune', error: prune.error })

  if (!rows.length) {
    return {
      result: {
        total: values.length,
        written: 0,
        skipped: values.length,
        pruned: prune.pruned,
        errors,
      },
      values,
    }
  }

  const { error } = await supabase
    .from('metrics')
    .upsert(rows, {
      onConflict: METRICS_CONFLICT_TARGET,
      ignoreDuplicates: false,
    })

  if (error) {
    errors.push({ metricId: '*', error: error.message })
  }

  return {
    result: {
      total: values.length,
      written: error ? 0 : rows.length,
      skipped: values.length - rows.length,
      pruned: prune.pruned,
      errors,
    },
    values,
  }
}

export async function materializeMetric(
  supabase: SupabaseClient,
  metricId: string,
  ctx: ResolverContext,
): Promise<{ value: MetricValue; written: boolean; error?: string }> {
  const value = resolveMetric(metricId, ctx)
  if (value.picked === null || value.numeric === null) {
    return { value, written: false, error: 'unresolved — no source hit' }
  }

  const row = toMaterializedRow(value, ctx.companyId)
  const { error } = await supabase
    .from('metrics')
    .upsert([row], {
      onConflict: METRICS_CONFLICT_TARGET,
      ignoreDuplicates: false,
    })

  return {
    value,
    written: !error,
    error: error?.message,
  }
}
