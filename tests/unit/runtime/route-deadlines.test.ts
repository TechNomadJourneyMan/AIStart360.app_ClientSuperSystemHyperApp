/**
 * R-015 (R4-A2) — the routes of the groups «опасно» and «средне» (R4-AUDIT-A §2.1) had a
 * `maxDuration` that `next start` on Railway ignores, or none at all: a hung dependency held the
 * request — its socket, memory and a Prisma connection of the pool of 5 — without end. Each of them
 * is now wrapped with withDeadline (lib/runtime/deadline.ts), the way v1/documents and the AI routes
 * already were.
 *
 * Here every wrapped handler hangs on its first dependency (the session check: every Supabase
 * client is a black hole that never answers) and must answer 504 DEADLINE_EXCEEDED with its
 * `x-deadline` label exactly when its budget is spent — not a millisecond before. The webhooks and
 * the Telegram sync, whose first step is not the session, are tested in their own files
 * (meta-webhook, whatsapp-web-webhook, telegram-inbox-webhook, telegram-personal-sync-route).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** A Supabase client (or any chain of it) that never answers: every await on it hangs. */
function blackHole(): unknown {
  const target = function () {}
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return () => {} // a thenable that never settles
      if (prop === Symbol.toPrimitive) return () => 'black-hole'
      return blackHole()
    },
    apply() {
      return blackHole()
    },
  })
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => blackHole() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => blackHole() }))
vi.mock('@/lib/supabase-service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createServiceClient: () => blackHole(),
}))
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isRateLimited: async () => false,
  isRateLimitedKey: async () => false,
}))

const ID = '22222222-2222-4222-8222-222222222222'
const id = { params: { id: ID } }

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>
interface Case {
  route: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  label: string
  ms: number
  load: () => Promise<Record<string, unknown>>
  ctx?: unknown
  body?: unknown
}

const CASES: Case[] = [
  // «опасно»
  { route: 'giga-admin/omnichannel/backfill', method: 'POST', label: 'omnichannel-backfill', ms: 30_000, load: () => import('@/app/api/giga-admin/omnichannel/backfill/route'), body: { channel: 'instagram' } },
  { route: 'v1/onboarding/documents', method: 'GET', label: 'onboarding-documents', ms: 60_000, load: () => import('@/app/api/v1/onboarding/documents/route') },
  { route: 'v1/onboarding/documents', method: 'POST', label: 'onboarding-documents', ms: 60_000, load: () => import('@/app/api/v1/onboarding/documents/route'), body: { storage_path: `${ID}/${ID}.pdf`, file_name: 'a.pdf', doc_type: 'other' } },
  { route: 'v1/onboarding/documents/[id]/process', method: 'POST', label: 'onboarding-document-process', ms: 60_000, load: () => import('@/app/api/v1/onboarding/documents/[id]/process/route'), ctx: id },
  // «средне»: syncs and staff bulk operations
  { route: 'giga-admin/integrations/[companyId]/[provider]/sync', method: 'POST', label: 'integration-sync', ms: 60_000, load: () => import('@/app/api/giga-admin/integrations/[companyId]/[provider]/sync/route'), ctx: { params: { companyId: ID, provider: 'amocrm' } } },
  { route: 'v1/crm/connections/[id]/sync', method: 'POST', label: 'crm-connection-sync', ms: 60_000, load: () => import('@/app/api/v1/crm/connections/[id]/sync/route'), ctx: id },
  { route: 'giga-admin/users/bulk', method: 'POST', label: 'users-bulk', ms: 60_000, load: () => import('@/app/api/giga-admin/users/bulk/route'), body: { action: 'approve', ids: [ID] } },
  { route: 'giga-admin/requests/bulk', method: 'POST', label: 'requests-bulk', ms: 60_000, load: () => import('@/app/api/giga-admin/requests/bulk/route'), body: { action: 'approve', ids: [ID] } },
  { route: 'giga-admin/comm/kb/upload', method: 'POST', label: 'comm-kb-upload', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/kb/upload/route') },
  { route: 'giga-admin/comm/kb', method: 'GET', label: 'comm-kb', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/kb/route') },
  { route: 'giga-admin/comm/kb', method: 'POST', label: 'comm-kb', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/kb/route'), body: { question: 'Вопрос', answer: 'Ответ' } },
  { route: 'giga-admin/comm/kb/[id]', method: 'GET', label: 'comm-kb-item', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/kb/[id]/route'), ctx: id },
  { route: 'giga-admin/comm/kb/[id]', method: 'PATCH', label: 'comm-kb-item', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/kb/[id]/route'), ctx: id, body: { answer: 'Ответ' } },
  { route: 'giga-admin/comm/kb/[id]', method: 'DELETE', label: 'comm-kb-item', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/kb/[id]/route'), ctx: id },
  { route: 'giga-admin/comm/campaigns', method: 'GET', label: 'comm-campaigns', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/campaigns/route') },
  { route: 'giga-admin/comm/campaigns', method: 'POST', label: 'comm-campaigns', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/campaigns/route'), body: { title: 'Рассылка' } },
  { route: 'giga-admin/comm/campaigns/[campaignId]', method: 'GET', label: 'comm-campaign', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/campaigns/[campaignId]/route'), ctx: { params: { campaignId: ID } } },
  { route: 'giga-admin/comm/campaigns/[campaignId]', method: 'PATCH', label: 'comm-campaign', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/campaigns/[campaignId]/route'), ctx: { params: { campaignId: ID } }, body: { title: 'Рассылка' } },
  { route: 'giga-admin/comm/campaigns/preview', method: 'POST', label: 'comm-campaign-preview', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/campaigns/preview/route') },
  { route: 'giga-admin/comm/users/[userId]/messages', method: 'POST', label: 'comm-user-message', ms: 60_000, load: () => import('@/app/api/giga-admin/comm/users/[userId]/messages/route'), ctx: { params: { userId: ID } }, body: { text: 'Здравствуйте' } },
  { route: 'giga-admin/point-a/templates', method: 'GET', label: 'point-a-templates', ms: 60_000, load: () => import('@/app/api/giga-admin/point-a/templates/route') },
  { route: 'giga-admin/point-a/templates', method: 'POST', label: 'point-a-templates', ms: 60_000, load: () => import('@/app/api/giga-admin/point-a/templates/route') },
  { route: 'giga-admin/point-a/templates/[key]', method: 'PUT', label: 'point-a-template', ms: 60_000, load: () => import('@/app/api/giga-admin/point-a/templates/[key]/route'), ctx: { params: { key: 'retail' } } },
  { route: 'giga-admin/point-a/templates/[key]', method: 'DELETE', label: 'point-a-template', ms: 60_000, load: () => import('@/app/api/giga-admin/point-a/templates/[key]/route'), ctx: { params: { key: 'retail' } } },
  // «средне»: inline recalculations
  { route: 'v1/point-a/recalculate', method: 'POST', label: 'point-a-recalculate', ms: 60_000, load: () => import('@/app/api/v1/point-a/recalculate/route') },
  { route: 'giga-admin/users/[id]/point-a/v4/recalculate', method: 'POST', label: 'point-a-staff-recalculate', ms: 60_000, load: () => import('@/app/api/giga-admin/users/[id]/point-a/v4/recalculate/route'), ctx: id },
  { route: 'giga-admin/users/[id]/point-a/v4/hypotheses', method: 'POST', label: 'point-a-hypotheses', ms: 60_000, load: () => import('@/app/api/giga-admin/users/[id]/point-a/v4/hypotheses/route'), ctx: id },
  { route: 'giga-admin/users/[id]/point-a/v4/hypotheses', method: 'DELETE', label: 'point-a-hypotheses', ms: 60_000, load: () => import('@/app/api/giga-admin/users/[id]/point-a/v4/hypotheses/route'), ctx: id },
  { route: 'giga-admin/users/[id]/point-b/recompute', method: 'POST', label: 'point-b-recompute', ms: 60_000, load: () => import('@/app/api/giga-admin/users/[id]/point-b/recompute/route'), ctx: id },
  { route: 'giga-admin/users/[id]/point-b/plan-fact', method: 'GET', label: 'point-b-plan-fact-staff', ms: 60_000, load: () => import('@/app/api/giga-admin/users/[id]/point-b/plan-fact/route'), ctx: id },
  { route: 'giga-admin/users/[id]/point-b/plan-fact', method: 'PUT', label: 'point-b-plan-fact-staff', ms: 60_000, load: () => import('@/app/api/giga-admin/users/[id]/point-b/plan-fact/route'), ctx: id },
  { route: 'expert/clients/[id]/point-b/plan-fact', method: 'GET', label: 'point-b-plan-fact-expert', ms: 60_000, load: () => import('@/app/api/expert/clients/[id]/point-b/plan-fact/route'), ctx: id },
  { route: 'expert/clients/[id]/point-b/plan-fact', method: 'POST', label: 'point-b-plan-fact-expert', ms: 60_000, load: () => import('@/app/api/expert/clients/[id]/point-b/plan-fact/route'), ctx: id },
  { route: 'expert/clients/[id]/point-b/plan-fact', method: 'PUT', label: 'point-b-plan-fact-expert', ms: 60_000, load: () => import('@/app/api/expert/clients/[id]/point-b/plan-fact/route'), ctx: id },
  { route: 'v1/point-b/monthly-facts', method: 'PUT', label: 'point-b-monthly-facts', ms: 60_000, load: () => import('@/app/api/v1/point-b/monthly-facts/route') },
  // «средне»: AI of clients and staff
  { route: 'v1/ai/chat', method: 'GET', label: 'ai-chat', ms: 60_000, load: () => import('@/app/api/v1/ai/chat/route') },
  { route: 'v1/ai/chat', method: 'POST', label: 'ai-chat', ms: 60_000, load: () => import('@/app/api/v1/ai/chat/route'), body: { message: 'Привет' } },
  { route: 'v1/ai/assistant', method: 'GET', label: 'ai-assistant', ms: 90_000, load: () => import('@/app/api/v1/ai/assistant/route') },
  { route: 'v1/ai/assistant', method: 'POST', label: 'ai-assistant', ms: 90_000, load: () => import('@/app/api/v1/ai/assistant/route'), body: { message: 'Привет' } },
  { route: 'v1/journey/chat', method: 'POST', label: 'journey-chat', ms: 60_000, load: () => import('@/app/api/v1/journey/chat/route'), body: { message: 'Привет' } },
  { route: 'v1/journey/documents', method: 'POST', label: 'journey-documents', ms: 90_000, load: () => import('@/app/api/v1/journey/documents/route') },
  { route: 'v1/point-a/narrative', method: 'POST', label: 'point-a-narrative', ms: 60_000, load: () => import('@/app/api/v1/point-a/narrative/route') },
  { route: 'giga-admin/users/[id]/review/ai-draft', method: 'POST', label: 'review-ai-draft', ms: 90_000, load: () => import('@/app/api/giga-admin/users/[id]/review/ai-draft/route'), ctx: id },
  { route: 'gri/ai-strategy', method: 'POST', label: 'gri-ai-strategy', ms: 60_000, load: () => import('@/app/api/gri/ai-strategy/route') },
  { route: 'gri/financial-analyst', method: 'POST', label: 'gri-financial-analyst', ms: 90_000, load: () => import('@/app/api/gri/financial-analyst/route') },
  { route: 'pulse/briefing', method: 'POST', label: 'pulse-briefing', ms: 60_000, load: () => import('@/app/api/pulse/briefing/route') },
  { route: 'v1/market-analysis/generate', method: 'POST', label: 'market-analysis-generate', ms: 60_000, load: () => import('@/app/api/v1/market-analysis/generate/route') },
  { route: 'v1/point-a/insights/ai-generate', method: 'POST', label: 'point-a-insights-ai', ms: 60_000, load: () => import('@/app/api/v1/point-a/insights/ai-generate/route') },
  { route: 'v1/survey/chat', method: 'GET', label: 'survey-chat', ms: 60_000, load: () => import('@/app/api/v1/survey/chat/route') },
  { route: 'v1/survey/chat', method: 'POST', label: 'survey-chat', ms: 60_000, load: () => import('@/app/api/v1/survey/chat/route'), body: { message: 'Привет' } },
  { route: 'v1/assistant/chat', method: 'POST', label: 'assistant-chat', ms: 60_000, load: () => import('@/app/api/v1/assistant/chat/route'), body: { message: 'Привет' } },
  { route: 'v1/assistant/converse', method: 'POST', label: 'assistant-converse', ms: 60_000, load: () => import('@/app/api/v1/assistant/converse/route'), body: { message: 'Привет' } },
  { route: 'v1/assistant/insight', method: 'POST', label: 'assistant-insight', ms: 60_000, load: () => import('@/app/api/v1/assistant/insight/route') },
  { route: 'v1/assistant/validate', method: 'POST', label: 'assistant-validate', ms: 60_000, load: () => import('@/app/api/v1/assistant/validate/route') },
]

function request(c: Case): NextRequest {
  const url = `http://localhost/api/${c.route.replace(/\[(\w+)\]/g, ID)}`
  const hasBody = c.method !== 'GET' && c.method !== 'DELETE'
  return new NextRequest(url, {
    method: c.method,
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(c.body ?? {}) : undefined,
  })
}

beforeAll(async () => {
  // Every route module loaded up front, one by one: no module loading while a handler is timed.
  for (const c of CASES) await c.load()
}, 120_000)

beforeEach(() => {
  vi.stubEnv('ROUTE_DEADLINE_DISABLED', '')
  // AI routes refuse at once without a model key; with one they go on to the session check
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('R-015: the routes of «опасно» / «средне» answer 504 when their dependency hangs', () => {
  it('covers every handler once', () => {
    expect(new Set(CASES.map((c) => `${c.method} ${c.route}`)).size).toBe(CASES.length)
  })

  for (const c of CASES) {
    it(`${c.method} /api/${c.route} → 504 «${c.label}» after ${c.ms / 1000} s, not before`, async () => {
      const mod = await c.load()
      const handler = mod[c.method] as Handler
      expect(typeof handler).toBe('function')

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let settled: string | null = null
      const pending = handler(request(c), c.ctx ?? { params: {} })
      pending.then(
        (res) => { settled = `status ${res.status}` },
        (err: unknown) => { settled = `threw ${err instanceof Error ? `${err.name}: ${err.message.split('\n')[0]}` : String(err)}` },
      )

      await vi.advanceTimersByTimeAsync(c.ms - 1)
      expect(settled, 'answered before its budget was spent: the handler did not hang where expected').toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled, 'no answer when the budget was spent: the handler is not wrapped').toBe('status 504')

      const res = await pending
      expect(res.status).toBe(504)
      expect(res.headers.get('x-deadline')).toBe(c.label)
      expect(await res.json()).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' })
    })
  }
})
