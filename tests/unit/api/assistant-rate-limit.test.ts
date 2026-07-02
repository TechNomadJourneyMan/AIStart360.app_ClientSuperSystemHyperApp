// 429 rate-limit coverage for the 7 /api/v1/assistant/* routes (ТЗ §16.1).
// Uses the REAL lib/rate-limit in-memory limiter (Upstash env cleared below);
// Supabase auth and the heavy assistant internals are mocked so each handler
// runs in pure Node. Budgets are keyed by userId, so every test authenticates
// as its own user to get a fresh budget — all requests deliberately share one
// x-forwarded-for IP to prove the key is the user, not the address.

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

// ── Supabase session (cookie auth) ───────────────────────────
const getUserMock = vi.fn()
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}))

// ── Heavy assistant internals: minimal deterministic stubs ───
vi.mock('@/lib/assistant/context', () => ({
  buildAssistantContext: vi.fn(async () => ({
    answers: {},
    diagnosticId: 'diag-1',
    llm_analysis: null,
  })),
}))
vi.mock('@/lib/assistant/validators', () => ({
  runValidation: vi.fn(async () => []),
}))
vi.mock('@/lib/assistant/completion', () => ({
  computeCompletion: vi.fn(() => ({ overall_pct: 40, missing_required: [], status: 'in_progress' })),
  deriveStatus: vi.fn(() => 'in_progress'),
}))
vi.mock('@/lib/assistant/chat-scripts', () => ({
  CHAT_SCRIPTS: [
    {
      id: 'script-1',
      section: 'Продажи',
      question: 'Вопрос?',
      question_en: 'Question?',
      valueLine: null,
      valueLine_en: null,
    },
  ],
  hydrate: vi.fn(() => ({ answer_ru: 'ок', used_data: [], insufficient: false })),
}))
vi.mock('@/lib/assistant/answer', () => ({
  answerUserQuestion: vi.fn(async () => ({
    can_answer: true,
    needs_expert: false,
    confidence: 'high',
    answer: 'ответ',
  })),
}))
vi.mock('@/lib/assistant/escalation/adapter', () => ({
  createExpertCase: vi.fn(async () => ({ id: 'case-1' })),
}))
vi.mock('@/lib/assistant/llm-analyzer', () => ({
  analyzeWithLlm: vi.fn(async () => null),
}))
vi.mock('@/lib/ai/structured', () => ({
  hasOpenRouterKey: () => false,
}))

// status/analyze persist snapshots through a dynamically imported service-role
// client — stub the whole SDK so persistence is a cheap no-op.
vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  chain.update = vi.fn(() => chain)
  chain.insert = vi.fn(async () => ({ error: null }))
  return { createClient: () => ({ from: () => chain }) }
})

// Import the handlers after the mocks are wired.
import { POST as chatPost } from '@/app/api/v1/assistant/chat/route'
import { POST as askPost } from '@/app/api/v1/assistant/ask/route'
import { POST as analyzePost } from '@/app/api/v1/assistant/analyze/route'
import { POST as escalatePost } from '@/app/api/v1/assistant/escalate/route'
import { POST as validatePost } from '@/app/api/v1/assistant/validate/route'
import { GET as scriptsGet } from '@/app/api/v1/assistant/scripts/route'
import { GET as statusGet } from '@/app/api/v1/assistant/status/route'

// ── Helpers ──────────────────────────────────────────────────

function authedAs(userId: string) {
  getUserMock.mockResolvedValue({ data: { user: { id: userId } }, error: null })
}

const SHARED_IP = '198.51.100.10'

function post(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': SHARED_IP },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function get(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { 'x-forwarded-for': SHARED_IP },
  })
}

/** Fire `n` requests expecting them to pass, then return the (n+1)th response. */
async function drain(n: number, fire: () => Promise<Response>) {
  for (let i = 0; i < n; i++) {
    const res = await fire()
    expect(res.status).toBe(200)
  }
  return fire()
}

async function expectRateLimited(res: Response) {
  expect(res.status).toBe(429)
  expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' })
}

// ─────────────────────────────────────────────────────────────

describe('assistant routes rate limiting (ТЗ §16.1)', () => {
  it('chat: 11th request in the window → 429 rate_limited', async () => {
    authedAs('user-chat')
    const res = await drain(10, () =>
      chatPost(post('/api/v1/assistant/chat', { scriptId: 'script-1' })),
    )
    await expectRateLimited(res)
  })

  it('ask: 11th request in the window → 429 rate_limited', async () => {
    authedAs('user-ask')
    const res = await drain(10, () =>
      askPost(post('/api/v1/assistant/ask', { question: 'Как дела с выручкой?' })),
    )
    await expectRateLimited(res)
  })

  it('analyze: 11th request in the window → 429 rate_limited', async () => {
    authedAs('user-analyze')
    const res = await drain(10, () => analyzePost(post('/api/v1/assistant/analyze')))
    await expectRateLimited(res)
  })

  it('escalate: 11th request in the window → 429 rate_limited', async () => {
    authedAs('user-escalate')
    const res = await drain(10, () => escalatePost(post('/api/v1/assistant/escalate')))
    await expectRateLimited(res)
  })

  it('scripts: 31st request in the window → 429 rate_limited', async () => {
    authedAs('user-scripts')
    const res = await drain(30, () => scriptsGet(get('/api/v1/assistant/scripts')))
    await expectRateLimited(res)
  })

  it('status: 31st request in the window → 429 rate_limited', async () => {
    authedAs('user-status')
    const res = await drain(30, () => statusGet(get('/api/v1/assistant/status')))
    await expectRateLimited(res)
  })

  it('validate: 31st request in the window → 429 rate_limited', async () => {
    authedAs('user-validate')
    const res = await drain(30, () => validatePost(post('/api/v1/assistant/validate', {})))
    await expectRateLimited(res)
  })

  it('keys the budget by userId — another user on the same IP is not blocked', async () => {
    authedAs('user-iso-a')
    const blocked = await drain(10, () =>
      chatPost(post('/api/v1/assistant/chat', { scriptId: 'script-1' })),
    )
    await expectRateLimited(blocked)

    // Same IP (every request in this file shares SHARED_IP), fresh session.
    authedAs('user-iso-b')
    const fresh = await chatPost(post('/api/v1/assistant/chat', { scriptId: 'script-1' }))
    expect(fresh.status).toBe(200)
  })

  it('unauthenticated requests still get 401, not 429', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await chatPost(post('/api/v1/assistant/chat', { scriptId: 'script-1' }))
    expect(res.status).toBe(401)
  })
})
