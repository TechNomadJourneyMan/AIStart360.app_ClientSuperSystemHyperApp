// ============================================================
// lib/point-a/v3/scoring.ts
// Convert a PointAV3 payload to per-block 0–10 scores plus an
// overall weighted score.  The structure mirrors scoring-v2.ts
// (so the API surface feels familiar) but operates on the six
// v3 blocks defined in the spec.
//
// Score derivation per block:
//   1. Map each metric status → 0..10 (excellent=10, good=7.5,
//      warning=5, critical=2.5, no_data=0).
//   2. Block score = mean(status_score) across metrics that have
//      a non-null value; if every metric is no_data, block score = 0
//      and we report it as "no_data".
//   3. Overall = weighted mean(block_score) using the v3 weights.
//
// No I/O. Pure deterministic transform.
// ============================================================

import type {
  AiCommsBlock,
  ClientBlock,
  FinanceBlock,
  FunnelBlock,
  PointAV3,
  RetentionBlock,
  SalesBlock,
  V3BlockId,
  V3Metric,
  V3MetricStatus,
} from '@/types/point-a-v3'

// ─── Public types ───────────────────────────────────────────

export interface V3BlockScore {
  block: V3BlockId
  score: number              // 0..10, rounded to 2 decimals
  status: V3MetricStatus     // overall status for the block
  coverage: number           // 0..1 ratio of metrics with a value
  metric_count: number
  resolved_count: number
}

export interface PointAV3Score {
  overall_score: number      // 0..10 weighted
  blocks: Record<V3BlockId, V3BlockScore>
  weights: Record<V3BlockId, number>
  computed_at: string
}

// ─── Weights ────────────────────────────────────────────────

/**
 * Default v3 weights — sum to 1.0.
 *
 * Rationale (matches the spec's emphasis on cash/sales fundamentals
 * with AI-comms treated as an upside layer):
 *   Sales      0.22
 *   Finance    0.22
 *   Client     0.18
 *   Retention  0.18
 *   Funnel     0.12
 *   AI-Comms   0.08
 */
export const V3_DEFAULT_WEIGHTS: Record<V3BlockId, number> = {
  sales: 0.22,
  finance: 0.22,
  client: 0.18,
  retention: 0.18,
  funnel: 0.12,
  ai_comms: 0.08,
}

// ─── Internals ──────────────────────────────────────────────

const STATUS_SCORE: Record<V3MetricStatus, number> = {
  excellent: 10,
  good: 7.5,
  warning: 5,
  critical: 2.5,
  no_data: 0,
}

function listMetrics(
  block: SalesBlock | ClientBlock | RetentionBlock | FinanceBlock | FunnelBlock | AiCommsBlock,
): V3Metric[] {
  return Object.values(block) as V3Metric[]
}

function scoreBlock(blockId: V3BlockId, metrics: V3Metric[]): V3BlockScore {
  const resolved = metrics.filter((m) => m.value !== null)
  const metric_count = metrics.length
  const resolved_count = resolved.length
  const coverage = metric_count === 0 ? 0 : resolved_count / metric_count

  if (resolved_count === 0) {
    return {
      block: blockId,
      score: 0,
      status: 'no_data',
      coverage: 0,
      metric_count,
      resolved_count: 0,
    }
  }

  const sum = resolved.reduce((acc, m) => acc + STATUS_SCORE[m.status], 0)
  const score = Math.round((sum / resolved_count) * 100) / 100

  // Roll up status: pick the worst status that's worse than 'good' if at
  // least one metric is below 'good'; otherwise the best status across the
  // resolved metrics.
  const worstFirst: V3MetricStatus[] = ['critical', 'warning', 'good', 'excellent']
  let status: V3MetricStatus = 'good'
  for (const s of worstFirst) {
    if (resolved.some((m) => m.status === s)) {
      status = s
      break
    }
  }
  // If all resolved metrics are excellent, promote to excellent.
  if (resolved.every((m) => m.status === 'excellent')) status = 'excellent'

  return { block: blockId, score, status, coverage, metric_count, resolved_count }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

// ─── Public API ─────────────────────────────────────────────

export interface ScoreV3Options {
  /** Override individual block weights. Missing keys fall back to V3_DEFAULT_WEIGHTS. */
  weights?: Partial<Record<V3BlockId, number>>
}

export function scoreV3(payload: PointAV3, options: ScoreV3Options = {}): PointAV3Score {
  const blocks: Record<V3BlockId, V3BlockScore> = {
    sales: scoreBlock('sales', listMetrics(payload.blocks.sales)),
    client: scoreBlock('client', listMetrics(payload.blocks.client)),
    retention: scoreBlock('retention', listMetrics(payload.blocks.retention)),
    finance: scoreBlock('finance', listMetrics(payload.blocks.finance)),
    funnel: scoreBlock('funnel', listMetrics(payload.blocks.funnel)),
    ai_comms: scoreBlock('ai_comms', listMetrics(payload.blocks.ai_comms)),
  }

  // Merge weights — only use provided overrides; normalise to sum to 1.
  const merged: Record<V3BlockId, number> = { ...V3_DEFAULT_WEIGHTS, ...(options.weights ?? {}) }
  let totalW = 0
  for (const id of Object.keys(merged) as V3BlockId[]) {
    if (merged[id] < 0 || !Number.isFinite(merged[id])) merged[id] = 0
    totalW += merged[id]
  }
  if (totalW <= 0) {
    // Recover to defaults.
    Object.assign(merged, V3_DEFAULT_WEIGHTS)
    totalW = 1
  }
  for (const id of Object.keys(merged) as V3BlockId[]) {
    merged[id] = merged[id] / totalW
  }

  // Weighted overall, ignoring blocks that are entirely no_data so their
  // 0-score doesn't drag the overall down unfairly.
  let weightedSum = 0
  let usedWeight = 0
  for (const id of Object.keys(blocks) as V3BlockId[]) {
    const b = blocks[id]
    if (b.status === 'no_data') continue
    weightedSum += b.score * merged[id]
    usedWeight += merged[id]
  }
  const overall = usedWeight > 0 ? weightedSum / usedWeight : 0

  return {
    overall_score: Math.round(clamp(overall, 0, 10) * 100) / 100,
    blocks,
    weights: merged,
    computed_at: payload.computed_at,
  }
}
