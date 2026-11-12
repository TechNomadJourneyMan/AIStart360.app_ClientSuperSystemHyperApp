import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const openRouter = vi.hoisted(() => ({
  chat: vi.fn(),
}))

vi.mock('@/lib/ai/openrouter', () => ({
  chatWithOpenRouter: openRouter.chat,
  extractJson: (value: string) => {
    try { return JSON.parse(value) } catch { return null }
  },
  hasOpenRouterKey: () => true,
}))

import { generateObjectViaOpenRouter, hasOpenRouterKey, MAX_STRUCTURED_TOKENS } from '@/lib/ai/structured'

describe('provider-enforced structured output', () => {
  beforeEach(() => {
    openRouter.chat.mockReset()
    delete process.env.JOURNEY_FORCE_DEMO
  })

  it('forces the explicit demo provider only outside production', () => {
    process.env.JOURNEY_FORCE_DEMO = '1'
    expect(hasOpenRouterKey()).toBe(false)
  })

  it('passes a strict JSON Schema to OpenRouter while keeping local Zod validation', async () => {
    const schema = z.object({
      phase: z.enum(['partial', 'ready']),
      assistantMessage: z.string(),
      suggestions: z.array(z.string().max(40)).max(4),
    }).strict()
    openRouter.chat.mockResolvedValue(JSON.stringify({
      phase: 'partial',
      assistantMessage: 'Готово',
      suggestions: [],
    }))

    const result = await generateObjectViaOpenRouter({
      feature: 'journey',
      system: 'system',
      user: 'user',
      schema,
      label: 'journey-orchestrator',
      strictJsonSchema: true,
    })

    expect(result).toEqual({ phase: 'partial', assistantMessage: 'Готово', suggestions: [] })
    expect(openRouter.chat).toHaveBeenCalledWith(expect.objectContaining({
      jsonMode: false,
      jsonSchema: expect.objectContaining({
        name: 'journey-orchestrator',
        strict: true,
        schema: expect.objectContaining({
          type: 'object',
          additionalProperties: false,
          required: ['phase', 'assistantMessage', 'suggestions'],
        }),
      }),
    }))
    expect(JSON.stringify(openRouter.chat.mock.calls[0][0].jsonSchema.schema)).not.toMatch(
      /maxItems|maxLength/,
    )
  })

  it('retries with the schema in JSON mode when a provider rejects native enforcement', async () => {
    const schema = z.object({ phase: z.enum(['partial', 'ready']) }).strict()
    openRouter.chat
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify({ phase: 'partial' }))

    await expect(generateObjectViaOpenRouter({
      feature: 'journey',
      system: 'system',
      user: 'user',
      schema,
      strictJsonSchema: true,
    })).resolves.toEqual({ phase: 'partial' })

    expect(openRouter.chat).toHaveBeenCalledTimes(2)
    expect(openRouter.chat.mock.calls[1][0]).toEqual(expect.objectContaining({
      jsonMode: true,
      jsonSchema: undefined,
      user: expect.stringContaining('OUTPUT_JSON_SCHEMA'),
    }))
  })

  it('can use schema-guided JSON mode immediately for provider grammar limits', async () => {
    const schema = z.object({ phase: z.enum(['partial', 'ready']) }).strict()
    openRouter.chat.mockResolvedValueOnce(JSON.stringify({ phase: 'partial' }))

    await generateObjectViaOpenRouter({
      feature: 'journey',
      system: 'system',
      user: 'user',
      schema,
      strictJsonSchema: 'prompt',
    })

    expect(openRouter.chat.mock.calls[0][0]).toEqual(expect.objectContaining({
      jsonMode: true,
      jsonSchema: undefined,
      user: expect.stringContaining('OUTPUT_JSON_SCHEMA'),
    }))
  })

  it('feeds validation errors into the retry and normalizes optional nulls only', async () => {
    const schema = z.object({
      label: z.string(),
      optionalValue: z.string().optional(),
      score: z.number().nullable(),
    }).strict()
    openRouter.chat
      .mockResolvedValueOnce(JSON.stringify({ label: 7, optionalValue: null, score: null }))
      .mockResolvedValueOnce(JSON.stringify({ label: 'Исправлено', optionalValue: null, score: null }))

    await expect(generateObjectViaOpenRouter({
      feature: 'journey',
      system: 'system',
      user: 'user',
      schema,
      strictJsonSchema: 'prompt',
      normalizeOptionalNulls: { preserveKeys: ['score'] },
    })).resolves.toEqual({ label: 'Исправлено', score: null })

    expect(openRouter.chat.mock.calls[1][0].user).toContain('Expected string, received number')
  })

  it('applies server-owned candidate normalization before Zod validation', async () => {
    const schema = z.object({ value: z.string() }).strict()
    openRouter.chat.mockResolvedValueOnce(JSON.stringify({ value: 7 }))

    await expect(generateObjectViaOpenRouter({
      feature: 'journey',
      system: 'system',
      user: 'user',
      schema,
      normalizeCandidate: (candidate) => ({
        ...(candidate as Record<string, unknown>),
        value: 'server-owned',
      }),
    })).resolves.toEqual({ value: 'server-owned' })
  })
})

describe('retry one tier up after a broken answer', () => {
  const schema = z.object({ title: z.string() }).strict()
  const base = { feature: 'point_a_analysis' as const, system: 'system', user: 'user', schema }
  const complexities = () => openRouter.chat.mock.calls.map((c) => c[0].complexity)

  beforeEach(() => {
    openRouter.chat.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('schema-invalid answer: medium (light tier) → high (standard)', async () => {
    openRouter.chat
      .mockResolvedValueOnce(JSON.stringify({ title: 7 }))
      .mockResolvedValueOnce(JSON.stringify({ title: 'ok' }))
    await expect(generateObjectViaOpenRouter({ ...base, complexity: 'medium' })).resolves.toEqual({ title: 'ok' })
    expect(complexities()).toEqual(['medium', 'high'])
  })

  it('not JSON: low → high', async () => {
    openRouter.chat.mockResolvedValueOnce('null').mockResolvedValueOnce(JSON.stringify({ title: 'ok' }))
    await generateObjectViaOpenRouter({ ...base, complexity: 'low' })
    expect(complexities()).toEqual(['low', 'high'])
  })

  it('auto complexity of a short call (low) escalates too', async () => {
    openRouter.chat.mockResolvedValueOnce('null').mockResolvedValueOnce(JSON.stringify({ title: 'ok' }))
    await generateObjectViaOpenRouter({ ...base, maxTokens: 400 })
    expect(complexities()).toEqual([undefined, 'high'])
  })

  it('high and max stay; an explicit model is never escalated', async () => {
    for (const complexity of ['high', 'max'] as const) {
      openRouter.chat.mockReset()
      openRouter.chat.mockResolvedValue('null')
      await generateObjectViaOpenRouter({ ...base, complexity })
      expect(complexities()).toEqual([complexity, complexity])
    }
    openRouter.chat.mockReset()
    openRouter.chat.mockResolvedValue('null')
    await generateObjectViaOpenRouter({ ...base, complexity: 'low', model: 'AlemLLM' })
    expect(openRouter.chat.mock.calls.map((c) => [c[0].model, c[0].complexity])).toEqual([['AlemLLM', 'low'], ['AlemLLM', 'low']])
  })

  it('a failed call (no answer) is retried on the same tier — failover already tried the others', async () => {
    openRouter.chat.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({ title: 'ok' }))
    await generateObjectViaOpenRouter({ ...base, complexity: 'medium' })
    expect(complexities()).toEqual(['medium', 'medium'])

    // A broken last answer announces no retry that will not happen.
    openRouter.chat.mockReset()
    openRouter.chat.mockResolvedValueOnce(null).mockResolvedValueOnce('null')
    expect(await generateObjectViaOpenRouter({ ...base, complexity: 'medium' })).toBeNull()
    expect(vi.mocked(console.warn)).not.toHaveBeenCalledWith(expect.stringContaining('one tier up'))
  })
})

describe('an answer cut at the token limit gets a bigger budget', () => {
  const schema = z.object({ title: z.string() }).strict()
  const base = { feature: 'point_a_analysis' as const, label: 'point-a:blocksA', system: 'system', user: 'user', schema }
  const budgets = () => openRouter.chat.mock.calls.map((c) => c[0].maxTokens)
  /** One answer of the mocked chat layer; the finish reason reaches structured.ts through `onFinish`. */
  const answer = (text: string, finishReason?: string) =>
    async (opts: { onFinish?: (info: { finishReason?: string }) => void }) => {
      opts.onFinish?.({ finishReason })
      return text
    }

  beforeEach(() => {
    openRouter.chat.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('finish_reason "length": the next attempt doubles the budget and its valid JSON is returned', async () => {
    openRouter.chat
      .mockImplementationOnce(answer('{"title":"Финансы компании растут, но маржа', 'length'))
      .mockImplementationOnce(answer('{"title":"Финансы"}', 'stop'))
    await expect(generateObjectViaOpenRouter({ ...base, complexity: 'medium', maxTokens: 2000 }))
      .resolves.toEqual({ title: 'Финансы' })
    expect(budgets()).toEqual([2000, 4000])
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      '[point-a:blocksA] attempt 1: answer cut at the token limit, retrying with maxTokens=4000',
    )
    // the «one tier up» rule is unchanged
    expect(openRouter.chat.mock.calls.map((c) => c[0].complexity)).toEqual(['medium', 'high'])
  })

  it('the budget never exceeds MAX_STRUCTURED_TOKENS', async () => {
    expect(MAX_STRUCTURED_TOKENS).toBe(8000)
    openRouter.chat
      .mockImplementationOnce(answer('{"title":"обрезано', 'length'))
      .mockImplementationOnce(answer('{"title":"ok"}', 'stop'))
    await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 6000 })
    expect(budgets()).toEqual([6000, 8000])
  })

  it('a valid first answer makes exactly one call', async () => {
    openRouter.chat.mockImplementationOnce(answer('{"title":"ok"}', 'length'))
    await expect(generateObjectViaOpenRouter({ ...base, maxTokens: 2000 })).resolves.toEqual({ title: 'ok' })
    expect(openRouter.chat).toHaveBeenCalledTimes(1)
  })

  it('an invalid but complete answer keeps the budget', async () => {
    // the provider says it stopped on its own
    openRouter.chat
      .mockImplementationOnce(answer('{"title": "x",}', 'stop'))
      .mockImplementationOnce(answer('{"title":"ok"}', 'stop'))
    await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 2000 })
    expect(budgets()).toEqual([2000, 2000])

    // no finish reason, but the text closes its object or array (also inside a code fence)
    for (const text of ['{"title": "x",}', '```json\n{"title": "x",}\n```', 'Вот ответ: [1, 2,]']) {
      openRouter.chat.mockReset()
      openRouter.chat
        .mockImplementationOnce(answer(text))
        .mockImplementationOnce(answer('{"title":"ok"}'))
      await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 2000 })
      expect(budgets()).toEqual([2000, 2000])
    }

    // valid JSON that fails the schema is not a cut answer either
    openRouter.chat.mockReset()
    openRouter.chat
      .mockImplementationOnce(answer('{"title":7}', 'length'))
      .mockImplementationOnce(answer('{"title":"ok"}'))
    await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 2000 })
    expect(budgets()).toEqual([2000, 2000])
    expect(vi.mocked(console.warn)).not.toHaveBeenCalledWith(expect.stringContaining('cut at the token limit'))
  })

  it('no finish reason: an unclosed text counts as cut (code fences stripped)', async () => {
    openRouter.chat
      .mockImplementationOnce(answer('```json\n{"title":"Финансы компании'))
      .mockImplementationOnce(answer('{"title":"ok"}'))
    await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 1500 })
    expect(budgets()).toEqual([1500, 3000])
  })

  it('a budget above the cap is never lowered', async () => {
    openRouter.chat
      .mockImplementationOnce(answer('{"title":"обрезано', 'length'))
      .mockImplementationOnce(answer('{"title":"ok"}'))
    await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 10_000 })
    expect(budgets()).toEqual([10_000, 10_000])
  })

  it('a cut last answer announces no retry that will not happen', async () => {
    openRouter.chat
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(answer('{"title":"обрезано', 'length'))
    expect(await generateObjectViaOpenRouter({ ...base, complexity: 'high', maxTokens: 2000 })).toBeNull()
    expect(vi.mocked(console.warn)).not.toHaveBeenCalledWith(expect.stringContaining('cut at the token limit'))
  })
})
