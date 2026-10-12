/**
 * lib/point-a/v4/state.ts — everything the Point A page shows, in one read
 * (spec 2026-10-12 §4): the latest snapshot, its history, open data
 * discrepancies, goals, GRI, benchmarks, data sources and whether a
 * recalculation is under way.
 *
 * `client` is the caller's session (RLS scopes every company table);
 * `service` reads only the recalculation queue (no API-role policy) after the
 * caller's tenant check.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById } from '@/lib/metrics/registry'
import { surveyProgressFromRows } from '@/lib/survey/steps'
import { findBenchmark, percentileAgainstBenchmark, ratingLabel, type BenchmarkBlockKey } from '@/lib/point-a/benchmarks'
import { periodLabel } from '@/lib/data-layer/period-key'
import { loadGoalsWithEvaluation, type GoalWithEvaluation } from '@/lib/goals/current'
import type { ChangeReason, SnapshotInputs } from '@/lib/point-a/snapshot-diff'
import type { UploadItem, V4Block } from './engine'
import { BLOCK_LIBRARY, BLOCK_KEYS, type BlockKey } from './config'
import { loadBlockConfig } from './store'
import { DEFAULT_KEY_METRICS, MAX_KEY_METRICS, keyMetricCatalog, loadMetricViews, type MetricView } from './metric-views'

export interface PointASnapshotView {
  id: string
  createdAt: string
  engine: 'v1' | 'v4'
  trigger: string
  overall: number | null
  confidence: number | null
  coverage: number | null
  stage: string | null
  healthIndex: number | null
  blocks: V4Block[]
  strengths: Array<{ block: BlockKey; title: string; score: number; checks: string[] }>
  uploadChecklist: UploadItem[]
  changeReasons: ChangeReason[]
  /** Metric values the calculation used: id → value, source, period. */
  metrics: Array<{ id: string; label: string; unit: string; value: number; source: string | null; period: string | null }>
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface PointAState {
  snapshot: PointASnapshotView | null
  history: Array<{ id: string; createdAt: string; overall: number | null; confidence: number | null; changes: string[] }>
  discrepancies: Array<{
    id: string
    metricKey: string
    metricLabel: string
    periodKey: string
    periodLabel: string
    kind: string
    detail: string | null
    chosenValue: number | null
    candidates: Array<{ value: number; unit: string; sourceKind: string; sourceRef: string; note?: string }>
  }>
  goals: GoalWithEvaluation[]
  gri: { index100: number | null; assessedAt: string | null }
  benchmarks: { industry: string; stage: string; source: string; overall: number; blocks: Array<{ key: BlockKey; title: string; benchmark: number; score: number | null; rating: string | null }> } | null
  sources: {
    survey: { percent: number; completed: number; total: number }
    documents: { parsed: number; processing: number; failed: number }
    metrics: number
  }
  recalculation: 'idle' | 'queued' | 'running'
  /** The company's blocks as configured now (client view: hidden, order). */
  config: { template: string; templateTitle: string; added: string[]; blocks: Array<{ key: BlockKey; title: string; weight: number; hiddenForClient: boolean; informational: boolean; order: number }> }
  library: Array<{ key: BlockKey; title: string; description: string }>
  /** The top strip: the company's chosen key metrics (default set until chosen). */
  keyMetrics: MetricView[]
  keyMetricsCustom: boolean
  /** Metrics that can be pinned to the strip. */
  metricCatalog: Array<{ id: string; label: string; group: string; unit: string }>
}

function missing(e: { code?: string } | null | undefined): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const SOURCE_LABEL: Record<string, string> = { survey: 'анкета', document: 'документ', manual: 'вручную', calculated: 'расчёт', external: 'интеграция' }

function metricsOf(inputs: SnapshotInputs | null | undefined): PointASnapshotView['metrics'] {
  if (!inputs?.metrics) return []
  return Object.entries(inputs.metrics).map(([id, m]) => ({
    id,
    label: getMetricById(id)?.label ?? id,
    unit: getMetricById(id)?.unit ?? '',
    value: m.value,
    source: m.source ? SOURCE_LABEL[m.source] ?? m.source : null,
    period: m.period ? periodLabel(m.period.replace(/-Q(\d)$/, '-Q$1')) : null,
  }))
}

export function snapshotView(row: Record<string, unknown>): PointASnapshotView {
  const v4 = (row.v4 ?? {}) as { strengths?: PointASnapshotView['strengths']; upload_checklist?: UploadItem[]; health_index?: number | null }
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    engine: row.engine === 'v4' ? 'v4' : 'v1',
    trigger: String(row.trigger ?? 'event'),
    overall: num(row.overall),
    confidence: num(row.confidence),
    coverage: num(row.coverage),
    stage: (row.stage as string | null) ?? null,
    healthIndex: num(v4.health_index),
    blocks: Array.isArray(row.blocks) ? (row.blocks as V4Block[]) : [],
    strengths: v4.strengths ?? [],
    uploadChecklist: v4.upload_checklist ?? [],
    changeReasons: Array.isArray(row.change_reasons) ? (row.change_reasons as ChangeReason[]) : [],
    metrics: metricsOf(row.inputs as SnapshotInputs | null),
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
  }
}

export async function loadPointAState(client: SupabaseClient, service: SupabaseClient, companyId: string): Promise<PointAState> {
  const company = await client.from('companies').select('id, user_id, industry').eq('id', companyId).maybeSingle()
  if (company.error) throw new Error(`point-a state: company read failed (${company.error.code ?? 'unknown'})`)
  const ownerId = (company.data as { user_id?: string } | null)?.user_id ?? null
  // GRI taken before the company existed carries only the owner's user_id.
  const griQuery = client.from('gri_assessments').select('gri_index, created_at').eq('is_current', true)
  const [latest, snaps, disc, gri, docs, metricRows, queue] = await Promise.all([
    client.from('point_a_snapshots').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1),
    // The history needs only the summary of each snapshot (not inputs / blocks).
    client.from('point_a_snapshots').select('id, created_at, overall, confidence, change_reasons').eq('company_id', companyId).order('created_at', { ascending: false }).limit(30),
    client.from('data_discrepancies').select('id, metric_key, period_key, kind, detail, chosen_value, candidates').eq('company_id', companyId).eq('status', 'open').order('created_at', { ascending: false }).limit(50),
    (ownerId && /^[0-9a-f-]{36}$/i.test(ownerId) ? griQuery.or(`company_id.eq.${companyId},user_id.eq.${ownerId}`) : griQuery.eq('company_id', companyId))
      .order('created_at', { ascending: false }).limit(1),
    client.from('documents').select('parse_status').eq('company_id', companyId),
    client.from('metrics').select('metric_key').eq('company_id', companyId).not('metric_value', 'is', null),
    service.from('point_a_recalc_queue').select('started_at, due_at, last_error').eq('company_id', companyId).maybeSingle(),
  ])
  for (const r of [latest, snaps, disc]) if (r.error && !missing(r.error)) throw new Error(`point-a state: read failed (${r.error.code ?? 'unknown'})`)

  const rows = (snaps.error ? [] : snaps.data ?? []) as Array<Record<string, unknown>>
  const latestRow = ((latest.error ? [] : latest.data ?? []) as Array<Record<string, unknown>>)[0]
  const snapshot = latestRow ? snapshotView(latestRow) : null

  const industry = (company.data as { industry?: string | null } | null)?.industry ?? null
  const survey = ownerId
    ? await client.from('survey_answers').select('question_key, step, answer').eq('user_id', ownerId)
    : { data: [], error: null }
  const progress = surveyProgressFromRows(((survey.data ?? []) as Array<{ question_key: string; step: number | null; answer: unknown }>))

  const goals = await loadGoalsWithEvaluation(client, companyId).catch((err) => {
    console.error('[point-a/state] goals not loaded', err instanceof Error ? err.message : err)
    return []
  })
  const cfg = await loadBlockConfig(client, companyId, industry)
  const chosen = (cfg.company.clientView?.keyMetrics ?? []).filter((id) => getMetricById(id))
  const keyMetricIds = (chosen.length ? chosen : DEFAULT_KEY_METRICS).slice(0, MAX_KEY_METRICS)
  const keyMetrics = await loadMetricViews(client, companyId, keyMetricIds).catch((err) => {
    console.error('[point-a/state] key metrics not loaded', err instanceof Error ? err.message : err)
    return []
  })

  const bench = findBenchmark(industry, snapshot?.stage ?? null)
  const benchmarks = bench && snapshot
    ? {
        industry: bench.industry,
        stage: bench.stage,
        source: bench.source === 'curated' ? 'экспертная оценка, не статистика' : `выборка: ${bench.sampleSize ?? '—'}`,
        overall: bench.overall,
        blocks: (Object.keys(bench.blocks) as BenchmarkBlockKey[]).map((k) => {
          const score = snapshot.blocks.find((b) => b.key === k)?.score ?? null
          return {
            key: k as BlockKey,
            title: BLOCK_LIBRARY[k as BlockKey].title,
            benchmark: bench.blocks[k],
            score,
            rating: score === null ? null : ratingLabel(percentileAgainstBenchmark(score, bench.blocks[k])).label,
          }
        }),
      }
    : null

  const docRows = (docs.error ? [] : docs.data ?? []) as Array<{ parse_status: string | null }>
  // A row backing off after a failed run is not «running» for the page.
  const q = queue.error ? null : (queue.data as { started_at: string | null; last_error: string | null } | null)

  return {
    snapshot,
    history: rows.map((r) => ({
      id: String(r.id),
      createdAt: String(r.created_at),
      overall: num(r.overall),
      confidence: num(r.confidence),
      changes: (Array.isArray(r.change_reasons) ? (r.change_reasons as ChangeReason[]) : []).map((c) => c.text),
    })),
    discrepancies: ((disc.error ? [] : disc.data ?? []) as Array<Record<string, unknown>>).map((d) => ({
      id: String(d.id),
      metricKey: String(d.metric_key),
      metricLabel: getMetricById(String(d.metric_key))?.label ?? String(d.metric_key),
      periodKey: String(d.period_key),
      periodLabel: periodLabel(String(d.period_key)),
      kind: String(d.kind),
      detail: (d.detail as string | null) ?? null,
      chosenValue: num(d.chosen_value),
      candidates: Array.isArray(d.candidates) ? (d.candidates as PointAState['discrepancies'][number]['candidates']) : [],
    })),
    goals,
    gri: (() => {
      const g = ((gri.error ? [] : gri.data ?? []) as Array<{ gri_index: unknown; created_at: string }>)[0]
      const v = num(g?.gri_index)
      return { index100: v === null ? null : Math.round(v * 10), assessedAt: g?.created_at ?? null }
    })(),
    benchmarks,
    sources: {
      survey: { percent: progress.percent, completed: progress.completed, total: progress.total_steps },
      documents: {
        parsed: docRows.filter((d) => d.parse_status === 'parsed' || d.parse_status === 'completed').length,
        processing: docRows.filter((d) => d.parse_status === 'queued' || d.parse_status === 'pending' || d.parse_status === 'processing' || d.parse_status === 'needs_ocr').length,
        failed: docRows.filter((d) => d.parse_status === 'failed' || d.parse_status === 'error' || d.parse_status === 'rejected').length,
      },
      // distinct metrics, not rows (a metric may have several periods / sources)
      metrics: new Set(((metricRows.error ? [] : metricRows.data ?? []) as Array<{ metric_key: string }>).map((r) => r.metric_key)).size,
    },
    recalculation: !q ? 'idle' : q.started_at ? 'running' : q.last_error ? 'idle' : 'queued',
    config: {
      template: cfg.template.key,
      templateTitle: cfg.template.title,
      added: cfg.company.clientView?.added ?? [],
      blocks: cfg.blocks.map((b) => ({ key: b.key, title: b.title, weight: b.weight, hiddenForClient: b.hiddenForClient, informational: b.informational, order: b.order })),
    },
    library: BLOCK_KEYS.map((k) => ({ key: k, title: BLOCK_LIBRARY[k].title, description: BLOCK_LIBRARY[k].description })),
    keyMetrics,
    keyMetricsCustom: chosen.length > 0,
    metricCatalog: keyMetricCatalog(),
  }
}
