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
      feature: 'omnichannel',
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

  describe('the provider finish reason reaches the structured retry', () => {
    // Ends with `}` but is not valid JSON: only the finish reason tells a cut answer apart.
    const CUT = '{"items":[{"t":"Финансы"},{"t":"Продажи"}'
    const reply = (content: string, finish_reason?: string) => new Response(JSON.stringify({
      choices: [{ message: { content }, ...(finish_reason ? { finish_reason } : {}) }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const maxTokensOf = (f: ReturnType<typeof vi.fn>) =>
      f.mock.calls.map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as { max_tokens: number }).max_tokens)
    const run = () => generateObjectViaOpenRouter({
      feature: 'point_a_analysis', label: 'point-a:blocksA', complexity: 'medium', maxTokens: 2000,
      system: 's', user: 'u', schema: z.object({ items: z.array(z.object({ t: z.string() })) }),
    })

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })
    afterEach(() => vi.restoreAllMocks())

    it('finish_reason "length" → the second request asks for twice the tokens', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(reply(CUT, 'length'))
        .mockResolvedValueOnce(reply('{"items":[{"t":"Финансы"}]}', 'stop'))
      vi.stubGlobal('fetch', fetchMock)
      await expect(run()).resolves.toEqual({ items: [{ t: 'Финансы' }] })
      expect(maxTokensOf(fetchMock)).toEqual([2000, 4000])
    })

    it('finish_reason "stop" → the same budget', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(reply(CUT, 'stop'))
        .mockResolvedValueOnce(reply('{"items":[]}', 'stop'))
      vi.stubGlobal('fetch', fetchMock)
      await run()
      expect(maxTokensOf(fetchMock)).toEqual([2000, 2000])
    })
  })
})
