/**
 * Remote OCR goes through the providers router: registered only when the
 * admin routed «ocr» to a chat_vision model, budgets respected, every page
 * call recorded in the ledger, failures leave the page to tesseract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  resolved: null as unknown,
  platformLeft: null as number | null,
  providerRefusal: null as string | null,
  reply: { ok: true, text: 'Счёт № 42', model: 'deepseek-ocr', tokensIn: 900, tokensOut: 12, providerCostUsd: null } as Record<string, unknown>,
  calls: [] as Array<Record<string, unknown>>,
  ledger: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/ai/providers/router', () => ({
  resolveTarget: async () => s.resolved,
  providerBudgetRefusal: async () => s.providerRefusal,
}))
vi.mock('@/lib/ai/providers/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/providers/client')>()),
  ocrImage: async (_t: unknown, p: Record<string, unknown>) => { s.calls.push(p); return s.reply },
}))
vi.mock('@/lib/ai/usage-ledger', () => ({
  platformBudgetLeft: async () => s.platformLeft,
  recordUsage: async (r: Record<string, unknown>) => { s.ledger.push(r) },
}))

import { remoteOcrCall, syncRemoteOcr, REMOTE_OCR_SOURCE } from '@/lib/documents/ocr-remote'
import { hasRemoteOcr, registerRemoteOcr } from '@/lib/documents/ocr'

const target = (over: Record<string, unknown> = {}) => ({
  ok: true,
  target: {
    providerKey: 'alem', providerName: 'Alem Plus', model: 'deepseek-ocr', ocrMode: 'chat_vision',
    priceInPerMtok: 1, priceOutPerMtok: 2, dailyBudgetUsd: null, ...over,
  },
})

beforeEach(() => {
  s.resolved = { ok: false, code: 'NOT_CONFIGURED', message: 'нет маршрута' }
  s.platformLeft = null
  s.providerRefusal = null
  s.reply = { ok: true, text: 'Счёт № 42', model: 'deepseek-ocr', tokensIn: 900, tokensOut: 12, providerCostUsd: null }
  s.calls = []
  s.ledger = []
  registerRemoteOcr(null)
})

describe('syncRemoteOcr', () => {
  it('registers nothing without an OCR route — tesseract stays the engine', async () => {
    expect(await syncRemoteOcr()).toBe(false)
    expect(hasRemoteOcr()).toBe(false)
  })

  it('a route to a provider without chat_vision OCR mode is not used', async () => {
    s.resolved = target({ ocrMode: null })
    expect(await syncRemoteOcr()).toBe(false)
    expect(hasRemoteOcr()).toBe(false)
  })

  it('registers the remote engine for a chat_vision route and unregisters when the route goes', async () => {
    s.resolved = target()
    expect(await syncRemoteOcr()).toBe(true)
    expect(hasRemoteOcr()).toBe(true)
    s.resolved = { ok: false, code: 'NOT_CONFIGURED', message: 'нет маршрута' }
    await syncRemoteOcr()
    expect(hasRemoteOcr()).toBe(false)
  })

  it('leaves an engine registered by someone else (script, test) alone', async () => {
    registerRemoteOcr(async () => ({ text: 'x' }))
    expect(await syncRemoteOcr()).toBe(true)
    expect(hasRemoteOcr()).toBe(true)
    registerRemoteOcr(null)
  })
})

describe('remoteOcrCall', () => {
  it('sends the page as a data URL and records the call with model-price cost', async () => {
    s.resolved = target()
    const out = await remoteOcrCall(Buffer.from('png-bytes'), 'image/png')
    expect(out).toEqual({ text: 'Счёт № 42' })
    expect(String(s.calls[0].imageUrl)).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)
    expect(s.ledger).toEqual([expect.objectContaining({
      source: REMOTE_OCR_SOURCE, model: 'deepseek-ocr', providerKey: 'alem', tokensIn: 900, tokensOut: 12, costSource: 'model_price', ok: true,
    })])
    expect(Number(s.ledger[0].costUsd)).toBeCloseTo((900 * 1 + 12 * 2) / 1_000_000, 10)
  })

  it('does not call the provider when the platform or provider budget is spent', async () => {
    s.resolved = target()
    s.platformLeft = 0
    expect(await remoteOcrCall(Buffer.from('x'), 'image/png')).toBeNull()
    s.platformLeft = null
    s.providerRefusal = 'дневной бюджет провайдера исчерпан'
    expect(await remoteOcrCall(Buffer.from('x'), 'image/png')).toBeNull()
    expect(s.calls).toHaveLength(0)
    expect(s.ledger).toHaveLength(0)
  })

  it('a failed or empty answer returns null (tesseract takes the page) and is still recorded', async () => {
    s.resolved = target()
    s.reply = { ok: false, code: 'PROVIDER_ERROR', status: 500, message: 'ошибка провайдера', retryable: true, detail: null }
    expect(await remoteOcrCall(Buffer.from('x'), 'image/jpeg')).toBeNull()
    expect(s.ledger[0]).toMatchObject({ ok: false, providerKey: 'alem' })
    s.reply = { ok: true, text: '   ', model: 'deepseek-ocr', tokensIn: 5, tokensOut: 0, providerCostUsd: null }
    expect(await remoteOcrCall(Buffer.from('x'), 'image/jpeg')).toBeNull()
  })
})
