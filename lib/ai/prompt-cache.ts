/**
 * LLM structured-extraction wrapper (OpenRouter-first, Anthropic-compatible).
 *
 * All extractors go through this helper. Primary provider is OpenRouter
 * (OPENROUTER_API_KEY) which proxies to Anthropic Claude models and
 * prokidyvaet Anthropic's prompt caching (`cache_control: ephemeral`)
 * transparently for `anthropic/claude-*` model slugs.
 *
 * Fallback: if OPENROUTER_API_KEY missing and ANTHROPIC_API_KEY set,
 * calls Anthropic direct. Allows flipping provider per-env without code
 * changes.
 *
 * Server-only.
 */

import type { z, ZodType } from 'zod'

import { CLAUDE_MODELS, type ClaudeModel } from './anthropic'

// OpenRouter uses slug 'anthropic/claude-sonnet-4.5' etc.
// Anthropic direct uses 'claude-sonnet-4-5'.
// Map our internal keys to both namespaces.
const OPENROUTER_MODEL_MAP: Record<ClaudeModel, string> = {
  [CLAUDE_MODELS.haiku]: 'anthropic/claude-haiku-4.5',
  [CLAUDE_MODELS.sonnet]: 'anthropic/claude-sonnet-4.5',
  [CLAUDE_MODELS.opus]: 'anthropic/claude-opus-4.1',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface CachedExtractOptions<TSchema extends ZodType> {
  system: string
  user: string
  schema: TSchema
  model?: ClaudeModel
  maxTokens?: number
  temperature?: number
  schemaName?: string
}

export interface CachedExtractResult<T> {
  data: T
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  model: string
}

/**
 * Run a schema-validated extraction with a cached system prompt.
 *
 * Routing:
 *   1. OPENROUTER_API_KEY present  → OpenRouter (proxied to Anthropic).
 *   2. else ANTHROPIC_API_KEY      → Anthropic direct.
 *   3. else                        → throw.
 */
export async function extractWithCache<TSchema extends ZodType>(
  opts: CachedExtractOptions<TSchema>
): Promise<CachedExtractResult<z.infer<TSchema>>> {
  const model = opts.model ?? CLAUDE_MODELS.sonnet

  if (process.env.OPENROUTER_API_KEY) {
    return extractViaOpenRouter(opts, model)
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return extractViaAnthropicDirect(opts, model)
  }
  throw new Error('[prompt-cache] neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY set')
}

// -----------------------------------------------------------------------------
// OpenRouter path
// -----------------------------------------------------------------------------

async function extractViaOpenRouter<TSchema extends ZodType>(
  opts: CachedExtractOptions<TSchema>,
  model: ClaudeModel
): Promise<CachedExtractResult<z.infer<TSchema>>> {
  const apiKey = process.env.OPENROUTER_API_KEY!
  const orModel = OPENROUTER_MODEL_MAP[model] ?? OPENROUTER_MODEL_MAP[CLAUDE_MODELS.sonnet]

  const schemaHint = opts.schemaName ? ` matching schema "${opts.schemaName}"` : ''
  const userWithJsonInstruction =
    `${opts.user}\n\n---\nRespond with valid JSON only${schemaHint}. No markdown, no code fences, no commentary.`

  const body = {
    model: orModel,
    // OpenRouter prokidyvaet Anthropic cache_control on the system message
    // when using anthropic/claude-* slugs — same ~90% discount on repeats.
    messages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: opts.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      { role: 'user', content: userWithJsonInstruction },
    ],
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0,
    response_format: { type: 'json_object' as const },
  }

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.AUTH_URL ?? 'https://aistart360.vercel.app',
      'X-Title': 'AIStart360',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[prompt-cache] OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_tokens_details?: { cached_tokens?: number }
      cache_creation_input_tokens?: number
    }
  }

  const raw = json.choices?.[0]?.message?.content ?? ''
  const stripped = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`[prompt-cache] OpenRouter returned non-JSON (${msg}): ${stripped.slice(0, 200)}`)
  }

  const validated = opts.schema.parse(parsed)

  // OpenRouter usage uses OpenAI-ish shape but also includes cached_tokens
  // in prompt_tokens_details and cache_creation_input_tokens (Anthropic-style)
  const promptTokens = json.usage?.prompt_tokens ?? 0
  const completionTokens = json.usage?.completion_tokens ?? 0
  const cacheRead = json.usage?.prompt_tokens_details?.cached_tokens ?? 0
  const cacheCreation = json.usage?.cache_creation_input_tokens ?? 0
  // Fresh input = prompt_tokens - cached_tokens (no double-counting)
  const freshInput = Math.max(0, promptTokens - cacheRead - cacheCreation)

  return {
    data: validated,
    usage: {
      input_tokens: freshInput,
      output_tokens: completionTokens,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
    },
    model: orModel,
  }
}

// -----------------------------------------------------------------------------
// Anthropic direct fallback (used when OPENROUTER_API_KEY missing)
// -----------------------------------------------------------------------------

async function extractViaAnthropicDirect<TSchema extends ZodType>(
  opts: CachedExtractOptions<TSchema>,
  model: ClaudeModel
): Promise<CachedExtractResult<z.infer<TSchema>>> {
  // Dynamic import so the Anthropic SDK isn't required at runtime when
  // running through OpenRouter.
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const schemaHint = opts.schemaName ? ` matching schema "${opts.schemaName}"` : ''
  const userWithJsonInstruction =
    `${opts.user}\n\n---\nRespond with valid JSON only${schemaHint}. No markdown, no code fences, no commentary.`

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0,
    system: [
      {
        type: 'text',
        text: opts.system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userWithJsonInstruction }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[prompt-cache] Anthropic returned no text block')
  }

  const raw = textBlock.text.trim()
  const stripped = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`[prompt-cache] Anthropic returned non-JSON (${msg}): ${stripped.slice(0, 200)}`)
  }

  const validated = opts.schema.parse(parsed)

  return {
    data: validated,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
    model,
  }
}

// -----------------------------------------------------------------------------
// Cost estimator (prices as of Q2 2026)
// -----------------------------------------------------------------------------

export function estimateCost(usage: CachedExtractResult<unknown>['usage'], model: string): number {
  const prices: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
    'claude-sonnet-4-5':            { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
    'anthropic/claude-sonnet-4.5':  { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
    'claude-haiku-3-5':             { input: 0.8, output: 4.0,  cacheWrite: 1.0,  cacheRead: 0.08 },
    'anthropic/claude-haiku-4.5':   { input: 0.8, output: 4.0,  cacheWrite: 1.0,  cacheRead: 0.08 },
    'claude-opus-4':                { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
    'anthropic/claude-opus-4.1':    { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  }

  const p = prices[model] ?? prices['claude-sonnet-4-5']
  const cost =
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_creation_input_tokens * p.cacheWrite +
      usage.cache_read_input_tokens * p.cacheRead) /
    1_000_000

  return Number(cost.toFixed(4))
}
