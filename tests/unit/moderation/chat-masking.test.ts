/**
 * AI-чаты и мат: вопрос не отклоняется — модель и история получают
 * замаскированный текст, к ответу сверху добавляется вежливая приписка;
 * мат в ответе модели тоже маскируется перед показом/сохранением.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runChatTurn, type ChatEvent, type ChatLlm } from '@/lib/chat/engine'
import type { ToolContext } from '@/lib/chat/tools'
import type { ChatWithToolsResult, ToolChatMessage } from '@/lib/ai/tools-chat'
import { PROFANITY_CHAT_NOTE } from '@/lib/moderation/chat'

const h = vi.hoisted(() => ({
  answer: vi.fn(),
  expertCase: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) } }),
}))
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<typeof import('@/lib/rate-limit')>()), isRateLimitedKey: async () => false }))
vi.mock('@/lib/access/gate', () => ({ gateFeature: async () => null }))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => null }))
vi.mock('@/lib/assistant/context', () => ({ buildAssistantContext: async () => ({}) }))
vi.mock('@/lib/assistant/answer', () => ({ answerUserQuestion: h.answer }))
vi.mock('@/lib/assistant/escalation/adapter', () => ({ createExpertCase: h.expertCase }))
vi.mock('@/lib/ai/validation/apply', () => ({
  validateAiText: async (text: string) => ({ text, approved: true, meta: { status: 'approved', risk_level: 'low', template: null, issues: 0 } }),
}))

const BAD = 'Почему выручка упала, блядь?'

const ok = (content: string): ChatWithToolsResult => ({
  ok: true, model: 'm', providerKey: 'p', finishReason: 'stop', costUsd: 0, message: { content, tool_calls: [] },
} as unknown as ChatWithToolsResult)

const ctx = (): ToolContext => ({
  companyId: 'co', userId: 'u', ownerId: 'u', sb: {} as ToolContext['sb'], canManage: true, now: new Date('2026-10-16T00:00:00Z'),
  propose: vi.fn(async () => 'act-1'),
})

function llmSaying(content: string): { llm: ChatLlm; seen: ToolChatMessage[][] } {
  const seen: ToolChatMessage[][] = []
  return { seen, llm: async (o) => { seen.push([...o.messages]); return ok(content) } }
}

describe('unified chat engine (runChatTurn)', () => {
  it('вопрос с матом: модель видит маску, ответ — с припиской, history хранит маску', async () => {
    const { llm, seen } = llmSaying('Выручка упала из-за сезонности.')
    const events: ChatEvent[] = []
    const r = await runChatTurn({ llm, tools: [], ctx: ctx(), surface: 'global', focus: {}, history: [], message: BAD, onEvent: (e) => events.push(e) })
    const sentQuestion = seen[0].at(-1) as { content: string }
    expect(sentQuestion.content).not.toMatch(/блядь/)
    expect(sentQuestion.content).toContain('б****')
    expect(r.question).toBe(sentQuestion.content)
    expect(r.answer).toBe(`${PROFANITY_CHAT_NOTE}\n\nВыручка упала из-за сезонности.`)
    expect(events.at(-1)).toEqual({ type: 'answer', text: r.answer })
  })

  it('чистый вопрос — без приписки; мат в ответе модели маскируется', async () => {
    const { llm } = llmSaying('Ну и хуйня с маржой')
    const r = await runChatTurn({ llm, tools: [], ctx: ctx(), surface: 'global', focus: {}, history: [], message: 'Как маржа?' })
    expect(r.question).toBe('Как маржа?')
    expect(r.answer).not.toContain(PROFANITY_CHAT_NOTE)
    expect(r.answer).not.toMatch(/хуйня/)
  })

  it('старые сообщения пользователя из истории тоже уходят модели замаскированными', async () => {
    const { llm, seen } = llmSaying('Ок')
    await runChatTurn({ llm, tools: [], ctx: ctx(), surface: 'global', focus: {}, history: [{ role: 'user', content: 'сука, где отчёт' }], message: 'Где отчёт?' })
    expect(JSON.stringify(seen[0])).not.toMatch(/сука/)
  })
})

const ask = await import('@/app/api/v1/assistant/ask/route')

describe('POST /api/v1/assistant/ask', () => {
  const post = (question: string) =>
    ask.POST(new NextRequest('http://localhost/api/v1/assistant/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) }))

  beforeEach(() => {
    h.answer.mockReset().mockResolvedValue({ can_answer: true, needs_expert: false, confidence: 'high', answer: 'Выручка упала на 10%.' })
    h.expertCase.mockReset()
  })

  it('не отклоняет: модель получает маску, ответ — с вежливой припиской', async () => {
    const res = await post(BAD)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(h.answer.mock.calls[0][1]).not.toMatch(/блядь/)
    expect(body.answer).toBe(`${PROFANITY_CHAT_NOTE}\n\nВыручка упала на 10%.`)
  })

  it('чистый вопрос — ответ как есть; мат в ответе модели маскируется', async () => {
    h.answer.mockResolvedValue({ can_answer: true, needs_expert: false, confidence: 'high', answer: 'Это пиздец, а не маржа' })
    const body = await (await post('Как маржа?')).json()
    expect(body.answer).not.toContain(PROFANITY_CHAT_NOTE)
    expect(body.answer).not.toMatch(/пиздец/)
  })

  it('эскалация к эксперту несёт замаскированный вопрос', async () => {
    h.answer.mockResolvedValue({ can_answer: false, needs_expert: true, confidence: 'low', answer: '' })
    await post(BAD)
    expect(h.expertCase.mock.calls[0][1].userMessage).not.toMatch(/блядь/)
  })
})
