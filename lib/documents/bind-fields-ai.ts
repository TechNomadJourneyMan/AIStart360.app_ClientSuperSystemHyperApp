/**
 * AI-assisted metric binding (Phase 2, OPTIONAL fallback).
 *
 * This module is the LLM-powered escape hatch for fields that the deterministic
 * `lib/documents/bind-fields.ts` binder couldn't confidently match against the
 * canonical synonym dictionary. It is intentionally a *separate* module so the
 * deterministic path can stay synchronous, cheap, and audit-friendly, and the
 * AI path only kicks in for ambiguous candidates.
 *
 * Design contract:
 *   - NEVER throws. Returns `null` (single) or pass-through (batch) on failure.
 *   - Requires `OPENROUTER_API_KEY` — degrades to null when missing.
 *   - Pre-filters the 122-metric registry down to ≤ topCandidates via Jaccard
 *     token similarity to shrink the LLM payload.
 *   - Caches results in-memory per process (`${cacheKey}:${field.key}:${label}`).
 *   - Only sets `metric_id` when AI returns `confidence >= 0.6`.
 *   - Idempotent: a field that already has `metric_id` set is passed through.
 *   - Logs a rough token-cost estimate via `console.info`. Never blocks.
 *
 * The deterministic binder (when it lands) is expected to call
 * `bindFieldsWithAI(...)` on the residual unbound fields only.
 */

import { z } from 'zod'
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey,
  OPENROUTER_MODELS,
} from '@/lib/ai/openrouter'
import type { ParsedDataField } from '@/lib/documents/extract'
import { getMetricRegistry } from '@/lib/metrics/registry'
import type { MetricEntry } from '@/lib/metrics/types'

// ─── Public types ────────────────────────────────────────────

export interface AiBindOptions {
  /** Cap on candidate metrics to send to the LLM. Default 30. */
  topCandidates?: number
  /**
   * Only attempt AI binding when field confidence >= this. Default 0.7 — we
   * don't want to waste LLM tokens on garbage extractions.
   */
  minSourceConfidence?: number
  /** Per-doc cache key. If same docId rebinds same fields, return cached result. */
  cacheKey?: string
}

export interface AiBindCandidate {
  id: string
  label: string
  /** Similarity distance used for ranking (Jaccard 0..1, higher = closer). */
  distance: number
}

export interface AiBindResult {
  /** Mutated copy of the input field, with `metric_id` populated when confident. */
  field: ParsedDataField
  bound: boolean
  metricId: string | null
  /** AI-reported confidence, clamped to [0, 1]. */
  confidence: number
  /** Russian short explanation for UI tooltip. */
  reasoning: string
  candidates: AiBindCandidate[]
}

// ─── Internal: similarity helpers ────────────────────────────

/**
 * Tokenize a string for fuzzy similarity.
 *  - lowercased
 *  - ё → е
 *  - splits on any non-alphanumeric (Latin or Cyrillic)
 *  - drops 1-char tokens (noise)
 */
function tokenize(s: string): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length > 1)
}

/**
 * Jaccard similarity over token sets. Range [0, 1].
 *  - 1.0 when token sets are identical
 *  - 0.0 when they are disjoint
 *  - 0.0 when both sides have no usable tokens
 */
function jaccardSimilarity(a: string, b: string): number {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (A.size === 0 && B.size === 0) return 0
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

// Re-exported for tests + downstream introspection.
export { tokenize, jaccardSimilarity }

// ─── Candidate ranking ───────────────────────────────────────

/**
 * Rank registry metrics against a field by combined token similarity.
 * Metrics whose `MetricSource[]` includes a `type=document` source with
 * matching `doc_type` get a small boost so the LLM sees them first.
 */
export function rankCandidates(
  field: ParsedDataField,
  docType: string,
  registry: MetricEntry[],
  topN: number
): AiBindCandidate[] {
  const haystack = [field.label, field.key, field.target_parameter, field.target_tab]
    .filter(Boolean)
    .join(' ')

  const docTypeNorm = (docType ?? '').toLowerCase().trim()

  const scored: AiBindCandidate[] = registry.map((entry) => {
    // Build a candidate "needle" from the metric label + dept/goal tags.
    const needleParts = [entry.label, entry.department ?? '', entry.goalNumber ?? '']
    const needle = needleParts.filter(Boolean).join(' ')
    let distance = jaccardSimilarity(haystack, needle)

    // Doc-type boost: if any declared source binds to this doc_type, nudge up.
    if (docTypeNorm) {
      const hasDocSource = entry.sources.some(
        (src) =>
          src.type === 'document' &&
          typeof src.doc_type === 'string' &&
          src.doc_type.toLowerCase().includes(docTypeNorm)
      )
      if (hasDocSource) distance += 0.15
    }

    return { id: entry.id, label: entry.label, distance }
  })

  scored.sort((a, b) => b.distance - a.distance)
  // Even with zero matches, keep some candidates so the LLM has *something*
  // to reason over — it can still return metric_id=null.
  return scored.slice(0, Math.max(1, topN))
}

// ─── Zod schema for AI response ──────────────────────────────

const aiResponseSchema = z.object({
  metric_id: z.union([z.string().min(1), z.null()]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(500),
})

// ─── In-memory cache ─────────────────────────────────────────

const cache = new Map<string, AiBindResult>()

function cacheKeyFor(opts: AiBindOptions | undefined, field: ParsedDataField): string {
  const id = opts?.cacheKey ?? 'noid'
  return `${id}:${field.key}:${field.label}`
}

/** Test-only: reset the in-memory cache between cases. */
export function __resetAiBindCache(): void {
  cache.clear()
}

// ─── Prompt builders ─────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — специалист по сопоставлению полей бизнес-документов с каноническим каталогом метрик AIStart360.
Тебе дают одно извлечённое поле документа и краткий список метрик-кандидатов из реестра.
Каждый кандидат — это id и человекочитаемая метка (Russian). Часть кандидатов имеет указанный тип документа в источниках.
Твоя задача: выбрать метрику, к которой это поле относится с уверенностью, либо вернуть metric_id=null, если ничего точно не подходит.
Никогда не придумывай id, которого нет в списке кандидатов.
Если поле описывает совсем другой показатель — верни null. Лучше null, чем неправильный bind.
В reasoning кратко (1–2 предложения, по-русски) объясни выбор и при возможности укажи MetricSource, который подтверждает связь.
Возвращай строго JSON: {"metric_id":"<id|null>","confidence":<0..1>,"reasoning":"<russian>"}.
confidence — это твоя оценка качества сопоставления; ставь >=0.6 только при уверенном совпадении.
Если несколько кандидатов подходят одинаково — выбери самый узкий/специфичный и снизь confidence.
Не оборачивай ответ в кодовые блоки.`

function buildUserPrompt(
  field: ParsedDataField,
  docType: string,
  candidates: AiBindCandidate[],
  registry: MetricEntry[]
): string {
  const byId = new Map(registry.map((e) => [e.id, e]))
  const lines: string[] = []
  lines.push(`Тип документа: ${docType || 'не указан'}`)
  lines.push('')
  lines.push('Извлечённое поле:')
  lines.push(`  key: ${field.key}`)
  lines.push(`  label: ${field.label}`)
  lines.push(`  target_tab: ${field.target_tab}`)
  lines.push(`  target_parameter: ${field.target_parameter}`)
  if (field.source) lines.push(`  source_quote: ${field.source.slice(0, 200)}`)
  if (typeof field.confidence === 'number')
    lines.push(`  extractor_confidence: ${field.confidence.toFixed(2)}`)
  lines.push(`  value_sample: ${stringifyValue(field.value)}`)
  lines.push('')
  lines.push('Кандидаты (id — label — релевантные источники):')

  for (const c of candidates) {
    const entry = byId.get(c.id)
    const sources = entry?.sources ?? []
    const docSrc = sources.find(
      (s) =>
        s.type === 'document' &&
        typeof s.doc_type === 'string' &&
        (docType ? s.doc_type.toLowerCase().includes(docType.toLowerCase()) : true)
    )
    const srcSummary = docSrc
      ? `[document:${docSrc.doc_type}${docSrc.field ? `/${docSrc.field}` : ''}]`
      : sources[0]
        ? `[${sources[0].type}${sources[0].field ? `:${sources[0].field}` : ''}]`
        : '[no-source]'
    lines.push(`  - ${c.id} — ${c.label} ${srcSummary}`)
  }

  lines.push('')
  lines.push('Верни только JSON ответ.')
  return lines.join('\n')
}

function stringifyValue(v: ParsedDataField['value']): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  } catch {
    return String(v).slice(0, 120)
  }
}

// ─── Cost estimation ─────────────────────────────────────────

/** Crude char→token estimate (~4 chars/token). Logged for cost visibility. */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// ─── Public API: single-field bind ───────────────────────────

export async function bindFieldWithAI(
  field: ParsedDataField,
  docType: string,
  opts?: AiBindOptions
): Promise<AiBindResult | null> {
  // (10) Idempotency — already-bound fields short-circuit.
  if ((field as ParsedDataField & { metric_id?: string | null }).metric_id) {
    return {
      field: { ...field },
      bound: true,
      metricId:
        (field as ParsedDataField & { metric_id?: string | null }).metric_id ?? null,
      confidence: typeof field.confidence === 'number' ? field.confidence : 1,
      reasoning: 'Поле уже связано с метрикой ранее (idempotent skip).',
      candidates: [],
    }
  }

  // No key → no AI; deterministic-only.
  if (!hasOpenRouterKey()) return null

  // (2) Budget guard.
  const minConf = opts?.minSourceConfidence ?? 0.7
  if (typeof field.confidence === 'number' && field.confidence < minConf) {
    return {
      field: { ...field },
      bound: false,
      metricId: null,
      confidence: 0,
      reasoning: `Пропущено: исходная уверенность ${field.confidence.toFixed(2)} ниже порога ${minConf.toFixed(2)}.`,
      candidates: [],
    }
  }

  // (7) Cache lookup.
  const ck = cacheKeyFor(opts, field)
  const hit = cache.get(ck)
  if (hit) return hit

  // (1) Pre-filter via similarity.
  const registry = getMetricRegistry()
  const topN = opts?.topCandidates ?? 30
  const candidates = rankCandidates(field, docType, registry, topN)

  // (4,5) Build prompts.
  const userPrompt = buildUserPrompt(field, docType, candidates, registry)

  // (9) Cost guard.
  const sysTokens = estimateTokens(SYSTEM_PROMPT)
  const userTokens = estimateTokens(userPrompt)
  console.info(
    `[bind-fields-ai] field="${field.label}" candidates=${candidates.length} est_input_tokens=${sysTokens + userTokens}`
  )

  // Use Sonnet for single-field (quality path).
  const raw = await chatWithOpenRouter({
    model: OPENROUTER_MODELS.sonnet,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 600,
    temperature: 0.1,
    jsonMode: true,
  })

  if (!raw) {
    const result: AiBindResult = {
      field: { ...field },
      bound: false,
      metricId: null,
      confidence: 0,
      reasoning: 'AI вернул пустой ответ.',
      candidates,
    }
    cache.set(ck, result)
    return result
  }

  const parsed = extractJson<unknown>(raw)
  const validated = aiResponseSchema.safeParse(parsed)
  if (!validated.success) {
    console.warn(
      '[bind-fields-ai] invalid response',
      validated.error.issues.slice(0, 2)
    )
    const result: AiBindResult = {
      field: { ...field },
      bound: false,
      metricId: null,
      confidence: 0,
      reasoning: 'AI вернул невалидный JSON; bind пропущен.',
      candidates,
    }
    cache.set(ck, result)
    return result
  }

  const ai = validated.data
  // Defensive: ensure returned id exists in the candidate list. Hallucinated
  // ids are silently discarded.
  const candidateIds = new Set(candidates.map((c) => c.id))
  const safeId =
    ai.metric_id && candidateIds.has(ai.metric_id) ? ai.metric_id : null

  // (8) 0.6 threshold for actually setting metric_id.
  const acceptedId = safeId && ai.confidence >= 0.6 ? safeId : null

  const fieldOut: ParsedDataField & { metric_id?: string | null } = {
    ...field,
    metric_id: acceptedId,
  }

  const result: AiBindResult = {
    field: fieldOut,
    bound: Boolean(acceptedId),
    metricId: acceptedId,
    confidence: ai.confidence,
    reasoning: ai.reasoning,
    candidates,
  }
  cache.set(ck, result)
  return result
}

// ─── Public API: batched bind ────────────────────────────────

/**
 * Batched version: processes every field through the AI in parallel.
 * Uses Haiku (cheaper) by default for batched calls — single-field callers
 * who want Sonnet quality should use `bindFieldWithAI` directly.
 *
 * Returns a new array of fields. Original array is not mutated. Fields that
 * the AI bound get `metric_id` set; everything else passes through.
 */
export async function bindFieldsWithAI(
  fields: ParsedDataField[],
  docType: string,
  opts?: AiBindOptions
): Promise<ParsedDataField[]> {
  if (!Array.isArray(fields) || fields.length === 0) return []

  const minConf = opts?.minSourceConfidence ?? 0.7
  const topN = opts?.topCandidates ?? 30

  const results = await Promise.all(
    fields.map(async (field) => {
      // (10) Idempotency.
      const alreadyBound = (
        field as ParsedDataField & { metric_id?: string | null }
      ).metric_id
      if (alreadyBound) return { ...field }

      if (!hasOpenRouterKey()) return { ...field }

      // (2) Budget guard.
      if (typeof field.confidence === 'number' && field.confidence < minConf) {
        return { ...field }
      }

      // (7) Cache.
      const ck = cacheKeyFor(opts, field)
      const hit = cache.get(ck)
      if (hit) return { ...hit.field }

      const registry = getMetricRegistry()
      const candidates = rankCandidates(field, docType, registry, topN)
      const userPrompt = buildUserPrompt(field, docType, candidates, registry)

      const sysTokens = estimateTokens(SYSTEM_PROMPT)
      const userTokens = estimateTokens(userPrompt)
      console.info(
        `[bind-fields-ai:batch] field="${field.label}" candidates=${candidates.length} est_input_tokens=${sysTokens + userTokens}`
      )

      // (5) Haiku for batched throughput.
      const raw = await chatWithOpenRouter({
        model: OPENROUTER_MODELS.haiku,
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 600,
        temperature: 0.1,
        jsonMode: true,
      })

      if (!raw) {
        const result: AiBindResult = {
          field: { ...field },
          bound: false,
          metricId: null,
          confidence: 0,
          reasoning: 'AI вернул пустой ответ.',
          candidates,
        }
        cache.set(ck, result)
        return { ...field }
      }

      const parsed = extractJson<unknown>(raw)
      const validated = aiResponseSchema.safeParse(parsed)
      if (!validated.success) {
        const result: AiBindResult = {
          field: { ...field },
          bound: false,
          metricId: null,
          confidence: 0,
          reasoning: 'AI вернул невалидный JSON; bind пропущен.',
          candidates,
        }
        cache.set(ck, result)
        return { ...field }
      }

      const ai = validated.data
      const candidateIds = new Set(candidates.map((c) => c.id))
      const safeId =
        ai.metric_id && candidateIds.has(ai.metric_id) ? ai.metric_id : null
      const acceptedId = safeId && ai.confidence >= 0.6 ? safeId : null

      const fieldOut: ParsedDataField & { metric_id?: string | null } = {
        ...field,
        metric_id: acceptedId,
      }

      const cached: AiBindResult = {
        field: fieldOut,
        bound: Boolean(acceptedId),
        metricId: acceptedId,
        confidence: ai.confidence,
        reasoning: ai.reasoning,
        candidates,
      }
      cache.set(ck, cached)
      return fieldOut
    })
  )

  return results
}
