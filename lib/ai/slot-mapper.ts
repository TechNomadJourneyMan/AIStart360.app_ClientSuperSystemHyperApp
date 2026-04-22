/**
 * Slot-mapper — projects persisted entities into UI-ready shape.
 *
 * Phase 1 focus: server-side service for route handlers that need to render
 * a page (point-a, point-b, dashboard). Given a companyId, returns a flat
 * Record<slot_path, value> which the page layer reads.
 *
 * Does NOT call the LLM. Does NOT write to diagnostics.ai_analysis — that
 * stays the job of analyzePointA / analyzePointB (already in codebase).
 *
 * Used by:
 *   - /api/v1/client/slots?paths=dashboard.aiAnalysis,point_a.gauges (new)
 *   - internal orchestrator step 'slot-map' after consensus
 *
 * Server-only.
 */

import { SLOT_MAP, type ComputeMode, type SlotRule } from './slot-map.config'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface ResolveSlotsArgs {
  companyId: string
  userId: string
  /** Optional allow-list of slots to resolve. If omitted, resolves all. */
  paths?: string[]
}

export type SlotValue = {
  value: unknown
  source?: string
  confidence?: number
  updatedAt?: string
}

export type ResolvedSlots = Record<string, SlotValue>

/**
 * Resolve one or more slots to concrete values. Non-existent source rows
 * yield `{ value: null }` — callers render fallback skeletons.
 */
export async function resolveSlots(args: ResolveSlotsArgs): Promise<ResolvedSlots> {
  const paths = args.paths ?? Object.keys(SLOT_MAP)
  const out: ResolvedSlots = {}

  // Pre-load all data in parallel to avoid N+1 DB calls
  const [diagRow, pointBRow, companyRow, metricsRows, activeExtractions] = await Promise.all([
    loadLatestDiagnostic(args.userId, args.companyId),
    loadLatestPointB(args.userId, args.companyId),
    loadCompany(args.companyId),
    loadMetrics(args.companyId),
    loadActiveExtractions(args.companyId),
  ])

  for (const path of paths) {
    const rule = SLOT_MAP[path]
    if (!rule) {
      out[path] = { value: null }
      continue
    }
    out[path] = resolveOne(rule, {
      diag: diagRow,
      pointB: pointBRow,
      company: companyRow,
      metrics: metricsRows,
      extractions: activeExtractions,
    })
  }

  return out
}

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

interface LoadedData {
  diag: Record<string, unknown> | null
  pointB: Record<string, unknown> | null
  company: Record<string, unknown> | null
  metrics: MetricsRow[]
  extractions: ExtractionRow[]
}

interface MetricsRow {
  metric_key: string
  metric_value: number | null
  metric_unit: string | null
  period_year: number | null
  period_quarter: string | null
  source: string
  recorded_at: string
}

interface ExtractionRow {
  entity_type: string
  value: unknown
  unit: string | null
  period_year: number | null
  period_quarter: string | null
  confidence: number
  source_type: string
  extracted_at: string
}

function resolveOne(rule: SlotRule, data: LoadedData): SlotValue {
  switch (rule.compute) {
    case 'direct':
      return resolveDirect(rule, data)
    case 'consensus':
      return resolveConsensus(rule, data)
    case 'aggregate':
      // Aggregators are wired in a future phase (segment-summary, bundles-by-priority).
      // Phase 1: return null so UI shows skeleton.
      return { value: null, source: `aggregate:${rule.aggregator}` }
    default: {
      const _exhaustive: never = rule.compute as never
      return { value: null, source: `unknown:${String(_exhaustive)}` }
    }
  }
}

function resolveDirect(rule: SlotRule, data: LoadedData): SlotValue {
  for (const source of rule.sources) {
    const v = readSource(source, data)
    if (v !== undefined && v !== null) {
      return { value: v.value, source, confidence: v.confidence, updatedAt: v.updatedAt }
    }
  }
  return { value: null }
}

function resolveConsensus(rule: SlotRule, data: LoadedData): SlotValue {
  const candidates: Array<{ src: string; value: unknown; confidence: number; priority: number; updatedAt?: string }> = []

  for (const source of rule.sources) {
    const v = readSource(source, data)
    if (v === undefined || v === null) continue
    candidates.push({
      src: source,
      value: v.value,
      confidence: v.confidence ?? 0.7,
      priority: sourcePriorityForRead(source, rule.prefer),
      updatedAt: v.updatedAt,
    })
  }

  if (!candidates.length) return { value: null }

  candidates.sort((a, b) => {
    const score = b.priority * b.confidence - a.priority * a.confidence
    if (score !== 0) return score
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  })

  const winner = candidates[0]
  return {
    value: winner.value,
    source: winner.src,
    confidence: winner.confidence,
    updatedAt: winner.updatedAt,
  }
}

// -----------------------------------------------------------------------------
// Source readers
// -----------------------------------------------------------------------------

interface RawValue {
  value: unknown
  confidence?: number
  updatedAt?: string
}

function readSource(source: string, data: LoadedData): RawValue | null {
  // diagnostics.<path>
  if (source.startsWith('diagnostics.')) {
    const path = source.slice('diagnostics.'.length)
    return { value: getByPath(data.diag, path) }
  }

  // point_b_analysis.<path>
  if (source.startsWith('point_b_analysis.')) {
    const path = source.slice('point_b_analysis.'.length)
    return { value: getByPath(data.pointB, path) }
  }

  // companies.<col>
  if (source.startsWith('companies.')) {
    const col = source.slice('companies.'.length)
    const v = data.company?.[col]
    return v === undefined ? null : { value: v }
  }

  // metrics.<key>[:year[:Q1]]
  if (source.startsWith('metrics.')) {
    const spec = source.slice('metrics.'.length)
    const [key, year, quarter] = spec.split(':')
    const found = data.metrics.find(
      (m) =>
        m.metric_key === key &&
        (year ? m.period_year === Number(year) : true) &&
        (quarter ? m.period_quarter === quarter : true)
    )
    if (!found) return null
    return { value: found.metric_value, updatedAt: found.recorded_at }
  }

  // ai_extractions.<entity_type>[:year[:Q1]]
  if (source.startsWith('ai_extractions.')) {
    const spec = source.slice('ai_extractions.'.length)
    const [entityType, year, quarter] = spec.split(':')
    const found = data.extractions.find(
      (e) =>
        e.entity_type === entityType &&
        (year ? e.period_year === Number(year) : true) &&
        (quarter ? e.period_quarter === quarter : true)
    )
    if (!found) return null
    return {
      value: found.value,
      confidence: found.confidence,
      updatedAt: found.extracted_at,
    }
  }

  // survey.<question_key> — direct survey_answers read, lightweight
  // (we don't preload; for Phase 1 this is a secondary path — return null
  // to keep the slot-mapper fast. Survey values flow through ai_extractions anyway.)
  if (source.startsWith('survey.')) {
    return null
  }

  // patient_segments:<segment_key> — handled by aggregators in a later phase
  if (source.startsWith('patient_segments')) return null
  if (source.startsWith('growth_bundles')) return null
  if (source.startsWith('revenue_losses')) return null

  return null
}

/** Read a dot-path from a JSON-like object. Returns undefined if missing. */
function getByPath(obj: Record<string, unknown> | null, path: string): unknown {
  if (!obj) return undefined
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

function sourcePriorityForRead(source: string, prefer?: SlotRule['prefer']): number {
  if (source.startsWith('ai_extractions.')) return 0.9 // derived from document/survey, highest fresh
  if (source.startsWith('metrics.')) return 0.85       // consensus-canonical
  if (source.startsWith('companies.')) return 0.8      // authoritative column
  if (source.startsWith('diagnostics.')) return 0.75
  if (source.startsWith('point_b_analysis.')) return 0.75
  if (source.startsWith('survey.')) return 0.7
  return 0.5
}

// -----------------------------------------------------------------------------
// DB loaders (service-role REST; bypass RLS)
// -----------------------------------------------------------------------------

function getServiceRoleUrl(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[slot-mapper] Supabase URL/service role key missing')
  return { url, key }
}

async function supaFetch<T>(path: string): Promise<T | null> {
  const { url, key } = getServiceRoleUrl()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[slot-mapper] ${res.status} fetching ${path}:`, await res.text())
    return null
  }
  return (await res.json()) as T
}

async function loadLatestDiagnostic(userId: string, companyId: string): Promise<Record<string, unknown> | null> {
  const rows = await supaFetch<Record<string, unknown>[]>(
    `diagnostics?user_id=eq.${userId}&company_id=eq.${companyId}&is_current=is.true&order=calculated_at.desc&limit=1`
  )
  return rows?.[0] ?? null
}

async function loadLatestPointB(_userId: string, _companyId: string): Promise<Record<string, unknown> | null> {
  // point_b_analysis is keyed by diagnostic_id; we load latest for this company's current diag
  const diag = await supaFetch<Record<string, unknown>[]>(
    `diagnostics?user_id=eq.${_userId}&company_id=eq.${_companyId}&is_current=is.true&select=id&limit=1`
  )
  const diagId = diag?.[0]?.id
  if (!diagId) return null
  const rows = await supaFetch<Record<string, unknown>[]>(
    `point_b_analysis?diagnostic_id=eq.${diagId}&is_current=is.true&order=calculated_at.desc&limit=1`
  )
  return rows?.[0] ?? null
}

async function loadCompany(companyId: string): Promise<Record<string, unknown> | null> {
  const rows = await supaFetch<Record<string, unknown>[]>(
    `companies?id=eq.${companyId}&limit=1`
  )
  return rows?.[0] ?? null
}

async function loadMetrics(companyId: string): Promise<MetricsRow[]> {
  const rows = await supaFetch<MetricsRow[]>(
    `metrics?company_id=eq.${companyId}&order=recorded_at.desc`
  )
  return rows ?? []
}

async function loadActiveExtractions(companyId: string): Promise<ExtractionRow[]> {
  const rows = await supaFetch<ExtractionRow[]>(
    `ai_extractions?company_id=eq.${companyId}&superseded_by=is.null&order=extracted_at.desc&limit=2000`
  )
  return rows ?? []
}
