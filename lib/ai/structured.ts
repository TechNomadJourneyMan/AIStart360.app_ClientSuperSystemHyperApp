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
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey,
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
  /** Per-attempt network budget; callers with a hard Function deadline should set this. */
  timeoutMs?: number
  /** Tag used in log lines so failures are traceable to a caller. */
  label?: string
}

export { hasOpenRouterKey }

/**
 * Generate a schema-validated object via OpenRouter. Never throws; returns the
 * parsed object, or `null` when the key is missing, the request fails, the
 * response isn't JSON, or it doesn't satisfy the schema.
 */
export async function generateObjectViaOpenRouter<T>(
  opts: GenerateObjectOptions<T>,
): Promise<T | null> {
  const label = opts.label ?? 'structured'
  if (!hasOpenRouterKey()) {
    console.warn(`[${label}] No OPENROUTER_API_KEY — skipping AI generation`)
    return null
  }

  // One retry: structured JSON is occasionally malformed or schema-invalid on
  // the first try. A single retry with a firm nudge recovers most of those for
  // a small latency cost, instead of degrading to the honest null fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nIMPORTANT: Return ONLY one valid, complete, minified JSON object matching the schema exactly. No prose, no markdown.`

    const raw = await chatWithOpenRouter({
      system: opts.system,
      user,
      model: opts.model,
      complexity: opts.complexity,
      maxTokens: opts.maxTokens ?? 3000,
      temperature: opts.temperature ?? 0.4,
      jsonMode: true,
      timeoutMs: opts.timeoutMs,
    })
    if (!raw) continue

    const parsed = extractJson(raw)
    if (parsed == null) {
      console.error(
        `[${label}] attempt ${attempt + 1}: response was not valid JSON (len=${raw.length}); tail="${raw.slice(-160).replace(/\n/g, ' ')}"`,
      )
      continue
    }

    const result = opts.schema.safeParse(parsed)
    if (!result.success) {
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
