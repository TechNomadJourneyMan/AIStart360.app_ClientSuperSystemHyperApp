import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryClient } from '../data-layer/memory-client'

const h = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  tenant: { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } } as Record<string, unknown>,
  limited: false,
  budget: null as unknown,
  turn: vi.fn(),
  decide: vi.fn(),
  pending: null as Record<string, unknown> | null,
  emit: vi.fn(),
  db: null as unknown as ReturnType<typeof memoryClient>,
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ ...h.db.client, auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db.client }))
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: vi.fn(async () => h.tenant), tenantErrorMessage: () => 'Нет доступа' }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => h.limited }))
vi.mock('@/lib/access/gate', () => ({ gateFeature: async () => null }))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => h.budget }))
vi.mock('@/lib/ai/tools-chat', () => ({ chatWithTools: vi.fn() }))
vi.mock('@/lib/ai/retrieval', () => ({ retrieveUserChunks: vi.fn(async () => []) }))
vi.mock('@/lib/chat/engine', () => ({ runChatTurn: h.turn }))
vi.mock('@/lib/chat/actions', () => ({ loadPending: async () => h.pending, decideAction: h.decide }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: h.emit }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))

const { POST, GET } = await import('@/app/api/v1/ai/assistant/route')
const actionRoute = await import('@/app/api/v1/ai/actions/[id]/route')
const tenancy = await import('@/lib/tenancy')

async function events(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text()
  return text.split('\n\n').filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6)))
}
const post = (body: unknown) => POST(new Request('http://localhost/api/v1/ai/assistant', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.user = { id: 'u-1' }
  h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }
  h.limited = false
  h.budget = null
  h.db = memoryClient({ companies: [{ id: 'co-1', user_id: 'u-1' }], ai_conversations: [], ai_messages: [], ai_pending_actions: [] })
  h.turn.mockReset().mockImplementation(async (a: { onEvent: (e: unknown) => void; ctx: { propose: (k: string, p: unknown, v: unknown) => Promise<string> } }) => {
    a.onEvent({ type: 'status', text: 'Смотрю Точку А…' })
    const id = await a.ctx.propose('set_goal', { metricId: 'x' }, { title: 'Цель', before: null, after: '40%' })
    a.onEvent({ type: 'proposal', actionId: id })
    a.onEvent({ type: 'answer', text: 'Проверьте карточку.' })
    return { answer: 'Проверьте карточку.', proposals: [id], toolsUsed: ['propose_goal'], outcome: 'proposed' }
  })
  h.decide.mockReset().mockResolvedValue({ ok: true, status: 'applied', companyId: 'co-1', kind: 'set_goal', event: 'TARGET_CHANGED' })
  h.pending = { id: '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3', user_id: 'u-1', company_id: 'co-1' }
  h.emit.mockReset()
})

describe('POST /api/v1/ai/assistant', () => {
  it('streams status → proposal (with its card) → answer → done, persists the turn', async () => {
    const res = await post({ message: 'Поставь цель по марже 40%', surface: 'point_a', focus: { block: 'finance' } })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const ev = await events(res)
    expect(ev.map((e) => e.type)).toEqual(['status', 'proposal', 'answer', 'done'])
    expect(ev[1]).toMatchObject({ action: { kind: 'set_goal', preview: { after: '40%' } } })
    expect(h.db.db.ai_pending_actions[0]).toMatchObject({ user_id: 'u-1', company_id: 'co-1', kind: 'set_goal' })
    expect(h.db.db.ai_messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(h.db.db.ai_conversations[0]).toMatchObject({ user_id: 'u-1', company_key: 'co-1', surface: 'point_a' })
    expect(h.turn.mock.calls[0][0]).toMatchObject({ surface: 'point_a', focus: { block: 'finance' }, message: 'Поставь цель по марже 40%' })
  })

  it('reads the company with read access; members get read tools only', async () => {
    h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'member', canManage: false, legacy: false } }
    await events(await post({ message: 'Как дела?' }))
    expect(tenancy.resolveTenantWith).toHaveBeenLastCalledWith(expect.anything(), 'u-1', expect.objectContaining({ access: 'read' }))
    const tools = h.turn.mock.calls[0][0].tools as Array<{ kind: string }>
    expect(tools.every((t) => t.kind === 'read')).toBe(true)
  })

  it('401 / 400 / 429 / budget', async () => {
    h.user = null
    expect((await post({ message: 'x' })).status).toBe(401)
    h.user = { id: 'u-1' }
    expect((await post({ message: '' })).status).toBe(400)
    h.limited = true
    expect((await post({ message: 'x' })).status).toBe(429)
    h.limited = false
    const { NextResponse } = await import('next/server')
    h.budget = NextResponse.json({ ok: false, code: 'ai_budget_exceeded' }, { status: 429 })
    expect((await post({ message: 'x' })).status).toBe(429)
    expect(h.turn).not.toHaveBeenCalled()
  })

  it('GET: an empty chat before the first question', async () => {
    const res = await GET(new Request('http://localhost/api/v1/ai/assistant?surface=gri'))
    expect((await res.json()).data).toEqual({ conversationId: null, messages: [], actions: [] })
  })
})

describe('POST /api/v1/ai/actions/[id]', () => {
  const ID = '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'
  const call = (decision: string, id = ID) => actionRoute.POST(new Request(`http://localhost/api/v1/ai/actions/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }), { params: { id } })

  it('apply: manage access of the action company, event, ok', async () => {
    const res = await call('apply')
    expect(res.status).toBe(200)
    expect(tenancy.resolveTenantWith).toHaveBeenLastCalledWith(expect.anything(), 'u-1', { companyId: 'co-1', access: 'manage' })
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'TARGET_CHANGED', companyId: 'co-1' }))
  })
  it("someone else's / unknown action → 404; bad body → 400; refusals passed through", async () => {
    h.pending = null
    expect((await call('apply')).status).toBe(404)
    expect((await call('apply', 'nope')).status).toBe(404)
    h.pending = { id: ID, user_id: 'u-1', company_id: 'co-1' }
    expect((await call('maybe')).status).toBe(400)
    h.decide.mockResolvedValue({ ok: false, status: 410, error: 'expired' })
    const res = await call('apply')
    expect(res.status).toBe(410)
    expect((await res.json()).error).toMatch(/устарело/)
  })
})
