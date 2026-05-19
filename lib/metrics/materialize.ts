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
import type {
  MaterializedRow,
  MetricValue,
  PeriodQuarter,
  ResolverContext,
  ResolverDocument,
} from './types'

// ─── Context gatherer ────────────────────────────────────────

export interface GatherContextOptions {
  userId: string
  companyId: string
  preferPeriodYear?: number
  preferPeriodQuarter?: PeriodQuarter
  prismaSignals?: Record<string, unknown>
  externalSignals?: Record<string, unknown>
  manualOverrides?: Record<string, unknown>
  /** Inject a clock — defaults to now(). */
  now?: Date
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
    supabase
      .from('documents')
      .select('id, doc_type, parsed_data, period_year, period_quarter, uploaded_at, parse_status')
      .eq('user_id', opts.userId)
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

// ─── Upsert ──────────────────────────────────────────────────

export interface MaterializeResult {
  total: number
  written: number
  skipped: number
  errors: Array<{ metricId: string; error: string }>
}

/**
 * Resolves every metric in the catalog and upserts the result
 * to public.metrics. Skips rows where the resolver found no
 * source — those would just be NULL noise.
 *
 * The unique index on `(company_id, metric_key, period_year,
 * period_quarter, source)` is honored via on_conflict.
 */
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

  if (!rows.length) {
    return {
      result: {
        total: values.length,
        written: 0,
        skipped: values.length,
        errors,
      },
      values,
    }
  }

  const { error } = await supabase
    .from('metrics')
    .upsert(rows, {
      onConflict: 'company_id,metric_key,period_year,period_quarter,source',
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
      onConflict: 'company_id,metric_key,period_year,period_quarter,source',
      ignoreDuplicates: false,
    })

  return {
    value,
    written: !error,
    error: error?.message,
  }
}
