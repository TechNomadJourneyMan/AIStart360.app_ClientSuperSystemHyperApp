/**
 * Claude Vision helper — sends a PDF (or image) + system prompt + Zod
 * schema to Claude Opus and returns the validated structured output.
 *
 * Anthropic API supports a `document` content block with base64-encoded
 * PDFs (up to 32 MB, 100 pages). Claude internally rasterizes pages and
 * reads both text and visuals, so we don't need external PDF-to-image.
 *
 * Cost (Opus Apr 2026):
 *   - Input tokens: $15 / 1M
 *   - Output tokens: $75 / 1M
 *   - PDFs roughly count as: (text tokens) + (1500 * page count)
 *
 * Use sparingly — default to Sonnet text-mode when possible.
 *
 * Server-only.
 *
 * Docs: https://docs.anthropic.com/en/docs/build-with-claude/pdf-support
 */

import Anthropic from '@anthropic-ai/sdk'
import type { z, ZodType } from 'zod'

import { CLAUDE_MODELS, type ClaudeModel } from './anthropic'

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey })
}

export interface VisionExtractOptions<TSchema extends ZodType> {
  /** System prompt — cached on repeat calls. */
  system: string
  /** User instruction that accompanies the document. */
  instruction: string
  /** Raw PDF bytes or image bytes. */
  bytes: Buffer
  /** Media type. PDFs: 'application/pdf'. Images: 'image/png'|'image/jpeg'|'image/webp'|'image/gif'. */
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  schema: TSchema
  /** Default: Opus (best vision). Override to Sonnet for text-heavy PDFs. */
  model?: ClaudeModel
  maxTokens?: number
  temperature?: number
  schemaName?: string
}

export interface VisionExtractResult<T> {
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
 * Extract structured data from a PDF/image using Claude Vision.
 * Throws on parse failure or schema validation mismatch.
 */
export async function extractWithVision<TSchema extends ZodType>(
  opts: VisionExtractOptions<TSchema>
): Promise<VisionExtractResult<z.infer<TSchema>>> {
  const client = getClient()
  const model = opts.model ?? CLAUDE_MODELS.opus
  const maxTokens = opts.maxTokens ?? 4096
  const temperature = opts.temperature ?? 0

  // Anthropic requires base64 for document/image blocks
  const base64 = opts.bytes.toString('base64')

  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: opts.system,
      cache_control: { type: 'ephemeral' },
    },
  ]

  const schemaHint = opts.schemaName ? ` matching schema "${opts.schemaName}"` : ''
  const userText = `${opts.instruction}\n\n---\nRespond with valid JSON only${schemaHint}. No markdown, no code fences, no commentary.`

  const isPdf = opts.mediaType === 'application/pdf'

  const userContent: Anthropic.Messages.ContentBlockParam[] = [
    isPdf
      ? {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64,
          },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: opts.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
            data: base64,
          },
        },
    { type: 'text', text: userText },
  ]

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Vision: no text block returned')
  }

  const raw = textBlock.text.trim()
  const stripped = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Vision returned non-JSON (${msg}): ${stripped.slice(0, 200)}`)
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
