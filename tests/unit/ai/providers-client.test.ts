/**
 * OpenAI-compatible client (094) with stubbed fetch: request shape per
 * provider kind, response/usage parsing, error mapping, cost source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildChatBody,
  chatCompletion,
  computeCost,
  createEmbeddings,
  ocrImage,
  rerankAdapter,
  rerankDocuments,
  sanitizeProviderText,
} from '@/lib/ai/providers/client'
import type { ProviderTarget } from '@/lib/ai/providers/types'

const KEY = 'alem-live-key-AbCdEf123456'

function target(over: Partial<ProviderTarget> = {}): ProviderTarget {
  return {
    origin: 'db', providerKey: 'alem', providerName: 'Alem Plus', kind: 'openai_compatible',
    baseUrl: 'https://llm.alem.ai/v1', chatPath: '/chat/completions', embeddingsPath: '/embeddings',
    rerankPath: null, ocrMode: null, extraHeaders: {}, supportsResponseFormat: true,
    model: 'alemllm', modelRowId: 'm1', credentialId: 'c1', apiKey: KEY,
    priceInPerMtok: null, priceOutPerMtok: null, dailyBudgetUsd: null,
    ...over,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const call = (f: ReturnType<typeof vi.fn>, i = 0) => f.mock.calls[i] as unknown as [string, RequestInit]

afterEach(() => {
  delete process.env.AI_PRIVACY_MODE
})

describe('chat', () => {
  it('sends the verified Alem request: POST /v1/chat/completions, Bearer key, {model, messages}', async () => {
    const f = vi.fn(async () => json({
      model: 'alemllm', choices: [{ message: { content: 'Сәлем' } }], usage: { prompt_tokens: 12, completion_tokens: 3 },
    }))
    const r = await chatCompletion(target(), {
      messages: [{ role: 'user', content: 'Привет' }], maxTokens: 50, temperature: 0.2, fetchImpl: f as unknown as typeof fetch,
    })
    expect(r).toEqual({ ok: true, text: 'Сәлем', model: 'alemllm', tokensIn: 12, tokensOut: 3, providerCostUsd: null })
    const [url, init] = call(f)
    expect(url).toBe('https://llm.alem.ai/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ model: 'alemllm', messages: [{ role: 'user', content: 'Привет' }], max_tokens: 50, temperature: 0.2 })
  })

  it('never sends OpenRouter-only fields or headers to other providers', () => {
    const body = buildChatBody(target(), { messages: [], maxTokens: 1, json: true })
    expect(body).not.toHaveProperty('provider')
    expect(body).not.toHaveProperty('usage')
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('OpenRouter keeps privacy routing, usage accounting and require_parameters', () => {
    process.env.AI_PRIVACY_MODE = 'strict'
    const body = buildChatBody(target({ kind: 'openrouter', providerKey: 'openrouter' }), {
      messages: [], maxTokens: 1, jsonSchema: { name: 's', schema: { type: 'object' } },
    })
    expect(body.provider).toEqual({ require_parameters: true, data_collection: 'deny', zdr: true })
    expect(body.usage).toEqual({ include: true })
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 's', strict: true } })
  })

  it('omits response_format for providers that do not support it, and temperature when null', () => {
    const body = buildChatBody(target({ supportsResponseFormat: false }), {
      messages: [], maxTokens: 1, temperature: null, jsonSchema: { name: 's', schema: {} },
    })
    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('temperature')
  })

  it('adds non-secret extra headers but never lets them replace the key', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: 'x' } }] }))
    await chatCompletion(target({ extraHeaders: { 'X-Project': 'aistart', Authorization: 'Bearer evil' } }), {
      messages: [], maxTokens: 1, fetchImpl: f as unknown as typeof fetch,
    })
    const h = call(f)[1].headers as Record<string, string>
    expect(h['X-Project']).toBe('aistart')
    expect(h.Authorization).toBe(`Bearer ${KEY}`)
    expect(h).not.toHaveProperty('HTTP-Referer')
  })

  it('joins text content parts', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }))
    const r = await chatCompletion(target(), { messages: [], maxTokens: 1, fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: true, text: 'ab', model: 'alemllm', tokensIn: null })
  })
})

describe('error mapping', () => {
  const run = (f: unknown) => chatCompletion(target(), { messages: [], maxTokens: 1, fetchImpl: f as typeof fetch })

  it('429 → RATE_LIMITED (retryable), 5xx → PROVIDER_ERROR (retryable), 4xx → PROVIDER_ERROR (final)', async () => {
    expect(await run(vi.fn(async () => new Response('slow down', { status: 429 })))).toMatchObject({ ok: false, code: 'RATE_LIMITED', retryable: true, status: 429 })
    expect(await run(vi.fn(async () => new Response('', { status: 503 })))).toMatchObject({ ok: false, code: 'PROVIDER_ERROR', retryable: true, message: 'HTTP 503' })
    expect(await run(vi.fn(async () => new Response('bad', { status: 400 })))).toMatchObject({ ok: false, code: 'PROVIDER_ERROR', retryable: false, message: 'HTTP 400' })
  })

  it('timeouts and network errors', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' })
    expect(await run(vi.fn(async () => { throw timeout }))).toMatchObject({ ok: false, code: 'TIMEOUT', retryable: true, status: null })
    expect(await run(vi.fn(async () => { throw new TypeError('fetch failed') }))).toMatchObject({ ok: false, code: 'PROVIDER_ERROR', message: 'сетевая ошибка' })
  })

  it('error details never contain the key', async () => {
    const r = await run(vi.fn(async () => new Response(`{"error":"invalid api key ${KEY}","auth":"Bearer ${KEY}"}`, { status: 401 })))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toContain('invalid api key')
    expect(r.detail).not.toContain(KEY)
    expect(JSON.stringify(r)).not.toContain(KEY)
  })

  it('sanitizer redacts bearer tokens and long key-like strings', () => {
    const s = sanitizeProviderText('Bearer abc.def-123 and sk-or-v1-0123456789abcdef and ' + 'x'.repeat(40))
    expect(s).not.toMatch(/abc\.def|0123456789abcdef|x{40}/)
  })
})

describe('embeddings, rerank, OCR', () => {
  it('embeddings: OpenAI shape in and out; dimensions only when asked', async () => {
    const f = vi.fn(async () => json({ model: 'emb', data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }], usage: { prompt_tokens: 7, total_tokens: 7 } }))
    const r = await createEmbeddings(target({ model: 'emb' }), { input: ['a', 'b'], fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: true, vectors: [[0.1, 0.2], [0.3, 0.4]], tokensIn: 7, model: 'emb' })
    expect(call(f)[0]).toBe('https://llm.alem.ai/v1/embeddings')
    expect(JSON.parse(call(f)[1].body as string)).toEqual({ model: 'emb', input: ['a', 'b'] })
  })

  it('rerank adapter (ASSUMED Cohere/Jina style) maps request and the known response variants', async () => {
    expect(rerankAdapter.request('r', 'q', ['a', 'b'], 1)).toEqual({ model: 'r', query: 'q', documents: ['a', 'b'], top_n: 1 })
    expect(rerankAdapter.response({ results: [{ index: 1, relevance_score: 0.2 }, { index: 0, relevance_score: 0.9 }] }))
      .toEqual([{ index: 0, score: 0.9 }, { index: 1, score: 0.2 }])
    expect(rerankAdapter.response({ data: [{ index: 0, score: 0.5 }] })).toEqual([{ index: 0, score: 0.5 }])
    expect(rerankAdapter.response([{ index: 0, score: 0.5 }])).toEqual([{ index: 0, score: 0.5 }])
    expect(rerankAdapter.response({ nope: true })).toBeNull()

    const f = vi.fn(async () => json({ results: [{ index: 0, relevance_score: 0.7 }] }))
    const r = await rerankDocuments(target({ rerankPath: '/rerank', model: 'rr' }), { query: 'q', documents: ['d'], fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: true, results: [{ index: 0, score: 0.7 }] })
    expect(call(f)[0]).toBe('https://llm.alem.ai/v1/rerank')
    expect(await rerankDocuments(target(), { query: 'q', documents: [] })).toMatchObject({ ok: false })
  })

  it('OCR (ASSUMED chat_vision) sends an image_url content part', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: 'ТЕКСТ' } }] }))
    const r = await ocrImage(target({ ocrMode: 'chat_vision', model: 'ocr' }), { imageUrl: 'data:image/png;base64,AAAA', fetchImpl: f as unknown as typeof fetch })
    expect(r).toMatchObject({ ok: true, text: 'ТЕКСТ' })
    const body = JSON.parse(call(f)[1].body as string)
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
    expect(await ocrImage(target(), { imageUrl: 'x' })).toMatchObject({ ok: false })
  })
})

describe('computeCost', () => {
  const base = { tokensIn: 1_000_000, tokensOut: 1_000_000, priceInPerMtok: null, priceOutPerMtok: null }
  it('provider cost first, then model prices, then estimate', () => {
    expect(computeCost({ ...base, providerCostUsd: 0.01, priceInPerMtok: 1, priceOutPerMtok: 1 })).toEqual({ costUsd: 0.01, costSource: 'provider' })
    expect(computeCost({ ...base, providerCostUsd: null, priceInPerMtok: 0.5, priceOutPerMtok: 1.5 })).toEqual({ costUsd: 2, costSource: 'model_price' })
    expect(computeCost({ ...base, providerCostUsd: null, estimatePrices: { in: 1, out: 5 } })).toEqual({ costUsd: 6, costSource: 'estimate' })
    expect(computeCost({ ...base, providerCostUsd: null })).toEqual({ costUsd: 0, costSource: 'estimate' })
  })
})
