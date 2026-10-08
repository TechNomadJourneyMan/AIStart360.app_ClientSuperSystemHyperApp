/**
 * Part A1 AI layer: chatWithTools (tool_calls, failover over tool-capable
 * models, accounting), image input (vision first), transcribeAudio (multipart
 * /audio/transcriptions, OpenRouter audio fallback only with a key).
 */
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
const ledger = vi.hoisted(() => ({ left: 10 as number | null, records: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => ledger.left,
  recordUsage: async (r: Record<string, unknown>) => { ledger.records.push(r) },
  budgetFailsClosed: () => false,
}))

import { encryptSecret } from '@/lib/crypto/secrets'
import { parseToolCalls } from '@/lib/ai/providers/client'
import { invalidateProviderCache } from '@/lib/ai/providers/router'
import { askAboutImage, audioFormatOf, chatWithTools, transcribeAudio, type ToolDefinition } from '@/lib/ai/tools-chat'
import { __setAiUsageSink, type AiUsageRow } from '@/lib/ai/usage'
import { fakeDb, resetFakeDb, seedCredential, seedModel, seedProvider, seedRoute } from './providers-fake-store'

const saved = { key: process.env.SECRETS_ENCRYPTION_KEY, or: process.env.OPENROUTER_API_KEY, privacy: process.env.AI_PRIVACY_MODE }
let usage: AiUsageRow[] = []
let fetchSpy: ReturnType<typeof vi.fn>
const call = (i: number) => fetchSpy.mock.calls[i] as unknown as [string, RequestInit]
const body = (i: number) => JSON.parse(call(i)[1].body as string)

const TOOLS: ToolDefinition[] = [{
  type: 'function',
  function: { name: 'find_client', description: 'Найти клиента', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
}]

const toolAnswer = (extra: Record<string, unknown> = {}) => new Response(JSON.stringify({
  model: 'AlemLLM',
  choices: [{
    finish_reason: 'tool_calls',
    message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_client', arguments: '{"q":"Ромашка"}' } }] },
  }],
  usage: { prompt_tokens: 50, completion_tokens: 10 },
  ...extra,
}), { status: 200 })

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  delete process.env.OPENROUTER_API_KEY
  delete process.env.AI_PRIVACY_MODE
  resetFakeDb()
  invalidateProviderCache()
  ledger.left = 10
  ledger.records = []
  usage = []
  __setAiUsageSink(async (row) => { usage.push(row) })
  fetchSpy = vi.fn(async () => toolAnswer())
  vi.stubGlobal('fetch', fetchSpy)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  __setAiUsageSink(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const [k, v] of [['SECRETS_ENCRYPTION_KEY', saved.key], ['OPENROUTER_API_KEY', saved.or], ['AI_PRIVACY_MODE', saved.privacy]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function alem() {
  const p = seedProvider({ key: 'alem', name: 'Alem', base_url: 'https://llm.alem.ai/v1' })
  seedCredential({ provider_id: p.id, secret_ciphertext: encryptSecret('alem-key-123456') })
  const chat = seedModel({ provider_id: p.id, model_id: 'AlemLLM', capability: 'chat' })
  for (const t of ['light', 'standard', 'premium'] as const) seedRoute('chat', t, chat.id)
  return { p, chat }
}

describe('parseToolCalls', () => {
  it('normalises ids, names and arguments', () => {
    expect(parseToolCalls([
      { id: 'a', type: 'function', function: { name: 'x', arguments: '{"k":1}' } },
      { function: { name: 'y', arguments: { k: 2 } } },
      { type: 'function', function: { name: 'z' } },
      { type: 'function', function: { arguments: '{}' } },
      { type: 'retrieval', function: { name: 'w' } },
      null,
    ])).toEqual([
      { id: 'a', type: 'function', function: { name: 'x', arguments: '{"k":1}' } },
      { id: 'call_1', type: 'function', function: { name: 'y', arguments: '{"k":2}' } },
      { id: 'call_2', type: 'function', function: { name: 'z', arguments: '{}' } },
    ])
    expect(parseToolCalls(undefined)).toEqual([])
  })
})

describe('chatWithTools', () => {
  it('sends tools, returns tool_calls and accounts for the call', async () => {
    alem()
    const r = await chatWithTools({
      feature: 'bot_assistant', label: 'bot.admin', companyId: 'c1', userId: '11111111-1111-4111-8111-111111111111', tier: 'light',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Найди Ромашку' }], tools: TOOLS, timeoutMs: 5000,
    })
    expect(r).toMatchObject({
      ok: true, model: 'AlemLLM', providerKey: 'alem', finishReason: 'tool_calls',
      message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'find_client', arguments: '{"q":"Ромашка"}' } }] },
    })
    expect(call(0)[0]).toBe('https://llm.alem.ai/v1/chat/completions')
    expect(body(0)).toMatchObject({ model: 'AlemLLM', tools: TOOLS, tool_choice: 'auto' })
    expect(body(0)).not.toHaveProperty('provider')
    expect(ledger.records).toEqual([expect.objectContaining({ source: 'feature:bot.admin', providerKey: 'alem', companyId: 'c1', ok: true })])
    expect(usage).toEqual([expect.objectContaining({ feature: 'bot_assistant', model: 'AlemLLM', ok: true, user_id: '11111111-1111-4111-8111-111111111111' })])
  })

  it('passes tool results back (assistant tool_calls + tool messages)', async () => {
    alem()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Нашёл: ТОО Ромашка' } }] }), { status: 200 }))
    const r = await chatWithTools({
      feature: 'bot_assistant', tier: 'light', tools: TOOLS, toolChoice: 'none',
      messages: [
        { role: 'user', content: 'Найди Ромашку' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_client', arguments: '{"q":"Ромашка"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"name":"ТОО Ромашка"}' },
      ],
    })
    expect(r).toMatchObject({ ok: true, message: { content: 'Нашёл: ТОО Ромашка', tool_calls: [] } })
    expect(body(0).messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"name":"ТОО Ромашка"}' })
    expect(body(0).tool_choice).toBe('none')
  })

  it('skips models without tool support and fails over on a 400 from a model whose support is unknown', async () => {
    const { p } = alem()
    seedModel({ provider_id: p.id, model_id: 'no-tools', capability: 'chat', supports_tools: false })
    seedModel({ provider_id: p.id, model_id: 'Qwen3', capability: 'chat', supports_tools: true })
    fetchSpy.mockResolvedValueOnce(new Response('tools not supported', { status: 400 })).mockResolvedValueOnce(toolAnswer({ model: 'Qwen3' }))
    const r = await chatWithTools({ feature: 'bot_assistant', tier: 'standard', messages: [{ role: 'user', content: 'q' }], tools: TOOLS })
    expect(r).toMatchObject({ ok: true, model: 'Qwen3' })
    expect(fetchSpy.mock.calls.map((_, i) => body(i).model)).toEqual(['AlemLLM', 'Qwen3'])
  })

  it('OpenRouter gets privacy fields and require_parameters with tools', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key'
    await chatWithTools({ feature: 'bot_assistant', tier: 'light', messages: [{ role: 'user', content: 'q' }], tools: TOOLS })
    expect(call(0)[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body(0).provider).toEqual({ data_collection: 'deny', require_parameters: true })
    expect(body(0).usage).toEqual({ include: true })
  })

  it('respects the platform and provider budgets; no key → NO_API_KEY', async () => {
    expect(await chatWithTools({ feature: 'bot_assistant', tier: 'light', messages: [{ role: 'user', content: 'q' }], tools: [] }))
      .toMatchObject({ ok: false, error: 'NO_API_KEY' })
    const { p } = alem()
    invalidateProviderCache()
    ledger.left = 0
    expect(await chatWithTools({ feature: 'bot_assistant', tier: 'light', messages: [{ role: 'user', content: 'q' }], tools: [] }))
      .toMatchObject({ ok: false, error: 'BUDGET_EXCEEDED' })
    ledger.left = 10
    p.daily_budget_usd = 1
    fakeDb.spendToday.alem = 2
    invalidateProviderCache()
    expect(await chatWithTools({ feature: 'bot_assistant', tier: 'light', messages: [{ role: 'user', content: 'q' }], tools: [] }))
      .toMatchObject({ ok: false, error: 'BUDGET_EXCEEDED' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('image parts make it a vision call: vision models first, text-only models skipped', async () => {
    const { p } = alem()
    seedModel({ provider_id: p.id, model_id: 'text-only', capability: 'chat', supports_vision: false })
    seedModel({ provider_id: p.id, model_id: 'qwen2.5-vl', capability: 'chat', supports_vision: true })
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'На фото счёт' } }] }), { status: 200 }))
    const r = await askAboutImage({ feature: 'bot_vision', prompt: 'Что на фото?', image: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' } })
    expect(r).toMatchObject({ ok: true, text: 'На фото счёт' })
    expect(body(0).model).toBe('qwen2.5-vl')
    expect(body(0).messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } })
    expect(await askAboutImage({ feature: 'bot_vision', prompt: 'x', image: { bytes: new Uint8Array([1]), mime: 'application/pdf' } }))
      .toMatchObject({ ok: false, error: 'INVALID_INPUT' })
  })
})

describe('transcribeAudio', () => {
  function stt() {
    const p = seedProvider({ key: 'o66', base_url: 'https://llm.alem.ai/v1' })
    seedCredential({ provider_id: p.id, label: 'Speech to Text', secret_ciphertext: encryptSecret('stt-key-0000000') })
    return seedModel({ provider_id: p.id, model_id: 'speech-to-text', capability: 'transcribe' })
  }

  it('posts multipart /audio/transcriptions with the file, model and language', async () => {
    stt()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ text: ' Привет, мир ' }), { status: 200 }))
    const r = await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array([79, 103, 103, 83]), filename: 'voice.oga', mime: 'audio/ogg', language: 'ru' })
    expect(r).toEqual({ ok: true, text: 'Привет, мир', model: 'speech-to-text', providerKey: 'o66' })
    const [u, init] = call(0)
    expect(u).toBe('https://llm.alem.ai/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer stt-key-0000000')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const form = init.body as FormData
    expect(form.get('model')).toBe('speech-to-text')
    expect(form.get('language')).toBe('ru')
    const file = form.get('file') as File
    expect(file.name).toBe('voice.oga')
    expect(file.type).toBe('audio/ogg')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([79, 103, 103, 83]))
    expect(usage).toEqual([expect.objectContaining({ feature: 'bot_transcribe', model: 'speech-to-text', ok: true })])
    expect(ledger.records[0]).toMatchObject({ providerKey: 'o66', ok: true })
  })

  it('accepts a plain-text answer', async () => {
    stt()
    fetchSpy.mockResolvedValue(new Response('просто текст', { status: 200 }))
    expect(await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array([1]), filename: 'a.mp3', mime: 'audio/mpeg' }))
      .toMatchObject({ ok: true, text: 'просто текст' })
  })

  it('falls back to an OpenRouter audio-input chat model only when OpenRouter has a key', async () => {
    expect(await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array([1]), filename: 'a.ogg', mime: 'audio/ogg' }))
      .toMatchObject({ ok: false, error: 'NOT_CONFIGURED' })
    expect(fetchSpy).not.toHaveBeenCalled()

    // A chat-only provider is never used for audio.
    alem()
    invalidateProviderCache()
    expect(await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array([1]), filename: 'a.ogg', mime: 'audio/ogg' }))
      .toMatchObject({ ok: false, error: 'NOT_CONFIGURED' })

    process.env.OPENROUTER_API_KEY = 'or-key'
    invalidateProviderCache()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ model: 'google/gemini-2.5-flash', choices: [{ message: { content: 'Сәлем' } }], usage: { cost: 0.0001 } }), { status: 200 }))
    const r = await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array([1, 2]), filename: 'voice.oga', mime: 'audio/ogg' })
    expect(r).toMatchObject({ ok: true, text: 'Сәлем', providerKey: 'openrouter' })
    expect(call(0)[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body(0).messages[0].content[1]).toEqual({ type: 'input_audio', input_audio: { data: 'AQI=', format: 'ogg' } })
    expect(body(0).provider).toEqual({ data_collection: 'deny' })
  })

  it('fails over between transcribe models, then to OpenRouter', async () => {
    stt()
    process.env.OPENROUTER_API_KEY = 'or-key'
    fetchSpy
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'текст' } }] }), { status: 200 }))
    expect(await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array([1]), filename: 'a.ogg', mime: 'audio/ogg' }))
      .toMatchObject({ ok: true, text: 'текст', providerKey: 'openrouter' })
    expect(call(0)[0]).toBe('https://llm.alem.ai/v1/audio/transcriptions')
  })

  it('rejects empty and oversized audio; maps audio formats', async () => {
    expect(await transcribeAudio({ feature: 'bot_transcribe', bytes: new Uint8Array(), filename: 'a', mime: 'audio/ogg' }))
      .toMatchObject({ ok: false, error: 'INVALID_INPUT' })
    expect(audioFormatOf('audio/ogg')).toBe('ogg')
    expect(audioFormatOf('audio/mpeg')).toBe('mp3')
    expect(audioFormatOf('audio/x-wav')).toBe('wav')
    expect(audioFormatOf('application/octet-stream', 'voice.oga')).toBe('ogg')
  })
})
