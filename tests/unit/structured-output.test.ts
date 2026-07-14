import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const openRouter = vi.hoisted(() => ({
  chat: vi.fn(),
}))

vi.mock('@/lib/ai/openrouter', () => ({
  chatWithOpenRouter: openRouter.chat,
  extractJson: (value: string) => JSON.parse(value),
  hasOpenRouterKey: () => true,
}))

import { generateObjectViaOpenRouter, hasOpenRouterKey } from '@/lib/ai/structured'

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
