/**
 * Unified OpenRouter client.
 *
 * OpenRouter speaks the OpenAI chat-completions protocol, so we just fetch
 * their /chat/completions endpoint. No SDK needed.
 *
 * Env:
 *   OPENROUTER_API_KEY — required for live calls.
 *
 * Default model is Claude Sonnet 4.5 (anthropic/claude-sonnet-4.5).
 * Override via `model` param.
 */

import { getSiteUrl } from '@/lib/site-url'

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

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

/**
 * Sends a chat completion via OpenRouter. Returns the assistant message text,
 * or null if the request fails. Never throws.
 */
export async function chatWithOpenRouter(opts: ChatOptions): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const messages: Array<{ role: string; content: string }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.user })

  const body: Record<string, unknown> = {
    model: resolveModel({
      model: opts.model,
      complexity: opts.complexity,
      user: opts.user,
      system: opts.system,
      maxTokens: opts.maxTokens,
    }),
    messages,
    max_tokens: opts.maxTokens ?? 2000,
  }
  if (opts.temperature !== null) {
    body.temperature = opts.temperature ?? 0.7
  }
  if (opts.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: opts.jsonSchema.name,
        strict: opts.jsonSchema.strict ?? true,
        schema: opts.jsonSchema.schema,
      },
    }
    // Do not silently route a strict-schema request through a provider that
    // ignores response_format and returns merely valid, but contract-wrong JSON.
    body.provider = { require_parameters: true }
  } else if (opts.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const timeoutMs = opts.timeoutMs ?? 45_000

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': getSiteUrl(),
        'X-Title': 'AIStart360',
      },
      body: JSON.stringify(body),
      // Hard cap so a stalled model/network never hangs the route forever.
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      if (opts.privacySensitive) {
        console.error('[openrouter] privacy-sensitive request failed:', res.status)
      } else {
        console.error('[openrouter]', res.status, await res.text().catch(() => ''))
      }
      return null
    }
    const json = await res.json()
    return json.choices?.[0]?.message?.content ?? null
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      console.error(`[openrouter] request timed out after ${timeoutMs}ms`)
    } else if (opts.privacySensitive) {
      console.error('[openrouter] privacy-sensitive fetch failed')
    } else {
      console.error('[openrouter] fetch failed:', err)
    }
    return null
  }
}

/**
 * Generate embeddings via OpenRouter's OpenAI-compatible embeddings endpoint.
 *
 * Returns an array of embedding vectors (one per input string) or `null` on
 * any failure. Never throws.
 *
 * Defaults:
 *   - model: openai/text-embedding-3-small (1536 dims, cheap)
 *   - dimensions: 1536 (matches the pgvector(1536) column on DocumentChunk)
 *
 * Note: not every OpenRouter-routed model honours the `dimensions` parameter.
 * Callers should still verify the returned vector length before persisting.
 */
export async function embedWithOpenRouter(
  texts: string[],
  opts?: { model?: string; dimensions?: number }
): Promise<number[][] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  if (!Array.isArray(texts) || texts.length === 0) return []

  const model = opts?.model ?? 'openai/text-embedding-3-small'
  const dimensions = opts?.dimensions ?? 1536

  try {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': getSiteUrl(),
        'X-Title': 'AIStart360',
      },
      body: JSON.stringify({ model, input: texts, dimensions }),
      // Hard cap so a stalled embeddings call never hangs the pipeline forever.
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.error('[openrouter:embed]', res.status, await res.text().catch(() => ''))
      return null
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>
    }
    const data = json.data ?? []
    if (data.length !== texts.length) {
      console.warn(
        `[openrouter:embed] length mismatch: requested=${texts.length} got=${data.length}`
      )
    }
    const vectors: number[][] = []
    for (const item of data) {
      if (!item || !Array.isArray(item.embedding)) return null
      vectors.push(item.embedding)
    }
    return vectors
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      console.error('[openrouter:embed] request timed out after 20000ms')
    } else {
      console.error('[openrouter:embed] fetch failed:', err)
    }
    return null
  }
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
