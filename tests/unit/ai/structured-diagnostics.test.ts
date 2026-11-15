/**
 * R3-PA (П1а): a structured call reports WHY it returned null — the reason
 * the Point A analysis writes to diagnostics.ai_error (schema / cut /
 * not_json / http_<n> / timeout …) and the model that answered. Before, every
 * failure was the same silent null. Also: a reasoning model's «<think>»
 * block no longer breaks the JSON of its answer (light tier, Qwen3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { generateObjectViaOpenRouter, type StructuredDiagnostics } from '@/lib/ai/structured'
import { extractJson, stripThinking } from '@/lib/ai/openrouter'

const originalApiKey = process.env.OPENROUTER_API_KEY
const reply = (content: string, opts: { finish?: string; model?: string } = {}) => new Response(JSON.stringify({
  model: opts.model ?? 'anthropic/claude-haiku-4.5',
  choices: [{ message: { content }, ...(opts.finish ? { finish_reason: opts.finish } : {}) }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } })

async function run(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  const seen: StructuredDiagnostics[] = []
  const out = await generateObjectViaOpenRouter({
    feature: 'point_a_analysis', label: 'point-a:summary', model: 'anthropic/claude-haiku-4.5', maxTokens: 500,
    system: 's', user: 'u', schema: z.object({ executive_summary: z.string() }),
    onDiagnostics: (d) => seen.push(d),
  })
  return { out, seen }
}

describe('generateObjectViaOpenRouter — onDiagnostics', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalApiKey
  })

  it('ok → reported once with the model that answered', async () => {
    const { out, seen } = await run(vi.fn().mockResolvedValue(reply('{"executive_summary":"ok"}', { model: 'qwen3-8' })))
    expect(out).toEqual({ executive_summary: 'ok' })
    expect(seen).toEqual([{ ok: true, failure: null, model: 'qwen3-8', attempts: 1 }])
  })

  it('JSON that fails the schema twice → «schema»', async () => {
    const { out, seen } = await run(vi.fn().mockImplementation(async () => reply('{"wrong":1}')))
    expect(out).toBeNull()
    expect(seen).toEqual([{ ok: false, failure: 'schema', model: 'anthropic/claude-haiku-4.5', attempts: 2 }])
  })

  it('cut at the token limit twice → «cut»; prose → «not_json»', async () => {
    expect((await run(vi.fn().mockImplementation(async () => reply('{"executive_summary":"обре', { finish: 'length' })))).seen[0]).toMatchObject({ ok: false, failure: 'cut' })
    expect((await run(vi.fn().mockImplementation(async () => reply('Извините, не могу.', { finish: 'stop' })))).seen[0]).toMatchObject({ ok: false, failure: 'not_json' })
  })

  it('the provider refused (HTTP) → «http_<status>»', async () => {
    const { out, seen } = await run(vi.fn().mockImplementation(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })))
    expect(out).toBeNull()
    expect(seen[0]).toMatchObject({ ok: false, failure: 'http_401' })
  })

  it('no key → «no_key», no request', async () => {
    delete process.env.OPENROUTER_API_KEY
    const f = vi.fn()
    const { seen } = await run(f)
    expect(f).not.toHaveBeenCalled()
    expect(seen[0]).toMatchObject({ ok: false, failure: 'no_key' })
  })

  it('a reasoning model\'s <think> block before the answer: the answer is parsed', async () => {
    const { out, seen } = await run(vi.fn().mockResolvedValue(reply('<think>черновик {"executive_summary": 1} проверю</think>\n{"executive_summary":"готово"}', { model: 'qwen3-8' })))
    expect(out).toEqual({ executive_summary: 'готово' })
    expect(seen[0]).toMatchObject({ ok: true, model: 'qwen3-8' })
  })
})

describe('extractJson / stripThinking', () => {
  it('drops a leading think block; an unclosed one leaves nothing; plain JSON untouched', () => {
    expect(extractJson('<think>{"a":1}</think>{"b":2}')).toEqual({ b: 2 })
    expect(stripThinking('<think>долго думаю {"a":')).toBe('')
    expect(extractJson('{"text":"<think> внутри значения"}')).toEqual({ text: '<think> внутри значения' })
  })
})
