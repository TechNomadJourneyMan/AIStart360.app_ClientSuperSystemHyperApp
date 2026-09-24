/**
 * lib/ai/usage.ts — token/cost accounting for every AI call (F-070).
 *
 * `chatWithOpenRouter` / `embedWithOpenRouter` call `recordAiUsage` after each
 * request with the provider's `usage`, so `ai_usage` (migration 091) shows what
 * each feature costs. Recording never throws and never blocks the answer on a
 * DB error.
 *
 * WHO pays: routes attribute calls to a user either explicitly (`userId` on the
 * call options) or implicitly through the request-scoped actor set by
 * `setAiActor` (done by `assertAiBudget`), so library code deep in the call
 * chain (assistant/answer.ts, point-a-analyzer …) does not need a user param.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { estimateCostUsd } from './pricing'

/** Every place that spends AI tokens. Keep in sync with the report in the admin tile. */
export const AI_FEATURES = {
  ai_chat: 'Чат по отчёту',
  assistant_ask: 'Ассистент: вопрос',
  assistant_converse: 'Ассистент: диалог с Гри',
  assistant_insight: 'Ассистент: инсайт экрана',
  assistant_analyze: 'Ассистент: анализ ситуации',
  pulse_briefing: 'Pulse: утренний брифинг',
  point_a_analysis: 'Точка А: AI-анализ',
  point_a_narrative: 'Точка А: сводка',
  point_a_insights: 'Точка А: инсайты',
  point_b_strategy: 'Точка Б: стратегия',
  expert_review_draft: 'Черновик разбора эксперта',
  market_analysis: 'Анализ рынка',
  journey: 'AI Journey',
  gri_financial_analyst: 'GRI: финансовый аналитик',
  gri_ai_strategy: 'GRI: AI-стратегия',
  gri_document_diagnostic: 'GRI по документу',
  omnichannel: 'Омниканальные ответы',
  doc_extract: 'Документы: разбор',
  doc_bind_fields: 'Документы: привязка полей',
  doc_embed: 'Документы: индексация',
  doc_retrieval: 'Документы: поиск',
} as const

export type AiFeature = keyof typeof AI_FEATURES

export function aiFeatureLabel(feature: string): string {
  return (AI_FEATURES as Record<string, string>)[feature] ?? feature
}

/** Pseudo-model written for cache hits (0 tokens, 0 cost) — visible in the report. */
export const CACHE_HIT_MODEL = 'cache_hit'

// ─── Request-scoped actor ────────────────────────────────────────────────────

export interface AiActor {
  /** Supabase auth user id (UUID) of the person the call is made for. */
  userId?: string | null
  /** Staff / system actor id (e.g. `giga:…`, `cron`) when there is no user. */
  actorId?: string | null
}

const actorStorage = new AsyncLocalStorage<AiActor>()

/**
 * Attribute every AI call made later in the CURRENT request to `actor`.
 * Uses `enterWith`, so it must be called from the route's own async flow
 * (directly, or from the synchronous prefix of an awaited helper).
 */
export function setAiActor(actor: AiActor): void {
  actorStorage.enterWith({ userId: actor.userId ?? null, actorId: actor.actorId ?? null })
}

/** Run `fn` with an explicit actor (preferred in scripts / background jobs). */
export function runWithAiActor<T>(actor: AiActor, fn: () => T): T {
  return actorStorage.run({ userId: actor.userId ?? null, actorId: actor.actorId ?? null }, fn)
}

export function currentAiActor(): AiActor | null {
  return actorStorage.getStore() ?? null
}

// ─── Recording ───────────────────────────────────────────────────────────────

export interface AiUsageRow {
  user_id: string | null
  actor_id: string | null
  feature: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number | null
  latency_ms: number | null
  ok: boolean
}

export interface RecordAiUsageInput {
  feature: AiFeature
  model: string
  promptTokens?: number | null
  completionTokens?: number | null
  /** Exact cost reported by OpenRouter (`usage.cost`), wins over the price map. */
  providerCostUsd?: number | null
  latencyMs?: number | null
  ok: boolean
  userId?: string | null
  actorId?: string | null
}

export type AiUsageSink = (row: AiUsageRow) => Promise<void>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Default sink: service-role insert. Disabled under the test runner (tests inject a sink). */
const defaultSink: AiUsageSink = async (row) => {
  if (process.env.NODE_ENV === 'test') return
  const { createServiceClient } = await import('@/lib/supabase-service')
  const { error } = await createServiceClient().from('ai_usage').insert(row)
  if (error) console.warn('[ai-usage] insert failed:', error.message)
}

let sink: AiUsageSink = defaultSink

/** Test hook: replace the sink (pass `null` to restore the default). */
export function __setAiUsageSink(next: AiUsageSink | null): void {
  sink = next ?? defaultSink
}

const toInt = (n: unknown): number => {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0
}

export function buildAiUsageRow(input: RecordAiUsageInput): AiUsageRow {
  const actor = currentAiActor()
  const rawUser = input.userId ?? actor?.userId ?? null
  const userId = rawUser && UUID_RE.test(rawUser) ? rawUser : null
  const actorId = input.actorId ?? actor?.actorId ?? (rawUser && !userId ? rawUser : null)
  const promptTokens = toInt(input.promptTokens)
  const completionTokens = toInt(input.completionTokens)
  const provider = typeof input.providerCostUsd === 'number' && Number.isFinite(input.providerCostUsd)
    ? Math.round(input.providerCostUsd * 1e6) / 1e6
    : null
  const cost = input.model === CACHE_HIT_MODEL
    ? 0
    : provider ?? estimateCostUsd(input.model, promptTokens, completionTokens)
  return {
    user_id: userId,
    actor_id: actorId ? String(actorId).slice(0, 120) : null,
    feature: input.feature,
    model: input.model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cost_usd: cost,
    latency_ms: input.latencyMs == null ? null : toInt(input.latencyMs),
    ok: input.ok,
  }
}

/** Record one AI call. Never throws. */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  try {
    await sink(buildAiUsageRow(input))
  } catch (err) {
    console.warn('[ai-usage] record failed:', err instanceof Error ? err.message : err)
  }
}

/** Record a cache hit (an LLM call that did NOT happen) — 0 tokens, 0 cost. */
export function recordAiCacheHit(feature: AiFeature, opts: { userId?: string | null } = {}): Promise<void> {
  return recordAiUsage({ feature, model: CACHE_HIT_MODEL, ok: true, latencyMs: 0, userId: opts.userId })
}
