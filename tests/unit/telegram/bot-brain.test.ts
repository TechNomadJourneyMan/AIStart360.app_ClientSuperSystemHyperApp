/**
 * The bots' assistant (lib/telegram/brain), with a fake model port and a
 * recording Bot API:
 *   • model ↔ tools loop, step cap (last call without tools), fenced results;
 *   • tools filtered by role (crm_manager / super_admin / super_expert in the
 *     admin bot, SuperExpert / expert in the expert bot), PII gate, client scope;
 *   • propose → card → ✅ → shared function with the staff actor and audit;
 *     rights re-checked on ✅; ✖️ changes nothing; one card per answer;
 *   • voice / photo / document on stubs (getFile + download), attach the last
 *     file to a client through finalizeUpload;
 *   • memory window, /new; rate limit and budget; AI layer missing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffRole } from '@/lib/admin/rbac'
import type { BrainChatRequest, BrainChatResult, BrainLlm } from '@/lib/telegram/brain/llm-port'
import { buttonData, formFields, msg, press, testDeps, TG_USER } from './_bot-harness'

const CLIENT = '11111111-2222-4333-8444-555555555555'
const OTHER = '66666666-2222-4333-8444-555555555555'
const STAFF_ID = 'b0b0b0b0-0000-4000-8000-000000000001'
const APPROVAL = '22222222-3333-4444-8555-666666666666'
const TASK = '33333333-4444-4555-8666-777777777777'

const s = vi.hoisted(() => ({ role: 'super_admin' as StaffRole | null }))
vi.mock('@/lib/telegram/staff-link', () => ({
  STAFF_START_PREFIX: 'staff_',
  staffByTelegramUser: async () => (s.role ? { userId: 'b0b0b0b0-0000-4000-8000-000000000001', role: s.role, email: 'boss@aistart360.test' } : null),
  consumeStaffLinkCode: vi.fn(),
}))
vi.mock('@/lib/telegram/bots/expert/link', () => ({
  EXPERT_START_PREFIX: 'expert_',
  consumeExpertLinkCode: vi.fn(),
  expertByTelegramUser: async () => ({ userId: 'e0e0e0e0-0000-4000-8000-000000000001', role: 'super_expert', email: 'exp@aistart360.test', name: 'Эксперт' }),
}))

const db = vi.hoisted(() => ({ query: vi.fn(async (_sql: string, _values: unknown[]): Promise<unknown[]> => []) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => db.query(strings.join('?'), values),
    $executeRaw: vi.fn(async () => 1),
  },
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))

const card = vi.hoisted(() => ({
  client: { id: '11111111-2222-4333-8444-555555555555', email: 'client@corp.kz', full_name: 'Айгерим', role: 'client', status: 'approved', organization: null, created_at: new Date('2026-09-01'), phone: '+77010000000', last_seen_at: null, staff_role: null, company_id: 'co-1', company_name: 'ТОО Ромашка' },
}))
const data = vi.hoisted(() => ({
  userCard: vi.fn(async (id: string) => (id === '11111111-2222-4333-8444-555555555555' || id === '66666666-2222-4333-8444-555555555555' ? { ...card.client, id } : null)),
  pendingRegistrations: vi.fn(async () => ({ items: [{ user_id: '77777777-2222-4333-8444-555555555555', request_id: 'r1', email: 'new.person@corp.kz', full_name: 'Новый', organization: 'ТОО', created_at: new Date('2026-10-07') }], hasMore: false })),
  searchUsers: vi.fn(async () => ({ items: [], hasMore: false })),
  searchCompanies: vi.fn(async () => ({ items: [], hasMore: false })),
  companyCard: vi.fn(async () => null),
  recentSessions: vi.fn(async () => ({ items: [], hasMore: false })),
  statusCounts: vi.fn(), lastFailures: vi.fn(async () => []),
}))
vi.mock('@/lib/telegram/bots/data', () => data)

const mcpData = vi.hoisted(() => ({
  searchClients: vi.fn(async (p: { pii: boolean }) => ({
    items: [
      { company_id: 'co-1', company_name: 'ТОО Ромашка', owner: { user_id: '11111111-2222-4333-8444-555555555555', full_name: 'Айгерим', email: p.pii ? 'client@corp.kz' : 'c***@corp.kz', status: 'approved' }, overall_score: 61 },
      { company_id: 'co-2', company_name: 'ТОО Чужая', owner: { user_id: '66666666-2222-4333-8444-555555555555', full_name: 'Пётр', email: null, status: 'approved' }, overall_score: 40 },
    ],
    hasMore: false,
  })),
}))
vi.mock('@/lib/mcp/data', async () => {
  const real = await vi.importActual<typeof import('@/lib/mcp/data')>('@/lib/mcp/data')
  return { ...real, searchClients: mcpData.searchClients, clientCompanyExists: async () => true }
})

const actions = vi.hoisted(() => ({
  addClientNote: vi.fn(async (a: { userId: string; audit: (e: Record<string, unknown>) => Promise<boolean> }) => {
    await a.audit({ action: 'user.note_added', entityType: 'user', entityId: a.userId, targetUserId: a.userId })
    return { ok: true, note: { id: 'n1' } }
  }),
  createClientTask: vi.fn(async () => ({ ok: true, task: { id: 't1' } })),
  setClientAssignment: vi.fn(async () => ({ ok: true })),
  sendSurveyReminder: vi.fn(async () => ({ ok: true, completedSteps: 3, missingSections: [] })),
}))
vi.mock('@/lib/admin/client-actions', () => actions)
const access = vi.hoisted(() => ({ decideAccessRequest: vi.fn(async () => ({ ok: true, status: 'approved', userId: 'x' })) }))
vi.mock('@/lib/users/access-requests', () => access)
const approvals = vi.hoisted(() => ({ decideApproval: vi.fn(async () => ({ ok: true, status: 'approved', taskId: 't', agentKey: 'a', summary: 'Отправить письмо' })) }))
vi.mock('@/lib/agents/approvals', () => approvals)
const staffActions = vi.hoisted(() => ({
  agentTaskAction: vi.fn(async () => ({ ok: true })),
  runAgentManually: vi.fn(), updateAgentConfigAudited: vi.fn(), transitionReportVersion: vi.fn(), reviewAiItem: vi.fn(),
  REPORT_WRONG_STATUS: { publish: '', reject: '', withdraw: '' },
}))
vi.mock('@/lib/admin/staff-actions', () => staffActions)
vi.mock('@/lib/notifications/approval-cards', () => ({ closeApprovalCards: vi.fn(async () => 0) }))
vi.mock('@/lib/agents/admin', () => ({
  listAgentOverviews: async () => [],
  listTasks: async () => ({ items: [], nextCursor: null }),
  listApprovals: async () => [],
  getTaskDetail: async () => null,
  parseTaskCursor: () => null,
}))

const { adminRouter } = await import('@/lib/telegram/bots/admin')
const { expertRouter } = await import('@/lib/telegram/bots/expert')
const { handleUpdate } = await import('@/lib/telegram/bots/dispatcher')
const { __setBrainDeps, adminRole, expertRole, BRAIN_RATE_LIMITED_TEXT, BRAIN_BUDGET_TEXT } = await import('@/lib/telegram/brain')
const { memoryBrainMemory, MEMORY_MESSAGES } = await import('@/lib/telegram/brain/memory')
const { toolsFor, mcpScopesFor } = await import('@/lib/telegram/brain/toolset')
const { runToolCall, MAX_STEPS, pickTier } = await import('@/lib/telegram/brain/engine')
const { ALL_CLIENTS } = await import('@/lib/telegram/brain/scope')
const { defaultBrainLlm } = await import('@/lib/telegram/brain/llm-port')
const { processWebhook } = await import('@/lib/telegram/bots/webhook')
const { deferOrAwait } = await import('@/lib/telegram/bots/defer')

// ─── Fakes ───────────────────────────────────────────────────────────────────

type Step = (req: BrainChatRequest) => BrainChatResult
const say = (content: string): Step => () => ({ ok: true, message: { content, tool_calls: [] } })
let callSeq = 0
const call = (name: string, args: Record<string, unknown> = {}): Step => () => ({
  ok: true, message: { content: null, tool_calls: [{ id: `c${++callSeq}`, name, arguments: JSON.stringify(args) }] },
})

function fakeLlm(script: Step[] = []) {
  const requests: BrainChatRequest[] = []
  const llm: BrainLlm & { requests: BrainChatRequest[]; script: Step[] } = {
    requests,
    script,
    chat: vi.fn(async (req: BrainChatRequest) => {
      requests.push(JSON.parse(JSON.stringify(req)))
      const step = script.shift()
      return step ? step(req) : { ok: true as const, message: { content: 'Готово.', tool_calls: [] } }
    }),
    transcribe: vi.fn(async () => ({ ok: true as const, text: 'Сколько новых заявок?' })),
    describeImage: vi.fn(async () => ({ ok: true as const, text: 'На фото — отчёт о продажах: выручка **120 млн** ₸.' })),
    withinBudget: vi.fn(async () => true),
  }
  return llm
}

const FILES: Record<string, { path: string; bytes: Buffer }> = {
  'voice-1': { path: 'voice/file_1.oga', bytes: Buffer.from('OggS-fake-audio') },
  'photo-big': { path: 'photos/file_2.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) },
  'doc-1': { path: 'documents/file_3.csv', bytes: Buffer.from('month,revenue\nсентябрь,120000000\nоктябрь,95000000\n') },
}

/** Bot API + file downloads, recorded. */
function botApi() {
  const calls: Array<{ url: string; method: string; body: Record<string, any> }> = []
  let mid = 2000
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/file/bot')) {
      const f = Object.values(FILES).find((x) => u.endsWith(x.path))
      calls.push({ url: u, method: 'download', body: {} })
      return f ? new Response(new Uint8Array(f.bytes), { status: 200 }) : new Response('no', { status: 404 })
    }
    const method = u.split('/').pop()!
    const body = init?.body instanceof FormData ? formFields(init.body) : JSON.parse(String(init?.body ?? '{}'))
    calls.push({ url: u, method, body })
    if (method === 'getFile') {
      const f = FILES[body.file_id]
      return new Response(JSON.stringify(f ? { ok: true, result: { file_id: body.file_id, file_size: f.bytes.length, file_path: f.path } } : { ok: false, description: 'Bad Request: invalid file_id' }), { status: f ? 200 : 400 })
    }
    return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: ++mid } : true }), { status: 200 })
  }) as unknown as typeof fetch
  const texts = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => String(c.body.text))
  return {
    fetchImpl,
    calls,
    texts,
    lastText: () => texts().at(-1) ?? '',
    lastButtons: () => (calls.filter((c) => c.body.reply_markup?.inline_keyboard).at(-1)?.body.reply_markup.inline_keyboard ?? []).flat() as Array<{ text: string; callback_data?: string }>,
  }
}

const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_EXPERT_BOT_TOKEN', 'TELEGRAM_EXPERT_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET']
const saved: Record<string, string | undefined> = {}

describe('bot assistant', () => {
  let api = botApi()
  let h = testDeps(api.fetchImpl)
  let llm = fakeLlm()
  let memory = memoryBrainMemory()
  const rateLimit = vi.fn(async () => false)
  const attach = {
    upload: vi.fn(async () => {}),
    companyOf: vi.fn(async () => 'co-1'),
    finalize: {
      storage: { download: vi.fn(async () => FILES['doc-1'].bytes), remove: vi.fn(async () => {}), signedUrl: vi.fn(async () => null) },
      findDuplicate: vi.fn(async () => null),
      insertDocument: vi.fn(async (row: Record<string, unknown>) => ({ id: 'doc-row-1', file_name: row.fileName, company_id: row.companyId, doc_type: row.docType }) as never),
      emit: vi.fn(),
    },
  }
  const admin = (u: Parameters<typeof handleUpdate>[1]) => handleUpdate(adminRouter(), u, h.deps)
  const expert = (u: Parameters<typeof handleUpdate>[1]) => handleUpdate(expertRouter(), u, h.deps)

  beforeAll(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token-SECRET'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.TELEGRAM_EXPERT_BOT_TOKEN = 'expert-token-SECRET'
    process.env.TELEGRAM_EXPERT_WEBHOOK_SECRET = 'expert-secret'
    delete process.env.TELEGRAM_CALLBACK_SECRET
  })
  afterAll(() => {
    __setBrainDeps(null)
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    s.role = 'super_admin'
    api = botApi()
    h = testDeps(api.fetchImpl)
    llm = fakeLlm()
    memory = memoryBrainMemory()
    rateLimit.mockReset().mockResolvedValue(false)
    db.query.mockReset().mockResolvedValue([])
    for (const f of [...Object.values(actions), access.decideAccessRequest, approvals.decideApproval, staffActions.agentTaskAction, mcpData.searchClients, attach.upload, attach.finalize.insertDocument, attach.finalize.emit]) f.mockClear()
    __setBrainDeps({ llm, memory, rateLimit, scope: async () => ALL_CLIENTS, now: () => new Date('2026-10-08T07:00:00Z'), attach: () => attach as never })
  })

  // ─── Loop ──────────────────────────────────────────────────────────────────

  it('free text → model → tool → model → answer; results fenced; memory kept', async () => {
    llm.script.push(call('list_access_requests', { limit: 5 }), say('Есть **1** новая заявка: Новый (ТОО).'))
    expect(await admin(msg('Кто ждёт доступа?'))).toBe('brain')

    expect(llm.requests).toHaveLength(2)
    const first = llm.requests[0]
    expect(first.feature).toBe('bot_assistant')
    expect(first.tier).toBe('light')
    expect(first.messages[0].role).toBe('system')
    expect(String(first.messages[0].content)).toContain('Алматы')
    expect(String(first.messages[0].content)).toContain('<untrusted_*>')
    expect(first.tools.map((t) => t.function.name)).toContain('list_access_requests')
    const toolMsg = llm.requests[1].messages.find((m) => m.role === 'tool')!
    expect(String(toolMsg.content)).toMatch(/^<untrusted_tool_result>[\s\S]*new\.person@corp\.kz[\s\S]*<\/untrusted_tool_result>$/)

    expect(api.lastText()).toBe('Есть <b>1</b> новая заявка: Новый (ТОО).')
    expect(api.calls.some((c) => c.method === 'sendChatAction' && c.body.action === 'typing')).toBe(true)
    expect(await memory.load('admin', String(TG_USER.id))).toEqual([
      { role: 'user', content: 'Кто ждёт доступа?' },
      { role: 'assistant', content: 'Есть **1** новая заявка: Новый (ТОО).' },
    ])
  })

  it('stops after MAX_STEPS model calls; the last one has no tools', async () => {
    llm.chat = vi.fn(async (req: BrainChatRequest) => {
      llm.requests.push(req)
      return { ok: true as const, message: { content: null, tool_calls: [{ id: `x${llm.requests.length}`, name: 'list_access_requests', arguments: '{}' }] } }
    })
    await admin(msg('Проанализируй всё подряд'))
    expect(llm.requests).toHaveLength(MAX_STEPS)
    expect(llm.requests.at(-1)!.tools).toEqual([])
    expect(llm.requests.at(-1)!.toolChoice).toBe('none')
    expect(llm.requests[0].tier).toBe('standard')
    expect(api.lastText()).toContain('Не удалось собрать ответ')
  })

  it('menus, commands and pending steps still win over the assistant; a pasted key is deleted, never sent to the model', async () => {
    expect(await admin(msg('/help'))).toBe('command')
    expect(await admin(msg('sk-or-v1-0123456789abcdef0123456789abcdef'))).toBe('brain')
    expect(api.calls.some((c) => c.method === 'deleteMessage')).toBe(true)
    expect(api.lastText()).toContain('Похоже на ключ')
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('a model error or a missing AI layer is a Russian message, never raw text', async () => {
    llm.script.push(() => ({ ok: false, code: 'AI_UNAVAILABLE', message: 'Error: connect ECONNREFUSED 10.0.0.1 key=sk-123' }))
    await admin(msg('Привет'))
    expect(api.lastText()).toContain('ИИ временно недоступен')
    expect(api.texts().join(' ')).not.toContain('ECONNREFUSED')
    // The real binding before the AI layer is merged: lib/ai/tools-chat does not exist.
    expect(await defaultBrainLlm.chat({ feature: 'bot_assistant', label: 't', userId: STAFF_ID, tier: 'light', messages: [], tools: [], timeoutMs: 1000 }))
      .toMatchObject({ ok: false, code: 'AI_UNAVAILABLE' })
  })

  it('tier: light for short questions, standard for analysis or documents', () => {
    expect(pickTier('Сколько заявок?')).toBe('light')
    expect(pickTier('Сравни динамику клиентов за месяц')).toBe('standard')
    expect(pickTier('ok', { document: true })).toBe('standard')
  })

  // ─── Roles, PII, scope ─────────────────────────────────────────────────────

  const names = (role: ReturnType<typeof adminRole>) => toolsFor(role).map((t) => t.name)
  const staff = (r: StaffRole) => adminRole({ userId: STAFF_ID, role: r, email: 'x@aistart360.test' })

  it('tools follow the role: super_admin, crm_manager, super_expert (admin bot) and the expert bot', () => {
    const sa = names(staff('super_admin'))
    expect(sa).toEqual(expect.arrayContaining(['search_clients', 'get_ai_spend', 'list_agent_tasks', 'list_agents', 'propose_retry_task', 'propose_approval_decision', 'propose_attach_file', 'list_platform_events']))

    const crm = names(staff('crm_manager'))
    expect(crm).toEqual(expect.arrayContaining(['propose_access_decision', 'propose_note', 'propose_survey_reminder', 'list_agent_tasks', 'get_ai_spend', 'list_stuck_on_survey']))
    expect(crm).not.toContain('propose_retry_task')
    expect(crm).not.toContain('propose_approval_decision')

    const se = names(staff('super_expert'))
    expect(se).toEqual(expect.arrayContaining(['search_clients', 'analyze_client', 'propose_access_decision', 'propose_note']))
    for (const n of ['list_agents', 'list_agent_tasks', 'get_ai_spend', 'propose_retry_task', 'list_pending_approvals']) expect(se).not.toContain(n)

    const analyst = names(staff('analyst'))
    expect(analyst).not.toContain('propose_note')
    expect(mcpScopesFor(staff('analyst'))).not.toContain('clients:pii')

    const content = names(staff('content_manager'))
    expect(content.filter((n) => n !== 'list_platform_events')).toEqual([])

    const ex = toolsFor(expertRole({ userId: 'e0e0e0e0-0000-4000-8000-000000000001', role: 'super_expert', email: null, name: null })).map((t) => t.name)
    expect(ex).toEqual(expect.arrayContaining(['search_clients', 'get_client', 'get_point_a', 'analyze_client', 'list_reports_in_review', 'get_report_version']))
    expect(ex.some((n) => n.startsWith('propose_'))).toBe(false)
    for (const n of ['list_agent_tasks', 'get_ai_spend', 'list_access_requests', 'find_users']) expect(ex).not.toContain(n)
    const plainExpert = toolsFor(expertRole({ userId: 'e0e0e0e0-0000-4000-8000-000000000002', role: 'expert', email: null, name: null })).map((t) => t.name)
    expect(plainExpert).toEqual(expect.arrayContaining(['search_clients', 'analyze_client']))
  })

  const runCtx = (role: ReturnType<typeof adminRole>, extra: Partial<Parameters<typeof runToolCall>[2]> = {}) => {
    const scopes = mcpScopesFor(role)
    return {
      role, scope: ALL_CLIENTS, pii: scopes.includes('clients:pii'), mcpScopes: scopes, now: new Date('2026-10-08T07:00:00Z'),
      ctx: {} as never, deps: {} as never, turn: { proposed: false, file: null }, ...extra,
    }
  }
  const exec = (name: string, args: unknown, role: ReturnType<typeof adminRole>, extra = {}) =>
    runToolCall({ id: 'c', name, arguments: JSON.stringify(args) }, toolsFor(role), runCtx(role, extra))

  it('PII gate: contacts unmasked only with users.sensitive', async () => {
    await exec('search_clients', { query: 'Ромашка' }, staff('analyst'))
    expect(mcpData.searchClients.mock.calls.at(-1)![0]).toMatchObject({ pii: false })
    await exec('search_clients', { query: 'Ромашка' }, staff('crm_manager'))
    expect(mcpData.searchClients.mock.calls.at(-1)![0]).toMatchObject({ pii: true })

    const masked = await exec('list_access_requests', {}, staff('analyst'))
    expect(masked).not.toContain('new.person@corp.kz')
    expect(masked).toContain('@corp.kz')
    expect(await exec('list_access_requests', {}, staff('crm_manager'))).toContain('new.person@corp.kz')

    expect(await exec('find_users', { query: 'client@corp.kz' }, staff('analyst'))).toContain('только с правом на контакты')
    expect(data.searchUsers).not.toHaveBeenCalled()
  })

  it('a tool outside the role is refused even if the model calls it; the client scope applies', async () => {
    expect(await exec('propose_retry_task', { task_id: TASK }, staff('crm_manager'))).toContain('недоступен для вашей роли')
    expect(await exec('get_ai_spend', {}, staff('super_expert'))).toContain('недоступен для вашей роли')

    const assigned = { kind: 'assigned' as const, userIds: new Set([CLIENT]), companyIds: new Set(['co-1']) }
    const res = await exec('search_clients', {}, staff('support'), { scope: assigned })
    expect(res).toContain('ТОО Ромашка')
    expect(res).not.toContain('ТОО Чужая')
    expect(await exec('get_client', { user_id: OTHER }, staff('support'), { scope: assigned })).toContain('Клиент вам не назначен')
    expect(await exec('get_point_a', { company_id: 'co-2' }, staff('support'), { scope: assigned })).toContain('Клиент вам не назначен')
  })

  // ─── Actions ───────────────────────────────────────────────────────────────

  it('propose → card; nothing runs before ✅; ✅ runs the shared function as the staff member, audited', async () => {
    llm.script.push(call('propose_note', { user_id: CLIENT, body: 'Перезвонить после 15:00' }), say('лишний ответ'))
    await admin(msg('Добавь заметку Айгерим: перезвонить после 15:00'))
    expect(llm.requests).toHaveLength(1) // the card ends the turn
    expect(api.lastText()).toContain('Заметка о клиенте <b>Айгерим</b>')
    expect(api.lastText()).toContain('Перезвонить после 15:00')
    expect(actions.addClientNote).not.toHaveBeenCalled()

    const ok = buttonData(api.lastButtons(), 'Подтвердить')
    expect(await admin(press(ok))).toBe('confirmed')
    expect(actions.addClientNote).toHaveBeenCalledTimes(1)
    expect(actions.addClientNote.mock.calls[0][0]).toMatchObject({ userId: CLIENT, body: 'Перезвонить после 15:00', author: { id: STAFF_ID, role: 'super_admin' } })
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ id: STAFF_ID, kind: 'telegram', role: 'super_admin' }),
      expect.objectContaining({ action: 'user.note_added', metadata: expect.objectContaining({ via: 'telegram' }) }),
      undefined,
    )
    expect(api.lastText()).toContain('Заметка сохранена')
    // The nonce is single-use: a second press executes nothing.
    expect(await admin(press(ok))).toBe('confirm_expired')
    expect(actions.addClientNote).toHaveBeenCalledTimes(1)
  })

  it('rights are re-checked on ✅: a role narrowed after the card cannot execute', async () => {
    llm.script.push(call('propose_note', { user_id: CLIENT, body: 'Важно' }))
    await admin(msg('Заметка: важно'))
    const ok = buttonData(api.lastButtons(), 'Подтвердить')
    s.role = 'analyst'
    await admin(press(ok))
    expect(actions.addClientNote).not.toHaveBeenCalled()
    expect(api.lastText()).toContain('Недостаточно прав')
  })

  it('✖️ cancels: nothing is executed', async () => {
    llm.script.push(call('propose_access_decision', { user_id: CLIENT, decision: 'reject', reason: 'Дубликат' }))
    data.userCard.mockResolvedValueOnce({ ...card.client, status: 'pending_approval' })
    await admin(msg('Отклони заявку Айгерим, это дубликат'))
    expect(api.lastText()).toContain('Отклонить заявку')
    expect(await admin(press(buttonData(api.lastButtons(), 'Отмена')))).toBe('cancelled')
    expect(access.decideAccessRequest).not.toHaveBeenCalled()
    expect(api.lastText()).toContain('отменено')
  })

  it('access decision: required audit first, then decideAccessRequest with the staff actor', async () => {
    llm.script.push(call('propose_access_decision', { user_id: CLIENT, decision: 'approve' }))
    data.userCard.mockResolvedValueOnce({ ...card.client, status: 'pending_approval' })
    await admin(msg('Одобри Айгерим'))
    await admin(press(buttonData(api.lastButtons(), 'Подтвердить')))
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ id: STAFF_ID, kind: 'telegram' }), expect.objectContaining({ action: 'request.approve', targetUserId: CLIENT }), { required: true })
    expect(access.decideAccessRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'approve', actor: { id: STAFF_ID, kind: 'telegram' } }))
    expect(h.audit.mock.invocationCallOrder[0]).toBeLessThan(access.decideAccessRequest.mock.invocationCallOrder[0])
  })

  it('agent approval and task retry go through decideApproval / agentTaskAction', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.agent_approvals')) return [{ agent_key: 'outreach', summary: 'Отправить письмо клиенту', status: 'pending', company_name: 'ТОО Ромашка', expires_at: new Date('2026-10-09') }]
      if (sql.includes('FROM public.agent_tasks')) return [{ agent_key: 'report', status: 'failed', last_error_code: 'MODEL_TIMEOUT', company_name: null }]
      return []
    })
    llm.script.push(call('propose_approval_decision', { approval_id: APPROVAL, decision: 'approve' }))
    await admin(msg('Одобри письмо агента'))
    await admin(press(buttonData(api.lastButtons(), 'Подтвердить')))
    expect(approvals.decideApproval).toHaveBeenCalledWith({ approvalId: APPROVAL, decision: 'approve', actorId: STAFF_ID, via: 'telegram' })

    llm.script.push(call('propose_retry_task', { task_id: TASK }))
    await admin(msg('Перезапусти упавшую задачу'))
    expect(api.lastText()).toContain('MODEL_TIMEOUT')
    await admin(press(buttonData(api.lastButtons(), 'Подтвердить')))
    expect(staffActions.agentTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: TASK, action: 'retry', actorId: STAFF_ID }))
  })

  it('only one card per answer', async () => {
    llm.chat = vi.fn(async (req: BrainChatRequest) => {
      llm.requests.push(JSON.parse(JSON.stringify(req)))
      return { ok: true as const, message: { content: null, tool_calls: [
        { id: 'a', name: 'propose_note', arguments: JSON.stringify({ user_id: CLIENT, body: 'Первая' }) },
        { id: 'b', name: 'propose_note', arguments: JSON.stringify({ user_id: CLIENT, body: 'Вторая' }) },
      ] } }
    })
    await admin(msg('Две заметки'))
    const cards = api.texts().filter((t) => t.includes('Заметка о клиенте'))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toContain('Первая')
  })

  // ─── Media ─────────────────────────────────────────────────────────────────

  it('voice: getFile → transcription shown as «🎙 …» → answered as a question; the token never reaches the chat', async () => {
    llm.script.push(say('Новых заявок: 1.'))
    const out = await admin(msg('', TG_USER, { text: undefined, voice: { file_id: 'voice-1', file_size: 15, duration: 2, mime_type: 'audio/ogg' } }))
    expect(out).toBe('brain')
    expect(llm.transcribe).toHaveBeenCalledWith(expect.objectContaining({ bytes: FILES['voice-1'].bytes, mime: 'audio/ogg' }))
    expect(api.texts()).toContain('🎙 Сколько новых заявок?')
    expect(llm.requests[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'Сколько новых заявок?' })
    expect(api.lastText()).toBe('Новых заявок: 1.')
    for (const c of api.calls.filter((x) => x.method !== 'download' && x.method !== 'getFile')) expect(JSON.stringify(c.body)).not.toContain('SECRET')
  })

  it('photo without a caption: the vision description is the answer; the largest size is used', async () => {
    await admin(msg('', TG_USER, { text: undefined, photo: [{ file_id: 'photo-small', file_size: 3, width: 90, height: 90 }, { file_id: 'photo-big', file_size: 8, width: 1280, height: 960 }] }))
    expect(llm.describeImage).toHaveBeenCalledWith(expect.objectContaining({ dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/) }))
    expect(api.calls.find((c) => c.method === 'getFile')!.body.file_id).toBe('photo-big')
    expect(llm.chat).not.toHaveBeenCalled()
    expect(api.lastText()).toContain('<b>120 млн</b>')
  })

  it('document: preflight + text extraction → fenced context for the model; then attach it to a client via finalizeUpload', async () => {
    llm.script.push(say('В сентябре выручка 120 млн, в октябре 95 млн.'))
    await admin(msg('', TG_USER, { text: undefined, caption: 'Что с выручкой?', document: { file_id: 'doc-1', file_name: 'sales.csv', mime_type: 'text/csv', file_size: 60 } }))
    const user = llm.requests[0].messages.at(-1)!
    expect(String(user.content)).toContain('Что с выручкой?')
    expect(String(user.content)).toMatch(/<untrusted_document>[\s\S]*120000000[\s\S]*<\/untrusted_document>/)
    expect(llm.requests[0].tier).toBe('standard')

    llm.script.push(call('propose_attach_file', { user_id: CLIENT, doc_type: 'sales_report' }))
    await admin(msg('Прикрепи этот файл к Айгерим'))
    expect(api.lastText()).toContain('Прикрепить файл <b>sales.csv</b>')
    await admin(press(buttonData(api.lastButtons(), 'Подтвердить')))
    expect(attach.upload).toHaveBeenCalledTimes(1)
    const [loc] = attach.upload.mock.calls[0] as unknown as [{ bucket: string; path: string }]
    expect(loc.bucket).toBe('client-documents')
    expect(loc.path.startsWith(`${CLIENT}/telegram/`)).toBe(true)
    expect(attach.finalize.insertDocument).toHaveBeenCalledWith(expect.objectContaining({ userId: CLIENT, companyId: 'co-1', docType: 'sales_report', fileName: 'sales.csv' }))
    expect(attach.finalize.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'FILE_UPLOADED' }))
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'document.attach_via_bot' }), { required: true })
    expect(api.lastText()).toContain('прикреплён к клиенту')
  })

  it('a rejected document is refused with the preflight reason; nothing goes to the model', async () => {
    FILES['doc-bad'] = { path: 'documents/evil.exe', bytes: Buffer.from('MZ\x90\x00binary') }
    await admin(msg('', TG_USER, { text: undefined, document: { file_id: 'doc-bad', file_name: 'evil.exe', file_size: 10 } }))
    expect(api.lastText()).toContain('не принят')
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('a file over 20 MB is refused before downloading', async () => {
    await admin(msg('', TG_USER, { text: undefined, document: { file_id: 'doc-1', file_name: 'big.pdf', file_size: 25 * 1024 * 1024 } }))
    expect(api.calls.some((c) => c.method === 'getFile')).toBe(false)
    expect(api.lastText()).toContain('больше 20 МБ')
  })

  // ─── Memory, /new, guards ──────────────────────────────────────────────────

  it('memory replays the window and /new clears it', async () => {
    llm.script.push(say('Первый ответ'))
    await admin(msg('Первый вопрос'))
    llm.script.push(say('Второй ответ'))
    await admin(msg('Второй вопрос'))
    expect(llm.requests[1].messages.map((m) => m.content)).toEqual(expect.arrayContaining(['Первый вопрос', 'Первый ответ', 'Второй вопрос']))

    expect(await admin(msg('/new'))).toBe('command')
    expect(api.lastText()).toContain('Начинаем заново')
    llm.script.push(say('Третий'))
    await admin(msg('Третий вопрос'))
    expect(llm.requests[2].messages.filter((m) => m.role !== 'system')).toEqual([{ role: 'user', content: 'Третий вопрос' }])

    const m = memoryBrainMemory()
    for (let i = 0; i < 30; i++) await m.append('admin', '1', null, [{ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }])
    const window = await m.load('admin', '1')
    expect(window).toHaveLength(MEMORY_MESSAGES)
    expect(window.at(-1)!.content).toBe('m29')
    let now = new Date('2026-10-08T00:00:00Z')
    const aged = memoryBrainMemory(() => now)
    await aged.append('admin', '1', null, [{ role: 'user', content: 'old' }])
    now = new Date('2026-10-09T01:00:00Z')
    expect(await aged.load('admin', '1')).toEqual([])
  })

  it('rate limit and personal budget stop the turn before the model', async () => {
    rateLimit.mockResolvedValueOnce(true)
    await admin(msg('Вопрос'))
    expect(api.lastText()).toBe(BRAIN_RATE_LIMITED_TEXT)
    expect(rateLimit).toHaveBeenCalledWith(`admin:${TG_USER.id}`)
    ;(llm.withinBudget as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    await admin(msg('Вопрос'))
    expect(api.lastText()).toBe(BRAIN_BUDGET_TEXT)
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('expert bot: free text goes to the assistant with client tools only', async () => {
    llm.script.push(say('Черновик комментария: …'))
    expect(await expert(msg('Подготовь черновик комментария для Ромашки'))).toBe('brain')
    const offered = llm.requests[0].tools.map((t) => t.function.name)
    expect(offered).toContain('analyze_client')
    expect(offered.some((n) => n.startsWith('propose_'))).toBe(false)
    expect(String(llm.requests[0].messages[0].content)).toContain('эксперта')
  })

  // ─── Async webhook ─────────────────────────────────────────────────────────

  it('webhook answers 200 before the update is processed (waitUntil), after secret check and dedupe', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const handled = vi.fn()
    const router = {
      bot: 'admin' as const, resolve: async () => ({ userId: STAFF_ID }), authorize: () => true, unlinkedText: '',
      welcome: async () => { await gate; handled() },
      commands: {}, menu: {}, callbacks: {}, confirmed: {}, steps: {},
    }
    let deferred: Promise<unknown> | null = null
    const res = await processWebhook({
      bot: 'admin',
      headers: new Headers({ 'x-telegram-bot-api-secret-token': 'admin-secret' }),
      body: async () => ({ update_id: 9001, message: { message_id: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: '/x' } }),
      router: () => router,
      deps: h.deps,
      seen: async () => true,
      defer: async (work) => { deferred = work; return 'deferred' },
    })
    expect(res).toEqual({ status: 200, outcome: 'accepted' })
    expect(handled).not.toHaveBeenCalled()
    release()
    await deferred
    expect(handled).toHaveBeenCalledTimes(1)

    const bad = await processWebhook({ bot: 'admin', headers: new Headers({ 'x-telegram-bot-api-secret-token': 'nope' }), body: async () => ({}), router: () => router, deps: h.deps, defer: async () => 'deferred' })
    expect(bad.status).toBe(401)
  })

  it('deferOrAwait: waitUntil on Vercel, await elsewhere', async () => {
    const work = vi.fn(async () => {})
    expect(await deferOrAwait(work())).toBe('awaited')
    const waitUntil = vi.fn()
    const key = Symbol.for('@vercel/request-context')
    const g = globalThis as Record<symbol, unknown>
    const before = g[key]
    g[key] = { get: () => ({ waitUntil }) }
    try {
      expect(await deferOrAwait(Promise.reject(new Error('boom')))).toBe('deferred')
      expect(waitUntil).toHaveBeenCalledTimes(1)
    } finally {
      g[key] = before
    }
  })
})
