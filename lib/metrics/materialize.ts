// ============================================================
// lib/metrics/materialize.ts
// DB-touching layer:
//   • gatherResolverContext(supabase, { userId, companyId, ... })
//     pre-fetches all signals the resolver needs.
//   • materializeMetric / materializeAll
//     resolve + upsert into public.metrics with provenance.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetricSource } from './format'
import { resolveAllMetrics, resolveMetric } from './resolver'
import { getMetricById } from './registry'
import { loadIntegrationSignals } from '@/lib/integrations/signals'
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
   * 'company': documents of the company (company_id) plus the owner's older
   * uploads that carry no company_id; the GRI assessment is the owner's for
   * this company (or one without a company_id).
   *
   * Tenant callers (lib/metrics/materialize-tenant.ts, Point A aggregate) pass
   * the SERVICE client with 'company' after authorising the caller: under RLS
   * (migration 084) a member / partner / staff user does not see the owner's
   * rows with company_id NULL, and inputs that differ by who clicks
   * «пересчитать» would make the materialiser delete the owner's values.
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

function companyScoped(opts: GatherContextOptions): boolean {
  return opts.documentsScope === 'company' && PLAIN_ID.test(opts.companyId) && PLAIN_ID.test(opts.userId)
}

function documentsQuery(supabase: SupabaseClient, opts: GatherContextOptions) {
  const q = supabase
    .from('documents')
    .select('id, doc_type, file_name, parsed_data, period_year, period_quarter, uploaded_at, parse_status')
  if (companyScoped(opts)) {
    return q.or(`company_id.eq.${opts.companyId},and(user_id.eq.${opts.userId},company_id.is.null)`)
  }
  return q.eq('user_id', opts.userId)
}

/**
 * Section averages of the owner's current GRI assessment (feed the gri.*
 * metrics). A failed read throws like the survey / documents reads: «could
 * not read» must never look like «no assessment», or the materialiser deletes
 * the gri.* rows and every value calculated from them.
 */
async function griSections(supabase: SupabaseClient, opts: GatherContextOptions): Promise<{ sections: Record<string, unknown> | null; at: string | null }> {
  let q = supabase
    .from('gri_assessments')
    .select('section_avgs, created_at')
    .eq('user_id', opts.userId)
  if (companyScoped(opts)) q = q.or(`company_id.eq.${opts.companyId},company_id.is.null`)
  const res = await q
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1)
  if (res.error) throw new Error(`metrics: GRI assessment read failed (${res.error.code ?? 'unknown'})`)
  const row = (res.data ?? [])[0] as { section_avgs?: Record<string, unknown> | null; created_at?: string | null } | undefined
  if (!row || !row.section_avgs || typeof row.section_avgs !== 'object') return { sections: null, at: null }
  return { sections: row.section_avgs, at: row.created_at ?? null }
}

export async function gatherResolverContext(
  supabase: SupabaseClient,
  opts: GatherContextOptions,
): Promise<ResolverContext> {
  const now = opts.now ?? new Date()
  const [surveyResult, docsResult, gri, externalSignals] = await Promise.all([
    supabase
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', opts.userId),
    documentsQuery(supabase, opts)
      .eq('parse_status', 'parsed')
      .order('uploaded_at', { ascending: false }),
    griSections(supabase, opts),
    // Connected integrations (migration 105) feed the 'external' sources whose
    // system is «integration:…». Read on every path that builds a context, so
    // a recalculation from Точка А / the materialiser never drops them.
    opts.externalSignals !== undefined
      ? Promise.resolve(opts.externalSignals)
      : loadIntegrationSignals(supabase, opts.companyId, now),
  ])

  // «Could not read the inputs» must never look like «no inputs»: the
  // materialiser deletes the rows of metrics that no longer resolve.
  if (surveyResult.error) throw new Error(`metrics: survey answers read failed (${surveyResult.error.code ?? 'unknown'})`)
  if (docsResult.error) throw new Error(`metrics: documents read failed (${docsResult.error.code ?? 'unknown'})`)

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
    fileName: (d.file_name as string | null | undefined) ?? null,
  }))

  return {
    companyId: opts.companyId,
    userId: opts.userId,
    surveyAnswers,
    documents,
    prismaSignals: opts.prismaSignals,
    externalSignals,
    manualOverrides: opts.manualOverrides,
    griSections: gri.sections,
    griAssessedAt: gri.at,
    preferPeriodYear: opts.preferPeriodYear,
    preferPeriodQuarter: opts.preferPeriodQuarter,
    now,
  }
}

// ─── Row mapping ─────────────────────────────────────────────

/**
 * public.metrics.source of a picked source. A formula and a GRI section are
 * values the platform calculated: 'calculated' (allowed by the source CHECK
 * since 016); provenance.picked.type keeps the exact kind.
 */
export function pickedSourceLabel(picked: MetricSource | null): string {
  if (!picked) return 'resolver'
  switch (picked.type) {
    case 'survey':     return 'survey'
    case 'document':   return 'document'
    case 'prisma':     return 'prisma'
    case 'external':   return 'external'
    case 'manual':     return 'manual'
    case 'formula':    return 'calculated'
    case 'assessment': return 'calculated'
    case 'missing':    return 'resolver'
  }
}

export function toMaterializedRow(
  value: MetricValue,
  companyId: string,
): MaterializedRow {
  const winner = value.picked ? value.considered.find((a) => a.status === 'hit' && a.source === value.picked) : undefined
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
      // What the value rests on: formula inputs with their sources, the
      // document field (OCR engine, page, quote, unit conversion) and the
      // period conversion (quarter → year …).
      ...(winner?.inputs ? { inputs: winner.inputs } : {}),
      ...(winner?.document ? { document: winner.document } : {}),
      ...(winner?.period ? { period: winner.period } : {}),
      ...(winner?.reason ? { reason: winner.reason } : {}),
      ...(winner?.external ? { external: winner.external } : {}),
      ...(value.needs?.length ? { needs: value.needs } : {}),
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
  const parts = [
    s.type,
    s.key ?? (Array.isArray(s.keys) ? s.keys.join('+') : ''),
    s.doc_type ?? '',
    s.field ?? '',
    s.model ?? '',
    s.system ?? '',
    c ? [c.kind ?? '', c.row ?? '', c.column ?? ''].join(':') : '',
  ]
  // Formula / GRI section ids (appended only for those types, so identities of
  // the older source kinds stay byte-identical to what earlier runs compared).
  if (s.type === 'formula') parts.push(s.formula ?? '')
  if (s.type === 'assessment') parts.push(s.section ?? '')
  return parts.join('|')
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

export interface ExistingMetricRow {
  id: string
  metric_key: string
  source: string | null
  period_year: number | null
  period_quarter: string | null
  period_month?: number | null
  scenario?: string | null
}

function uniqueKey(r: { metric_key: string; source: string | null; period_year: number | null; period_quarter: string | null }): string {
  return [r.metric_key, r.source ?? '', r.period_year ?? '', r.period_quarter ?? ''].join('|')
}

/**
 * Rows a full materialisation supersedes: a registry metric keeps exactly one
 * resolver row — the one just written. Rows of the same metric from another
 * source (the survey value after a P&L was uploaded, a formula value after
 * the owner typed the number) and rows of metrics that no longer resolve at
 * all (the answer was cleared) are removed, so every reader of
 * public.metrics sees the same single current value. Rows with a month or a
 * scenario (not written by the resolver) and rows of unknown metric keys are
 * never touched.
 */
export function supersededMetricRowIds(
  existing: ReadonlyArray<ExistingMetricRow>,
  written: ReadonlyArray<Pick<MaterializedRow, 'metric_key' | 'source' | 'period_year' | 'period_quarter'>>,
): string[] {
  const keep = new Set(written.map(uniqueKey))
  return existing
    .filter((r) => getMetricById(r.metric_key) && (r.period_month ?? null) === null && (r.scenario ?? null) === null)
    .filter((r) => !keep.has(uniqueKey(r)))
    .map((r) => r.id)
}

async function deleteIds(supabase: SupabaseClient, companyId: string, ids: string[]): Promise<{ deleted: number; error: string | null }> {
  let deleted = 0
  for (let i = 0; i < ids.length; i += PRUNE_BATCH) {
    const batch = ids.slice(i, i + PRUNE_BATCH)
    const del = await supabase.from('metrics').delete().eq('company_id', companyId).in('id', batch)
    if (del.error) return { deleted, error: del.error.message }
    deleted += batch.length
  }
  return { deleted, error: null }
}

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
  const { deleted, error: delError } = await deleteIds(supabase, companyId, ids)
  return { pruned: deleted, error: delError }
}

// ─── Upsert ──────────────────────────────────────────────────

export interface MaterializeResult {
  total: number
  written: number
  skipped: number
  /** Rows removed because their source is no longer declared for the metric. */
  pruned: number
  /** Rows of other sources / of metrics that no longer resolve, removed after the write. */
  superseded?: number
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

  // After a successful write only: one current row per metric.
  let superseded = 0
  if (!error) {
    const existing = await supabase
      .from('metrics')
      .select('id, metric_key, source, period_year, period_quarter, period_month, scenario')
      .eq('company_id', ctx.companyId)
    if (existing.error) {
      errors.push({ metricId: '*superseded', error: existing.error.message })
    } else {
      const ids = supersededMetricRowIds((existing.data ?? []) as ExistingMetricRow[], rows)
      const del = await deleteIds(supabase, ctx.companyId, ids)
      superseded = del.deleted
      if (del.error) errors.push({ metricId: '*superseded', error: del.error })
    }
  }

  return {
    result: {
      total: values.length,
      written: error ? 0 : rows.length,
      skipped: values.length - rows.length,
      pruned: prune.pruned,
      superseded,
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
