/**
 * Unified chat / embeddings client for features outside the agent runtime.
 *
 * Historically OpenRouter-only (hence the names, kept for the ~14 call sites).
 * Since 094 every call is resolved by lib/ai/providers/router.ts: the owner can
 * route tiers / embeddings to any OpenAI-compatible provider (e.g. Alem Plus);
 * with nothing configured it is OpenRouter's /chat/completions, as before.
 *
 * Env:
 *   OPENROUTER_API_KEY — the built-in fallback key (required unless the owner
 *   configured providers and keys in the admin panel).
 *
 * Default model is Claude Sonnet 4.5 (anthropic/claude-sonnet-4.5).
 * Override via `model` param.
 *
 * Cost and privacy controls (same rules as the agent gateway, lib/ai/gateway.ts):
 *   • providers may not store or train on prompts (AI_PRIVACY_MODE, lib/ai/privacy.ts);
 *   • no call once today's platform AI spend reached AGENT_PLATFORM_DAILY_BUDGET_USD;
 *   • the provider-reported cost of every call goes to ai_usage_ledger (093)
 *     (platform / provider / company budgets) and, per user and feature, to
 *     ai_usage (091, lib/ai/usage.ts — per-tier user budgets and the GIGA report).
 */

import {
  chatCompletion,
  computeCost,
  createEmbeddings,
  estimateTokens,
  knownModelPrices,
  TIER_ESTIMATE_PRICES_PER_MTOK,
  worstCaseCostUsd,
  type ChatMessage,
} from './providers/client'
import { hasConfiguredChatRoute, providerBudgetRefusal, resolveTarget } from './providers/router'
import type { ChatTier, ProviderTarget } from './providers/types'
import { platformBudgetLeft, recordUsage } from './usage-ledger'
import { recordAiUsage, type AiFeature } from './usage'

export type { AiFeature } from './usage'

export const OPENROUTER_MODELS = {
  sonnet5: 'anthropic/claude-sonnet-5',
  sonnet: 'anthropic/claude-sonnet-4.5',
  haiku:  'anthropic/claude-haiku-4.5',
  opus48: 'anthropic/claude-opus-4.8',
  opus:   'anthropic/claude-opus-4.1',
  gpt4:   'openai/gpt-4o',
  gpt4mini: 'openai/gpt-4o-mini',
} as const

/**
 * Quality/speed tiers for automatic model routing.
 *   fast  — Claude Haiku 4.5: ~2x faster than Sonnet, strong quality. Default
 *           for short/structured/classification work and latency-critical paths.
 *   smart — Claude Sonnet 4.5: deeper reasoning for strategy & nuanced analysis.
 *   max   — Claude Opus 4.1: highest quality, slowest — reserve for rare cases.
 *
 * Measured round-trips (incl. routing): Haiku ~250w 6.7s / ~600w 10.8s;
 * Sonnet ~250w 11.5s / ~600w 23.1s.
 */
export const MODEL_TIERS = {
  fast:  OPENROUTER_MODELS.haiku,
  smart: OPENROUTER_MODELS.sonnet,
  max:   OPENROUTER_MODELS.opus,
} as const

/** Task complexity → drives automatic model selection. */
export type Complexity = 'low' | 'medium' | 'high' | 'max'

/**
 * Map a task's complexity to the most suitable model, balancing quality and
 * speed. `low`/`medium` favour Haiku (fast, cheap, good); `high` uses Sonnet for
 * deeper reasoning; `max` uses Opus for the few highest-stakes generations.
 */
export function pickModel(complexity: Complexity): string {
  switch (complexity) {
    case 'max':  return MODEL_TIERS.max
    case 'high': return MODEL_TIERS.smart
    case 'low':
    case 'medium':
    default:     return MODEL_TIERS.fast
  }
}

/**
 * Heuristic complexity estimate used when a caller specifies neither `model` nor
 * `complexity`. Larger expected outputs and longer prompts imply harder tasks.
 */
export function autoComplexity(opts: { user: string; system?: string; maxTokens?: number }): Complexity {
  const promptChars = (opts.user?.length ?? 0) + (opts.system?.length ?? 0)
  const maxTokens = opts.maxTokens ?? 2000
  // Big, open-ended generations → reason harder. Short ones → go fast.
  if (maxTokens >= 3000 || promptChars >= 12_000) return 'high'
  if (maxTokens <= 600 && promptChars < 4_000) return 'low'
  return 'medium'
}

interface ChatOptions {
  /** Cost-accounting tag (ai_usage.feature). Required on every call site. */
  feature: AiFeature
  /** Who the call is for; defaults to the request actor set by `assertAiBudget`. */
  userId?: string | null
  system?: string
  user: string
  /** Explicit model id. Wins over `complexity`. */
  model?: string
  /** Quality/speed tier. When set (and `model` is not), selects the model. */
  complexity?: Complexity
  maxTokens?: number
  /**
   * `null` deliberately omits temperature for models that do not expose that
   * parameter (for example Claude Sonnet 5).
   */
  temperature?: number | null
  jsonMode?: boolean
  /** Enforce an exact JSON Schema on providers that support structured output. */
  jsonSchema?: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
  /**
   * Abort the request after this many ms. Prevents a stalled OpenRouter/model
   * response from hanging the whole route indefinitely. Default 45s (covers a
   * slow Sonnet/Opus generation); pass a smaller value on latency-critical paths.
   */
  timeoutMs?: number
  /** Avoid logging provider bodies/errors that may echo customer content. */
  privacySensitive?: boolean
  /** Feature name for the spend ledger (ai_usage_ledger.source = `feature:<label>`); defaults to `feature`. */
  label?: string
  /** Company the call is made for, when known (company spend). */
  companyId?: string | null
}

/**
 * Resolve which model a call should use: an explicit `model` always wins; else
 * the `complexity` tier; else an automatic estimate from prompt size/maxTokens.
 */
export function resolveModel(opts: {
  model?: string
  complexity?: Complexity
  user: string
  system?: string
  maxTokens?: number
}): string {
  if (opts.model) return opts.model
  if (opts.complexity) return pickModel(opts.complexity)
  return pickModel(autoComplexity(opts))
}

/**
 * Is a chat model reachable? OPENROUTER_API_KEY, or (best effort, from the
 * router's cached configuration) a chat route to a provider with a usable key.
 */
export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY) || hasConfiguredChatRoute()
}

/** Complexity → gateway tier, so legacy features follow the owner's tier routes. */
const COMPLEXITY_TIER: Record<Complexity, ChatTier> = {
  low: 'light',
  medium: 'light',
  high: 'standard',
  max: 'premium',
}

function logTag(target: ProviderTarget, suffix = ''): string {
  return target.kind === 'openrouter' && target.providerKey === 'openrouter'
    ? `[openrouter${suffix}]`
    : `[ai:${target.providerKey}${suffix}]`
}

interface OpenRouterResponseJson {
  model?: string
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }
}

/**
 * Sends a chat completion. Returns the assistant message text, or null if the
 * request fails. Never throws.
 *
 * Provider: an explicit `model` pins that model id (OpenRouter unless the owner
 * registered it under another provider); otherwise the owner's chat route for
 * the complexity tier (low/medium → light, high → standard, max → premium);
 * otherwise OpenRouter with the complexity model — the pre-094 behaviour.
 */
export async function chatWithOpenRouter(opts: ChatOptions): Promise<string | null> {
  const fallbackModel = resolveModel({
    model: opts.model,
    complexity: opts.complexity,
    user: opts.user,
    system: opts.system,
    maxTokens: opts.maxTokens,
  })
  const tier = COMPLEXITY_TIER[opts.complexity ?? autoComplexity(opts)]
  const resolved = await resolveTarget('chat', { tier, model: opts.model ?? null, fallbackModel })
  if (!resolved.ok) return null
  const target = resolved.target

  const left = await platformBudgetLeft()
  if (left !== null && left <= 0) {
    console.warn(`[openrouter] platform AI budget for today is spent — ${opts.label ?? opts.feature} skipped`)
    return null
  }
  const refusal = await providerBudgetRefusal(target)
  if (refusal) {
    console.warn(`${logTag(target)} ${refusal} — ${opts.label ?? opts.feature} skipped`)
    return null
  }

  const messages: ChatMessage[] = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.user })

  const timeoutMs = opts.timeoutMs ?? 45_000
  const maxTokens = opts.maxTokens ?? 2000
  const started = Date.now()
  const label = opts.label ?? opts.feature
  // Prices for a call whose cost the provider did not report: the model's own
  // (AI_PRICE_TABLE / known ids), else the conservative tier estimate.
  const fallbackPrices = (answeredBy?: string) =>
    knownModelPrices(answeredBy) ?? knownModelPrices(target.model) ?? TIER_ESTIMATE_PRICES_PER_MTOK[tier]
  const res = await chatCompletion(target, {
    messages,
    maxTokens,
    temperature: opts.temperature === null ? null : (opts.temperature ?? 0.7),
    json: opts.jsonMode,
    jsonSchema: opts.jsonSchema,
    timeoutMs,
  })
  if (!res.ok) {
    if (res.code === 'TIMEOUT') {
      // The provider may have generated (and billed) the answer we stopped
      // waiting for: record its worst case so the platform budget sees it.
      const input = `${opts.system ?? ''}${opts.user}`
      await recordUsage({
        source: `feature:${label}`,
        model: target.model,
        tokensIn: estimateTokens(input),
        tokensOut: 0,
        costUsd: worstCaseCostUsd(fallbackPrices(), input, maxTokens),
        costSource: 'estimate',
        companyId: opts.companyId ?? null,
        providerKey: target.providerKey,
        ok: false,
      })
    }
    await recordAiUsage({ feature: opts.feature, model: target.model, ok: false, latencyMs: Date.now() - started, userId: opts.userId })
    if (res.code === 'TIMEOUT' && res.status === null) {
      console.error(`${logTag(target)} request timed out after ${timeoutMs}ms`)
    } else if (opts.privacySensitive) {
      console.error(`${logTag(target)} privacy-sensitive request failed:`, res.status ?? res.message)
    } else if (res.status !== null) {
      console.error(logTag(target), res.status, res.detail ?? '')
    } else {
      console.error(`${logTag(target)} fetch failed:`, res.message)
    }
    return null
  }
  const tokensIn = res.tokensIn ?? 0
  const tokensOut = res.tokensOut ?? 0
  const cost = computeCost({
    providerCostUsd: res.providerCostUsd,
    tokensIn,
    tokensOut,
    priceInPerMtok: target.priceInPerMtok,
    priceOutPerMtok: target.priceOutPerMtok,
    // OpenRouter normally reports the real cost; when it (or another provider
    // without configured prices) does not, record an estimate, never $0.
    estimatePrices: fallbackPrices(res.model),
  })
  await recordUsage({
    source: `feature:${label}`,
    model: res.model,
    tokensIn,
    tokensOut,
    costUsd: cost.costUsd,
    costSource: cost.costSource,
    companyId: opts.companyId ?? null,
    providerKey: target.providerKey,
    ok: true,
  })
  await recordAiUsage({
    feature: opts.feature,
    model: res.model,
    promptTokens: tokensIn,
    completionTokens: tokensOut,
    providerCostUsd: cost.costUsd,
    latencyMs: Date.now() - started,
    ok: Boolean(res.text),
    userId: opts.userId,
  })
  return res.text || null
}

/**
 * Generate embeddings via the routed embeddings provider (OpenRouter's
 * OpenAI-compatible endpoint unless the owner routed `embeddings` elsewhere).
 *
 * Returns an array of embedding vectors (one per input string) or `null` on
 * any failure. Never throws.
 *
 * Defaults:
 *   - model: openai/text-embedding-3-small (1536 dims, cheap)
 *   - dimensions: 1536 (matches the pgvector(1536) column on DocumentChunk)
 *
 * Note: not every model honours the `dimensions` parameter (other providers
 * get it only when the caller passes it). Callers must still verify the
 * returned vector length before persisting.
 */
export async function embedWithOpenRouter(
  texts: string[],
  opts: { feature: AiFeature; model?: string; dimensions?: number; userId?: string | null }
): Promise<number[][] | null> {
  const resolved = await resolveTarget('embeddings', {
    model: opts?.model ?? null,
    fallbackModel: opts?.model ?? 'openai/text-embedding-3-small',
  })
  if (!resolved.ok) return null
  if (!Array.isArray(texts) || texts.length === 0) return []
  const target = resolved.target
  const tag = logTag(target, ':embed')
  const started = Date.now()

  const refusal = await providerBudgetRefusal(target)
  if (refusal) {
    console.warn(`${tag} ${refusal}`)
    return null
  }

  const res = await createEmbeddings(target, {
    input: texts,
    dimensions: target.kind === 'openrouter' ? (opts?.dimensions ?? 1536) : opts?.dimensions,
    // Hard cap so a stalled embeddings call never hangs the pipeline forever.
    timeoutMs: 20_000,
  })
  if (!res.ok) {
    await recordAiUsage({ feature: opts.feature, model: target.model, ok: false, latencyMs: Date.now() - started, userId: opts.userId })
    if (res.code === 'TIMEOUT' && res.status === null) {
      console.error(`${tag} request timed out after 20000ms`)
    } else if (res.status !== null) {
      console.error(tag, res.status, res.detail ?? '')
    } else {
      console.error(`${tag} fetch failed:`, res.message)
    }
    return null
  }
  if (res.vectors.length !== texts.length) {
    console.warn(`${tag} length mismatch: requested=${texts.length} got=${res.vectors.length}`)
  }
  const vectors: number[][] = []
  for (const v of res.vectors) {
    if (!v) return null
    vectors.push(v)
  }
  if (target.origin === 'db' || res.tokensIn !== null || res.providerCostUsd !== null) {
    const tokensIn = res.tokensIn ?? 0
    const cost = computeCost({
      providerCostUsd: res.providerCostUsd,
      tokensIn,
      tokensOut: 0,
      priceInPerMtok: target.priceInPerMtok,
      priceOutPerMtok: target.priceOutPerMtok,
    })
    await recordUsage({
      source: 'feature:embeddings',
      model: res.model,
      tokensIn,
      tokensOut: 0,
      costUsd: cost.costUsd,
      costSource: cost.costSource,
      providerKey: target.providerKey,
      ok: true,
    })
  }
  await recordAiUsage({
    feature: opts.feature,
    model: res.model,
    promptTokens: res.tokensIn,
    completionTokens: 0,
    providerCostUsd: res.providerCostUsd,
    latencyMs: Date.now() - started,
    ok: true,
    userId: opts.userId,
  })
  return vectors
}

/**
 * Extracts a JSON payload from a model response. Handles fenced code blocks,
 * inline JSON, and plain text. Returns `null` if no valid JSON is found.
 */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  const raw = fenced ? fenced[1].trim() : text
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  const candidate = first !== -1 && last > first ? raw.slice(first, last + 1) : raw
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}
