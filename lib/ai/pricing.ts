/**
 * lib/ai/pricing.ts — list prices (USD per 1M tokens) of the models this
 * project routes through OpenRouter. Used only to estimate `ai_usage.cost_usd`
 * when OpenRouter does not return the exact `usage.cost` itself.
 *
 * Unknown model → cost `null` (the row is still recorded with its tokens), so a
 * new model never silently shows up as "free". Prices as of 2026-09.
 */

export interface ModelPrice {
  /** USD per 1M prompt (input) tokens. */
  input: number
  /** USD per 1M completion (output) tokens. Embeddings: 0. */
  output: number
}

export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'anthropic/claude-sonnet-5': { input: 2, output: 10 },
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
  'anthropic/claude-opus-4.8': { input: 5, output: 25 },
  'anthropic/claude-opus-4.1': { input: 15, output: 75 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'google/gemini-2.0-flash-001': { input: 0.1, output: 0.4 },
  'openai/text-embedding-3-small': { input: 0.02, output: 0 },
}

/** Look up a model's price; tolerates OpenRouter's dated suffixes (`…-20250929`). */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null
  const exact = MODEL_PRICING[model]
  if (exact) return exact
  const base = model.replace(/[-:@]\d{6,8}$/, '')
  return MODEL_PRICING[base] ?? null
}

/** Estimated cost in USD (6 decimals), or null for an unknown model. */
export function estimateCostUsd(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const p = priceFor(model)
  if (!p) return null
  const cost = (Math.max(0, promptTokens) * p.input + Math.max(0, completionTokens) * p.output) / 1_000_000
  return Math.round(cost * 1e6) / 1e6
}
