/**
 * Structured-output helper over OpenRouter.
 *
 * Replaces the Vercel AI SDK's `generateObject` for the diagnostic analyzers so
 * that a single `OPENROUTER_API_KEY` powers ALL AI on the platform (no separate
 * `ANTHROPIC_API_KEY` needed). We ask the model for JSON, extract it, and
 * validate against the caller's Zod schema. On any failure we return `null`,
 * preserving the platform's honest "no fabrication" fallback behaviour.
 */

import type { ZodSchema } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey as hasConfiguredOpenRouterKey,
  type Complexity,
} from './openrouter'

interface GenerateObjectOptions<T> {
  system: string
  user: string
  schema: ZodSchema<T>
  /** Explicit OpenRouter model id. Wins over `complexity`. */
  model?: string
  /** Quality/speed tier for automatic model selection (when `model` is unset). */
  complexity?: Complexity
  maxTokens?: number
  temperature?: number
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

  // One retry: structured JSON is occasionally malformed or schema-invalid on
  // the first try. A single retry with a firm nudge recovers most of those for
  // a small latency cost, instead of degrading to the honest null fallback.
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

    const raw = await chatWithOpenRouter({
      system: opts.system,
      user,
      model: opts.model,
      complexity: opts.complexity,
      maxTokens: opts.maxTokens ?? 3000,
      temperature: opts.temperature ?? 0.4,
      jsonMode: !useProviderSchema,
      jsonSchema: useProviderSchema ? strictSchema : undefined,
      privacySensitive,
      timeoutMs: opts.timeoutMs,
    })
    if (!raw) continue

    const parsed = extractJson(raw)
    if (parsed == null) {
      console.error(
        privacySensitive
          ? `[${label}] attempt ${attempt + 1}: response was not valid JSON (len=${raw.length})`
          : `[${label}] attempt ${attempt + 1}: response was not valid JSON (len=${raw.length}); tail="${raw.slice(-160).replace(/\n/g, ' ')}"`,
      )
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
