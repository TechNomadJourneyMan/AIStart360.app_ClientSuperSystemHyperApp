/**
 * Anthropic prompt-caching wrapper.
 *
 * Why: every extractor ships a long system prompt (industry benchmarks, extraction
 * rules, Zod schema hint). Running 20 extractions of the same type in one batch
 * would otherwise send the system prompt 20× and pay for it. With
 * `cache_control: { type: 'ephemeral' }` on the system block, Anthropic caches it
 * for ~5 minutes on their side and charges ~10% of input tokens on cache hits.
 *
 * AI SDK's `generateObject` does not expose cache_control directly, so we use
 * the raw `@anthropic-ai/sdk` for cached calls and post-validate with Zod.
 *
 * Server-only. Do NOT import from client components.
 *
 * Docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */

import Anthropic from '@anthropic-ai/sdk'
import type { z, ZodType } from 'zod'

import { CLAUDE_MODELS, type ClaudeModel } from './anthropic'

/** Raw client for cache-enabled calls. Throws at use-time if no key. */
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — cannot use prompt cache client')
  }
  return new Anthropic({ apiKey })
}

export interface CachedExtractOptions<TSchema extends ZodType> {
  /** System prompt — will be cached. Should be stable across calls for cache hits. */
  system: string
  /** User message — typically the document text / data to extract from. Not cached. */
  user: string
  /** Zod schema for output validation. */
  schema: TSchema
  /** Optional: override model. Default: Sonnet. */
  model?: ClaudeModel
  /** Optional: max tokens to generate. Default: 4096. */
  maxTokens?: number
  /** Optional: temperature. Default: 0. Deterministic extraction. */
  temperature?: number
  /** Optional: schema name hint for prompt (helps Claude format JSON correctly). */
  schemaName?: string
}

export interface CachedExtractResult<T> {
  /** Parsed + validated result. */
  data: T
  /** Token usage for cost + cache analytics. */
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  /** Model that produced this. */
  model: string
}

/**
 * Run a schema-validated extraction with a cached system prompt.
 *
 * Flow:
 *   1. Send system (cached) + user + instruction to return JSON matching schema.
 *   2. Parse assistant text block as JSON.
 *   3. Validate with Zod. Throw on mismatch (caller wraps in try/catch + logs).
 *
 * Cost: system prompt pays ~1.25× on first call (cache write), ~0.10× on
 * subsequent calls within the 5-minute window.
 */
export async function extractWithCache<TSchema extends ZodType>(
  opts: CachedExtractOptions<TSchema>
): Promise<CachedExtractResult<z.infer<TSchema>>> {
  const client = getClient()
  const model = opts.model ?? CLAUDE_MODELS.sonnet
  const maxTokens = opts.maxTokens ?? 4096
  const temperature = opts.temperature ?? 0

  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: opts.system,
      cache_control: { type: 'ephemeral' },
    },
  ]

  const schemaHint = opts.schemaName ? ` matching schema "${opts.schemaName}"` : ''
  const userWithJsonInstruction =
    `${opts.user}\n\n---\nRespond with valid JSON only${schemaHint}. No markdown, no code fences, no commentary.`

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemBlocks,
    messages: [{ role: 'user', content: userWithJsonInstruction }],
  })

  // Extract text from first text block
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text block')
  }

  // Parse JSON (strip any accidental fences just in case)
  const raw = textBlock.text.trim()
  const stripped = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    const preview = stripped.slice(0, 200)
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Claude returned non-JSON text (${msg}): ${preview}`)
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

/**
 * Estimate cost in USD for a cached extraction.
 * Uses Anthropic public pricing (as of 2025-Q4). Update if pricing changes.
 */
export function estimateCost(usage: CachedExtractResult<unknown>['usage'], model: string): number {
  // Prices per 1M tokens (USD)
  const prices = {
    'claude-sonnet-4-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
    'claude-haiku-3-5':  { input: 0.8, output: 4.0,  cacheWrite: 1.0,  cacheRead: 0.08 },
    'claude-opus-4':     { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  } as const

  const p = prices[model as keyof typeof prices] ?? prices['claude-sonnet-4-5']
  const cost =
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_creation_input_tokens * p.cacheWrite +
      usage.cache_read_input_tokens * p.cacheRead) /
    1_000_000

  return Number(cost.toFixed(4))
}
