import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { generateObjectViaOpenRouter } from '@/lib/ai/structured'

const originalApiKey = process.env.OPENROUTER_API_KEY

describe('structured OpenRouter options', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalApiKey
  })

  it('preserves the null temperature sentinel for Sonnet 5', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateObjectViaOpenRouter({
      label: 'omnichannel:test',
      model: OPENROUTER_MODELS.sonnet5,
      temperature: null,
      system: 'test system',
      user: 'test user',
      maxTokens: 100,
      schema: z.object({ answer: z.string() }),
    })).resolves.toEqual({ answer: 'ok' })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    expect(body.model).toBe(OPENROUTER_MODELS.sonnet5)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body).not.toHaveProperty('temperature')
  })
})
