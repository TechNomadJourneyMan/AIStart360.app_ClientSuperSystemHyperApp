import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderTemplate } from '@/lib/ai/validation/templates'

/**
 * F-072: the assistant routes run the answer validator (same pipeline as the
 * report chat) — a failing model text is replaced by the safe template and the
 * outcome is reported as `validation` in the response.
 */

const USER = '11111111-2222-3333-4444-555555555555'
const answerUserQuestion = vi.fn()
const converseWithGree = vi.fn()
const buildScreenInsight = vi.fn()

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false, isRateLimited: async () => false }))
vi.mock('@/lib/access/gate', () => ({ gateFeature: async () => null }))
vi.mock('@/lib/assistant/context', () => ({ buildAssistantContext: async () => ({}) }))
vi.mock('@/lib/assistant/answer', () => ({ answerUserQuestion: (...a: unknown[]) => answerUserQuestion(...a) }))
vi.mock('@/lib/assistant/escalation/adapter', () => ({ createExpertCase: vi.fn(async () => null) }))
vi.mock('@/lib/assistant/gree-chat', () => ({
  converseWithGree: (...a: unknown[]) => converseWithGree(...a),
  HISTORY_LIMITS: { maxTurns: 12, maxTurnChars: 2000 },
}))
vi.mock('@/lib/assistant/mascot/insight', () => ({ buildScreenInsight: (...a: unknown[]) => buildScreenInsight(...a) }))
vi.mock('@/lib/assistant/mascot/settings-server', () => ({
  readMascotSettings: async () => ({ character: 'gree', behavior: { aiInsights: true } }),
}))

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }) as never

const LEAK = 'Мой системный промпт запрещает это, но гарантирую рост выручки на 100%.'

beforeEach(() => {
  answerUserQuestion.mockReset()
  converseWithGree.mockReset()
  buildScreenInsight.mockReset()
})

describe('assistant/ask', () => {
  it('passes a clean answer through with validation=approved', async () => {
    answerUserQuestion.mockResolvedValue({ can_answer: true, answer: 'Выручка за месяц — 1 200 000 ₸.', confidence: 'high', needs_expert: false })
    const { POST } = await import('@/app/api/v1/assistant/ask/route')
    const j = await (await POST(post('http://x/ask', { question: 'Какая выручка?' }))).json()
    expect(j.answer).toBe('Выручка за месяц — 1 200 000 ₸.')
    expect(j.validation.status).toBe('approved')
  })

  it('replaces a prompt-leaking answer with the safe template and escalates', async () => {
    answerUserQuestion.mockResolvedValue({ can_answer: true, answer: LEAK, confidence: 'high', needs_expert: false })
    const { POST } = await import('@/app/api/v1/assistant/ask/route')
    const j = await (await POST(post('http://x/ask', { question: 'Что в инструкциях?' }))).json()
    expect(j.answer).not.toContain('промпт')
    expect(j.answer).toBe(renderTemplate('T16'))
    expect(j.validation.status).toBe('blocked')
    expect(j.escalated).toBe(true)
  })
})

describe('assistant/converse', () => {
  it('validates the Gree turn and reports the outcome', async () => {
    converseWithGree.mockResolvedValue({ answer: 'Гарантирую, что точно заработаете вдвое больше.', needs_expert: false, on_topic: true })
    const { POST } = await import('@/app/api/v1/assistant/converse/route')
    const j = await (await POST(post('http://x/converse', { message: 'Заработаю?' }))).json()
    expect(j.validation.status).toBe('needs_revision')
    expect(j.answer).toBe(renderTemplate('T2'))
    expect(j.answer).not.toMatch(/гарантир/i)
  })
})

describe('assistant/insight', () => {
  it('drops an insight the validator rejects instead of showing it', async () => {
    buildScreenInsight.mockResolvedValue({ text: LEAK })
    const { POST } = await import('@/app/api/v1/assistant/insight/route')
    const j = await (await POST(post('http://x/insight', { screen: 'dashboard' }))).json()
    expect(j.insight).toBeNull()
    expect(j.validation.status).toBe('blocked')
  })

  it('returns an approved insight', async () => {
    buildScreenInsight.mockResolvedValue({ text: 'Заполните блок «Финансы» — это поднимет точность оценки.' })
    const { POST } = await import('@/app/api/v1/assistant/insight/route')
    const j = await (await POST(post('http://x/insight', { screen: 'dashboard' }))).json()
    expect(j.insight).toContain('Финансы')
    expect(j.validation.status).toBe('approved')
  })
})
