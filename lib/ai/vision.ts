/**
 * Vision/PDF extractor wrapper — routes via OpenRouter when available,
 * falls back to Anthropic direct.
 *
 * Used by brand-guide (PDF → Opus) and financial-pdf scanned-mode.
 *
 * For PDFs we use the Anthropic document block format. OpenRouter accepts
 * this natively for `anthropic/claude-*` slugs (proxies through to Claude).
 *
 * Server-only.
 */

import type { z, ZodType } from 'zod'

import { CLAUDE_MODELS, type ClaudeModel } from './anthropic'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const OPENROUTER_MODEL_MAP: Record<ClaudeModel, string> = {
  [CLAUDE_MODELS.haiku]: 'anthropic/claude-haiku-4.5',
  [CLAUDE_MODELS.sonnet]: 'anthropic/claude-sonnet-4.5',
  [CLAUDE_MODELS.opus]: 'anthropic/claude-opus-4.1',
}

export interface VisionExtractOptions<TSchema extends ZodType> {
  system: string
  instruction: string
  bytes: Buffer
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  schema: TSchema
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

export async function extractWithVision<TSchema extends ZodType>(
  opts: VisionExtractOptions<TSchema>
): Promise<VisionExtractResult<z.infer<TSchema>>> {
  const model = opts.model ?? CLAUDE_MODELS.opus

  if (process.env.OPENROUTER_API_KEY) {
    return visionViaOpenRouter(opts, model)
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return visionViaAnthropicDirect(opts, model)
  }
  throw new Error('[vision] neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY set')
}

// -----------------------------------------------------------------------------
// OpenRouter path
// -----------------------------------------------------------------------------

async function visionViaOpenRouter<TSchema extends ZodType>(
  opts: VisionExtractOptions<TSchema>,
  model: ClaudeModel
): Promise<VisionExtractResult<z.infer<TSchema>>> {
  const apiKey = process.env.OPENROUTER_API_KEY!
  const orModel = OPENROUTER_MODEL_MAP[model] ?? OPENROUTER_MODEL_MAP[CLAUDE_MODELS.opus]
  const base64 = opts.bytes.toString('base64')
  const isPdf = opts.mediaType === 'application/pdf'

  const schemaHint = opts.schemaName ? ` matching schema "${opts.schemaName}"` : ''
  const userText = `${opts.instruction}\n\n---\nRespond with valid JSON only${schemaHint}. No markdown, no code fences, no commentary.`

  // Anthropic-native content block — OpenRouter proxies through for anthropic/*
  const attachment = isPdf
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
          media_type: opts.mediaType,
          data: base64,
        },
      }

  const body = {
    model: orModel,
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
      {
        role: 'user',
        content: [attachment, { type: 'text', text: userText }],
      },
    ],
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0,
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
    throw new Error(`[vision] OpenRouter ${res.status}: ${text.slice(0, 300)}`)
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
    throw new Error(`[vision] OpenRouter returned non-JSON (${msg}): ${stripped.slice(0, 200)}`)
  }

  const validated = opts.schema.parse(parsed)

  const promptTokens = json.usage?.prompt_tokens ?? 0
  const completionTokens = json.usage?.completion_tokens ?? 0
  const cacheRead = json.usage?.prompt_tokens_details?.cached_tokens ?? 0
  const cacheCreation = json.usage?.cache_creation_input_tokens ?? 0
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
// Anthropic direct fallback
// -----------------------------------------------------------------------------

async function visionViaAnthropicDirect<TSchema extends ZodType>(
  opts: VisionExtractOptions<TSchema>,
  model: ClaudeModel
): Promise<VisionExtractResult<z.infer<TSchema>>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const base64 = opts.bytes.toString('base64')
  const isPdf = opts.mediaType === 'application/pdf'

  const schemaHint = opts.schemaName ? ` matching schema "${opts.schemaName}"` : ''
  const userText = `${opts.instruction}\n\n---\nRespond with valid JSON only${schemaHint}. No markdown, no code fences, no commentary.`

  const attachment = isPdf
    ? {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: base64,
        },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: opts.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data: base64,
        },
      }

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
    messages: [
      {
        role: 'user',
        content: [attachment, { type: 'text', text: userText }],
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[vision] Anthropic returned no text block')
  }

  const raw = textBlock.text.trim()
  const stripped = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`[vision] Anthropic returned non-JSON (${msg}): ${stripped.slice(0, 200)}`)
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
