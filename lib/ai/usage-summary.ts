/**
 * lib/ai/usage-summary.ts — fold ai_usage_summary rows (feature × model) into
 * per-feature totals for the admin AI cost tile.
 */

import { aiFeatureLabel, CACHE_HIT_MODEL } from './usage'

export interface AiUsageSummaryRow {
  feature: string
  model: string
  calls: number | string
  failed_calls: number | string
  prompt_tokens: number | string
  completion_tokens: number | string
  cost_usd: number | string | null
  avg_latency_ms: number | null
}

export interface AiUsageFeature {
  feature: string
  label: string
  calls: number
  failed_calls: number
  cache_hits: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  models: string[]
}

export function summarizeAiUsage(rows: AiUsageSummaryRow[]): { features: AiUsageFeature[]; total_cost_usd: number; total_calls: number; cache_hits: number } {
  const byFeature = new Map<string, AiUsageFeature>()
  for (const r of rows) {
    const f = byFeature.get(r.feature) ?? {
      feature: r.feature, label: aiFeatureLabel(r.feature), calls: 0, failed_calls: 0, cache_hits: 0,
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, models: [],
    }
    const calls = Number(r.calls) || 0
    if (r.model === CACHE_HIT_MODEL) {
      f.cache_hits += calls
    } else {
      f.calls += calls
      f.failed_calls += Number(r.failed_calls) || 0
      f.prompt_tokens += Number(r.prompt_tokens) || 0
      f.completion_tokens += Number(r.completion_tokens) || 0
      f.cost_usd += Number(r.cost_usd) || 0
      if (!f.models.includes(r.model)) f.models.push(r.model)
    }
    byFeature.set(r.feature, f)
  }
  const features = Array.from(byFeature.values())
    .map((f) => ({ ...f, cost_usd: Math.round(f.cost_usd * 1e4) / 1e4 }))
    .sort((a, b) => b.cost_usd - a.cost_usd || b.calls - a.calls)
  return {
    features,
    total_cost_usd: Math.round(features.reduce((s, f) => s + f.cost_usd, 0) * 1e4) / 1e4,
    total_calls: features.reduce((s, f) => s + f.calls, 0),
    cache_hits: features.reduce((s, f) => s + f.cache_hits, 0),
  }
}
