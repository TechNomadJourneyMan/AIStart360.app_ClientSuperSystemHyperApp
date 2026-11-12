/**
 * Structured-output helper over OpenRouter.
 *
 * Replaces the Vercel AI SDK's `generateObject` for the diagnostic analyzers so
 * that a single `OPENROUTER_API_KEY` powers ALL AI on the platform (no separate
 * `ANTHROPIC_API_KEY` needed). We ask the model for JSON, extract it, and
 * validate against the caller's Zod schema. On any failure we return `null`,
 * preserving the platform's honest "no fabrication" fallback behaviour.
 *
 * Two attempts. When the first answer is not JSON or fails the schema, the
 * second goes one chat tier up (escalateComplexity: low / medium → high), so a
 * broken answer of the cheap light tier (Alem / Qwen) is redone by Claude.
 * An explicit `model` is never escalated. An answer that is not JSON because
 * it was cut at the token limit (finish_reason 'length', or — without a finish
 * reason — a text that does not close its object/array) is retried with twice
 * the budget, at most MAX_STRUCTURED_TOKENS.
 */

import type { ZodSchema } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { autoComplexity, escalateComplexity, type Complexity } from './complexity'
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey as hasConfiguredOpenRouterKey,
  type AiFeature,
} from './openrouter'

interface GenerateObjectOptions<T> {
  /** Cost-accounting tag (ai_usage.feature). Required on every call site. */
  feature: AiFeature
  /** Who the call is for; defaults to the request actor set by `assertAiBudget`. */
  userId?: string | null
  system: string
  user: string
  schema: ZodSchema<T>
  /** Explicit OpenRouter model id. Wins over `complexity`. */
  model?: string
  /** Quality/speed tier for automatic model selection (when `model` is unset). */
  complexity?: Complexity
  maxTokens?: number
  /** `null` omits temperature for models that do not support it. */
  temperature?: number | null
  /** Opt in to provider-enforced JSON Schema, in addition to local Zod validation. */
  strictJsonSchema?: boolean | 'prompt'
  /** Treat model-emitted nulls as omitted optional object fields. */
  normalizeOptionalNulls?: { preserveKeys?: string[] }
  /** Server-owned normalization before the authoritative schema parse. */
  normalizeCandidate?: (value: unknown) => unknown
  /** Per-attempt network budget; callers with a hard Function deadline should set this. */
  timeoutMs?: number
  /** Tag used in log lines so failures are traceable to a caller. */
  label?: string
}

/** Ceiling of the output budget a cut structured answer is retried with. */
export const MAX_STRUCTURED_TOKENS = 8000

/**
 * Was a non-JSON answer cut at the token limit? The provider's finish reason
 * when it sent one; otherwise the text (code fences stripped) must close its
 * object or array to count as complete.
 */
function wasCut(raw: string, finishReason: string | undefined): boolean {
  if (finishReason) return finishReason === 'length'
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return !/[}\]]$/.test(text)
}

export function hasOpenRouterKey(): boolean {
  if (process.env.NODE_ENV !== 'production' && process.env.JOURNEY_FORCE_DEMO === '1') {
    return false
  }
  return hasConfiguredOpenRouterKey()
}

/**
 * Generate a schema-validated object via OpenRouter. Never throws; returns the
 * parsed object, or `null` when the key is missing, the request fails, the
 * response isn't JSON, or it doesn't satisfy the schema.
 */
export async function generateObjectViaOpenRouter<T>(
  opts: GenerateObjectOptions<T>,
): Promise<T | null> {
  const label = opts.label ?? 'structured'
  const privacySensitive = label.startsWith('omnichannel:')
  if (!hasOpenRouterKey()) {
    console.warn(`[${label}] No OPENROUTER_API_KEY — skipping AI generation`)
    return null
  }

  const strictSchema = opts.strictJsonSchema
    ? buildOpenRouterJsonSchema(opts.schema, label)
    : undefined

  let validationFeedback = ''
  // Grows only after an answer cut at the token limit; every attempt passes it
  // to chatWithOpenRouter, so the budget / worst-case cost guards see it.
  let maxTokens = opts.maxTokens ?? 3000
  let complexity = opts.complexity
  // After a broken answer: the next attempt one chat tier up (never with an
  // explicit model — that is the caller's decision).
  const escalate = (attempt: number) => {
    if (attempt > 0 || opts.model) return
    const from = complexity ?? autoComplexity({ user: opts.user, system: opts.system, maxTokens })
    const next = escalateComplexity(from)
    if (next === from) return
    console.warn(`[${label}] retrying one tier up: complexity ${from} → ${next}`)
    complexity = next
  }

  // One retry: structured JSON is occasionally malformed or schema-invalid on
  // the first try. A single retry with a firm nudge (on a stronger model when
  // the first one was a light-tier one) recovers most of those for a small
  // latency cost, instead of degrading to the honest null fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    const useProviderSchema = Boolean(strictSchema) &&
      opts.strictJsonSchema !== 'prompt' &&
      attempt === 0
    const retryInstruction = attempt === 0
      ? ''
      : `\n\nIMPORTANT: Return ONLY one valid, complete, minified JSON object matching the schema exactly. No prose, no markdown.${validationFeedback}`
    // Some otherwise compatible providers impose grammar limits on large
    // schemas (for example an optional-field cap). If native enforcement is
    // rejected, retry in JSON mode with the same structural contract in-band;
    // the result still must pass the authoritative local Zod schema below.
    const inBandSchema = strictSchema && !useProviderSchema
      ? `\n\nOUTPUT_JSON_SCHEMA:\n${JSON.stringify(strictSchema.schema)}`
      : ''
    const user = `${opts.user}${retryInstruction}${inBandSchema}`

    let finishReason: string | undefined
    const raw = await chatWithOpenRouter({
      feature: opts.feature,
      userId: opts.userId,
      system: opts.system,
      user,
      model: opts.model,
      complexity,
      maxTokens,
      temperature: opts.temperature === undefined ? 0.4 : opts.temperature,
      jsonMode: !useProviderSchema,
      jsonSchema: useProviderSchema ? strictSchema : undefined,
      privacySensitive,
      timeoutMs: opts.timeoutMs,
      label,
      onFinish: (info) => { finishReason = info.finishReason },
    })
    if (!raw) continue

    const parsed = extractJson(raw)
    if (parsed == null) {
      console.error(
        privacySensitive
          ? `[${label}] attempt ${attempt + 1}: response was not valid JSON (len=${raw.length})`
          : `[${label}] attempt ${attempt + 1}: response was not valid JSON (len=${raw.length}); tail="${raw.slice(-160).replace(/\n/g, ' ')}"`,
      )
      escalate(attempt)
      // A cut answer is cut again with the same budget: give the retry more
      // room (never less than asked, at most MAX_STRUCTURED_TOKENS).
      if (attempt < 1 && wasCut(raw, finishReason)) {
        maxTokens = Math.max(maxTokens, Math.min(maxTokens * 2, MAX_STRUCTURED_TOKENS))
        console.warn(`[${label}] attempt ${attempt + 1}: answer cut at the token limit, retrying with maxTokens=${maxTokens}`)
      }
      continue
    }

    const serverNormalized = opts.normalizeCandidate
      ? opts.normalizeCandidate(parsed)
      : parsed
    const normalized = opts.normalizeOptionalNulls
      ? omitOptionalNullFields(
          serverNormalized,
          new Set(opts.normalizeOptionalNulls.preserveKeys ?? []),
        )
      : serverNormalized
    const result = opts.schema.safeParse(normalized)
    if (!result.success) {
      validationFeedback = `\nFix these validation errors from the previous JSON: ${JSON.stringify(
        result.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      )}`
      console.error(
        `[${label}] attempt ${attempt + 1}: schema validation failed:`,
        JSON.stringify(result.error.issues.slice(0, 4)),
      )
      escalate(attempt)
      continue
    }
    return result.data
  }
  return null
}

function buildOpenRouterJsonSchema(
  schema: ZodSchema<unknown>,
  label: string,
): { name: string; strict: true; schema: Record<string, unknown> } {
  const converted = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    // Reuse repeated widget fragments so the prompt fallback stays compact.
    $refStrategy: 'seen',
    strictUnions: true,
  })
  const { $schema: _dialect, ...jsonSchema } = converted
  return {
    name: label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'structured_output',
    strict: true,
    // Provider-enforced schemas intentionally keep structural constraints only.
    // Anthropic/OpenRouter reject several JSON-Schema validation keywords (for
    // example maxItems). Local Zod validation below remains authoritative for
    // sizes, ranges, formats and cross-field refinements.
    schema: stripUnsupportedProviderKeywords(jsonSchema) as Record<string, unknown>,
  }
}

const UNSUPPORTED_PROVIDER_SCHEMA_KEYWORDS = new Set([
  'maxItems',
  'minItems',
  'maxLength',
  'minLength',
  'maximum',
  'minimum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'multipleOf',
  'maxProperties',
  'minProperties',
  'pattern',
  'format',
  'contentEncoding',
  'contentMediaType',
  'default',
  'examples',
])

function stripUnsupportedProviderKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedProviderKeywords)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED_PROVIDER_SCHEMA_KEYWORDS.has(key))
      .map(([key, entry]) => [key, stripUnsupportedProviderKeywords(entry)]),
  )
}

function omitOptionalNullFields(value: unknown, preserveKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => omitOptionalNullFields(entry, preserveKeys))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => entry !== null || preserveKeys.has(key))
      .map(([key, entry]) => [key, omitOptionalNullFields(entry, preserveKeys)]),
  )
}
