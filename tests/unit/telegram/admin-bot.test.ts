/**
 * Admin bot (lib/telegram/bots/admin): access, per-action rbac permissions
 * (the same as the GIGA routes), confirmation of destructive actions, key
 * messages deleted before the key is stored and only the mask echoed,
 * budgets, rate limit, tampered buttons. Services are stubbed; the Telegram
 * Bot API is a recording fetch.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffRole } from '@/lib/admin/rbac'
import { buttonData, msg, press, recordingFetch, testDeps, TG_USER } from './_bot-harness'

const s = vi.hoisted(() => ({ role: 'super_admin' as StaffRole | null }))
const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
const USER = '11111111-2222-4333-8444-555555555555'
const PROVIDER = '99999999-8888-4777-8666-555555555555'
const CRED = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

vi.mock('@/lib/telegram/staff-link', () => ({
  STAFF_START_PREFIX: 'staff_',
  staffByTelegramUser: async () => (s.role ? { userId: 'b0b0b0b0-0000-4000-8000-000000000001', role: s.role, email: 'boss@aistart360.test' } : null),
  consumeStaffLinkCode: vi.fn(async () => ({ ok: true, userId: 'x' })),
}))

const actions = vi.hoisted(() => ({
  runAgentManually: vi.fn(async () => ({ ok: true, taskId: '12345678-0000-4000-8000-000000000000' })),
  agentTaskAction: vi.fn(async () => ({ ok: true })),
  updateAgentConfigAudited: vi.fn(async () => ({ ok: true })),
  transitionReportVersion: vi.fn(async () => ({ ok: true, status: 'published', superseded: [], companyId: 'co', reportType: 'point_a', version: 2, title: 'Отчёт' })),
  reviewAiItem: vi.fn(async () => ({ ok: true, item: {} })),
}))
vi.mock('@/lib/admin/staff-actions', () => ({ ...actions, REPORT_WRONG_STATUS: { publish: 'нельзя', reject: 'нельзя', withdraw: 'нельзя' } }))

const overview = {
  key: 'monitoring', name: 'Мониторинг платформы', description: 'Проверки', version: '1', scope: 'platform', enabled: true,
  tier: 'none', model: null, promptVersion: null, tools: [], triggers: { events: [], cron: null }, nextRunAt: null,
  limits: { perRunBudgetUsd: 0, dailyBudgetUsd: 0, maxOutputTokens: 0, maxAttempts: 3 }, permissions: {},
  stats: { runs7d: 4, succeeded7d: 4, failed7d: 0, successRate: 1, errorRate: 0, avgDurationMs: 10, tokensIn7d: 0, tokensOut7d: 0, costUsd7d: 0, costUsdToday: 0, queued: 0, running: 0, awaitingApproval: 0, dead24h: 0, lastRunAt: null, lastRunStatus: null },
}
vi.mock('@/lib/agents/admin', () => ({
  listAgentOverviews: async () => [overview],
  listTasks: async () => ({ items: [], nextCursor: null }),
  getTaskDetail: async () => ({ task: { id: UUID, agent_key: 'monitoring', status: 'queued', attempts: 0, max_attempts: 3, trigger: 'manual', created_at: new Date() }, runs: [], toolCalls: [], events: [], approvals: [] }),
  listApprovals: async () => [],
}))
vi.mock('@/lib/agents/registry', () => ({
  listAgents: () => [{ key: 'monitoring', name: 'Мониторинг платформы', scope: 'platform' }, { key: 'diagnostic_orchestrator', name: 'Оркестратор', scope: 'company' }],
  getAgent: (k: string) => ({ key: k }),
}))
const access = vi.hoisted(() => ({ decideAccessRequest: vi.fn(async () => ({ ok: true, status: 'approved', userId: 'x' })) }))
vi.mock('@/lib/users/access-requests', () => access)
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn(async () => []), $executeRaw: vi.fn(async () => 1) } }))
vi.mock('@/lib/agents/definitions/monitoring', () => ({ platformHealthSnapshot: async () => [] }))
vi.mock('@/lib/agents/store', () => ({ spendToday: async () => 1.5 }))
vi.mock('@/lib/telegram/bots/data', () => ({
  statusCounts: async () => ({ queued: 1, running: 0, awaitingApproval: 0, dead24h: 0, pendingApprovals: 2, pendingRegistrations: 3 }),
  lastFailures: async () => [],
  userCard: async () => ({ id: USER, email: 'client@corp.kz', full_name: 'Клиент', role: 'client', status: 'pending_approval', organization: null, created_at: new Date(), phone: '+77010000000', last_seen_at: null, staff_role: null, company_id: null, company_name: null }),
  pendingRegistrations: async () => ({ items: [], hasMore: false }),
  searchCompanies: async () => ({ items: [], hasMore: false }),
  companyCard: async () => null,
  recentSessions: async () => ({ items: [], hasMore: false }),
  searchUsers: async () => ({ items: [], hasMore: false }),
}))
vi.mock('@/lib/reports/versions', () => ({
  getReportVersion: async () => ({ id: UUID, title: 'Отчёт', version: 2, status: 'ready', company_id: 'co', company_name: 'Co', report_type: 'point_a' }),
  listReportVersions: async () => [],
}))
vi.mock('@/lib/reports/review', () => ({ listReviewQueue: async () => [] }))

const providers = vi.hoisted(() => {
  class ProviderServiceError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  }
  const cred = (hint: string) => ({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', provider_id: 'p', label: 'Telegram', secret_hint: hint, masked: `••••${hint}`, enabled: true, last_verified_at: null, last_verify_ok: null, last_verify_error: null, created_by: null, created_at: new Date(), rotated_at: null, updated_at: new Date() })
  return {
    ProviderServiceError,
    cred,
    listProviders: vi.fn(async () => []),
    getProvider: vi.fn(async () => null),
    addCredential: vi.fn(async (_a: unknown, _p: string, _l: string, secret: string) => cred(secret.slice(-4))),
    rotateCredential: vi.fn(async (_a: unknown, _id: string, secret: string) => cred(secret.slice(-4))),
    updateCredential: vi.fn(), deleteCredential: vi.fn(async () => ({ deleted: true })), verifyCredential: vi.fn(),
    createProvider: vi.fn(), updateProvider: vi.fn(), deleteProvider: vi.fn(), upsertModel: vi.fn(), setRoute: vi.fn(), listRoutes: vi.fn(async () => []),
    getBudgets: vi.fn(async () => ({ platform: { dailyUsd: 50, source: 'env', configured: null }, company: { dailyUsd: 5, source: 'env', configured: null }, providers: [], updatedBy: null, updatedAt: null })),
    setBudgets: vi.fn(async () => ({})),
    spendSummary: vi.fn(async () => ({ days: 1, groupBy: 'provider', totalUsd: 0, rows: [] })),
  }
})
vi.mock('@/lib/ai/providers/service', () => providers)

const { adminRouter, mainKeyboard } = await import('@/lib/telegram/bots/admin')
const { handleUpdate } = await import('@/lib/telegram/bots/dispatcher')
const { signCallback } = await import('@/lib/telegram/bots/callback')

const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET']
const saved: Record<string, string | undefined> = {}

describe('admin bot', () => {
  let tg = recordingFetch()
  let h = testDeps(tg.fetchImpl)
  const run = (u: Parameters<typeof handleUpdate>[1]) => handleUpdate(adminRouter(), u, h.deps)
  const btn = (action: string, ...args: string[]) => signCallback('admin', action, ...args)

  beforeAll(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    delete process.env.TELEGRAM_CALLBACK_SECRET
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    s.role = 'super_admin'
    tg = recordingFetch()
    h = testDeps(tg.fetchImpl)
    for (const f of Object.values(actions)) f.mockClear()
    access.decideAccessRequest.mockClear()
    providers.addCredential.mockClear()
    providers.rotateCredential.mockClear()
    providers.setBudgets.mockClear()
    providers.deleteCredential.mockClear()
  })

  it('refuses people who are not linked staff and sends them nowhere', async () => {
    s.role = null
    expect(await run(msg('📊 Статус'))).toBe('not_linked')
    expect(tg.lastText()).toContain('Доступ только после привязки')
    expect(await run(press(btn('ag.off', 'x')))).toBe('not_linked')
    expect(actions.updateAgentConfigAudited).not.toHaveBeenCalled()
  })

  it('uses the bot token of the admin bot and shows the menu the role may use', async () => {
    await run(msg('/start'))
    expect(tg.calls[0].url).toContain('/botadmin-token/sendMessage')
    const labels = (r: StaffRole) => JSON.stringify(mainKeyboard({ userId: 'u', role: r, email: null }))
    expect(labels('super_admin')).toContain('🔑 Провайдеры и ключи')
    expect(labels('admin')).toContain('🔑 Провайдеры и ключи') // viewing: agents.view; changes: settings.manage
    expect(labels('content_manager')).not.toContain('🔑 Провайдеры и ключи')
    expect(labels('analyst')).toContain('🤖 Агенты')
    expect(labels('analyst')).toContain('👤 Пользователи') // users.view
    expect(labels('analyst')).toContain('💸 Расходы') // agents.view
    expect(labels('content_manager')).not.toContain('🤖 Агенты')
    expect(labels('content_manager')).toContain('📄 Отчёты') // insights.moderate
  })

  it('status shows only the blocks the role may see', async () => {
    s.role = 'super_admin'
    await run(msg('📊 Статус'))
    expect(tg.lastText()).toContain('База данных')
    expect(tg.lastText()).toContain('Очередь агентов')
    s.role = 'analyst'
    await run(msg('/status'))
    expect(tg.lastText()).not.toContain('База данных') // settings.manage only
    expect(tg.lastText()).toContain('Расход ИИ сегодня')
    s.role = 'content_manager'
    await run(msg('/status'))
    expect(tg.lastText()).not.toContain('Очередь агентов')
  })

  const forbidden: Array<{ name: string; role: StaffRole; data: () => string | null; spy: () => ReturnType<typeof vi.fn> }> = [
    { name: 'disable agent (agents.manage)', role: 'crm_manager', data: () => btn('ag.off', 'x'), spy: () => actions.updateAgentConfigAudited },
    { name: 'enable agent (agents.manage)', role: 'analyst', data: () => btn('ag.on', 'x'), spy: () => actions.updateAgentConfigAudited },
    { name: 'run agent (agents.run)', role: 'analyst', data: () => btn('ag.run', 'x'), spy: () => actions.runAgentManually },
    { name: 'retry task (agents.run)', role: 'support', data: () => btn('tk.rt', UUID), spy: () => actions.agentTaskAction },
    { name: 'cancel task (agents.run)', role: 'analyst', data: () => btn('tk.cn', UUID), spy: () => actions.agentTaskAction },
    { name: 'approve registration (users.approve)', role: 'support', data: () => btn('rg.ok', USER), spy: () => access.decideAccessRequest },
    { name: 'reject registration (users.approve)', role: 'analyst', data: () => btn('rg.no', USER), spy: () => access.decideAccessRequest },
    { name: 'publish report (reports.publish)', role: 'super_expert', data: () => btn('rv.pub', UUID), spy: () => actions.transitionReportVersion },
    { name: 'AI review (insights.moderate)', role: 'support', data: () => btn('rw.ok', 'f', UUID), spy: () => actions.reviewAiItem },
    { name: 'run diagnostic (agents.run)', role: 'support', data: () => btn('cl.dg', 'co-1'), spy: () => actions.runAgentManually },
    { name: 'add key (settings.manage)', role: 'admin', data: () => btn('cr.add', PROVIDER), spy: () => providers.addCredential },
    { name: 'delete key (settings.manage)', role: 'admin', data: () => btn('cr.del', CRED), spy: () => providers.deleteCredential },
    { name: 'edit budget (settings.manage)', role: 'crm_manager', data: () => btn('bg.e', 'p'), spy: () => providers.setBudgets },
    { name: 'rotate key (settings.manage)', role: 'admin', data: () => btn('cr.rot', CRED), spy: () => providers.rotateCredential },
    { name: 'view providers (agents.view)', role: 'content_manager', data: () => btn('pv.l'), spy: () => providers.listProviders },
  ]
  for (const f of forbidden) {
    it(`refuses ${f.name} for ${f.role} and changes nothing`, async () => {
      s.role = f.role
      expect(await run(press(f.data()))).toBe('forbidden')
      expect(f.spy()).not.toHaveBeenCalled()
      const alert = tg.calls.find((c) => c.method === 'answerCallbackQuery')
      expect(alert?.body.text).toContain('Недостаточно прав')
      expect(h.state.dump().size).toBe(0) // no confirmation or input opened
      expect(h.audit).not.toHaveBeenCalled()
    })
  }

  it('destructive action: confirmation first, one-time nonce, then the change with the bot actor', async () => {
    s.role = 'admin'
    const ref = (await import('@/lib/telegram/bots/admin/agents')).agentRef('monitoring')
    expect(await run(press(btn('ag.off', ref)))).toBe('callback')
    expect(actions.updateAgentConfigAudited).not.toHaveBeenCalled()
    expect(tg.lastText()).toContain('Подтвердите действие')
    const confirm = buttonData(tg.lastButtons(), 'Подтвердить')

    // A forged nonce does nothing.
    expect(await run(press(btn('cf', 'forged')))).toBe('confirm_expired')
    expect(actions.updateAgentConfigAudited).not.toHaveBeenCalled()

    expect(await run(press(confirm))).toBe('confirmed')
    expect(actions.updateAgentConfigAudited).toHaveBeenCalledTimes(1)
    const call = actions.updateAgentConfigAudited.mock.calls[0] as unknown as [{ key: string; patch: unknown; actorId: string; audit: (e: unknown, o?: unknown) => Promise<boolean> }]
    expect(call[0]).toMatchObject({ key: 'monitoring', patch: { enabled: false }, actorId: 'b0b0b0b0-0000-4000-8000-000000000001' })
    // The audit writer passed to the shared action is bound to the Telegram actor.
    await call[0].audit({ action: 'agent.config.update' }, { required: true })
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b0b0b0b0-0000-4000-8000-000000000001', kind: 'telegram', role: 'admin' }),
      expect.objectContaining({ action: 'agent.config.update', metadata: expect.objectContaining({ via: 'telegram' }) }),
      { required: true },
    )

    // The same confirm button cannot be replayed.
    expect(await run(press(confirm))).toBe('confirm_expired')
    expect(actions.updateAgentConfigAudited).toHaveBeenCalledTimes(1)
  })

  it('cancel on a confirmation leaves everything as it was', async () => {
    s.role = 'admin'
    await run(press(btn('tk.cn', UUID)))
    const cancel = buttonData(tg.lastButtons(), 'Отмена')
    expect(await run(press(cancel))).toBe('cancelled')
    expect(actions.agentTaskAction).not.toHaveBeenCalled()
    expect(h.state.dump().size).toBe(0)
  })

  it('registration: approve directly, reject only after a reason and a confirmation', async () => {
    s.role = 'crm_manager'
    expect(await run(press(btn('rg.ok', USER)))).toBe('callback')
    expect(access.decideAccessRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'approve', actor: { id: 'b0b0b0b0-0000-4000-8000-000000000001', kind: 'telegram' } }))
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'telegram' }), expect.objectContaining({ action: 'request.approve', targetUserId: USER }), { required: true })
    access.decideAccessRequest.mockClear()

    await run(press(btn('rg.no', USER)))
    expect(access.decideAccessRequest).not.toHaveBeenCalled()
    expect(await run(msg('Неполные данные о компании'))).toBe('step')
    expect(access.decideAccessRequest).not.toHaveBeenCalled()
    expect(await run(press(buttonData(tg.lastButtons(), 'Подтвердить')))).toBe('confirmed')
    expect(access.decideAccessRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'reject', reason: 'Неполные данные о компании' }))
  })

  it('analyst sees contacts masked in a user card (users.sensitive)', async () => {
    s.role = 'analyst'
    await run(press(btn('us.c', USER)))
    expect(tg.lastText()).toContain('c***@corp.kz')
    expect(tg.lastText()).not.toContain('client@corp.kz')
    s.role = 'crm_manager'
    await run(press(btn('us.c', USER)))
    expect(tg.lastText()).toContain('client@corp.kz')
  })

  it('a key message is deleted BEFORE the key is stored, and only the mask is echoed', async () => {
    s.role = 'super_admin'
    const order: string[] = []
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const method = String(url).split('/').pop()!
      order.push(method)
      return tg.fetchImpl(url as string, init)
    }) as unknown as typeof fetch
    h.deps.fetchImpl = fetchImpl
    providers.addCredential.mockImplementationOnce(async (_a: unknown, _p: string, _l: string, secret: string) => {
      order.push('addCredential')
      return providers.cred(secret.slice(-4))
    })

    await run(press(btn('cr.add', PROVIDER)))
    expect(tg.lastText()).toContain('удалю сообщение')
    const KEY = 'sk-live-SUPERSECRET-0123456789-abcd'
    const update = msg(KEY)
    expect(await run(update)).toBe('step')

    const del = tg.calls.find((c) => c.method === 'deleteMessage')
    expect(del?.body).toEqual({ chat_id: String(TG_USER.id), message_id: update.message!.message_id })
    expect(order.indexOf('deleteMessage')).toBeLessThan(order.indexOf('addCredential'))
    expect(providers.addCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'telegram', id: 'b0b0b0b0-0000-4000-8000-000000000001' }), PROVIDER, expect.any(String), KEY,
    )
    expect(tg.lastText()).toContain('••••abcd')
    for (const c of tg.calls) expect(JSON.stringify(c.body)).not.toContain('SUPERSECRET')
    expect(JSON.stringify([...h.state.dump().values()])).not.toContain('SUPERSECRET')
    expect(h.state.dump().size).toBe(0)
  })

  it('rotation warns when Telegram refuses to delete the key message, and still never echoes it', async () => {
    s.role = 'super_admin'
    const failing = recordingFetch({ failMethods: ['deleteMessage'] })
    h.deps.fetchImpl = failing.fetchImpl
    await run(press(btn('cr.rot', CRED)))
    await run(msg('rk-NEWSECRET-9876543210-wxyz'))
    expect(providers.rotateCredential).toHaveBeenCalledWith(expect.anything(), CRED, 'rk-NEWSECRET-9876543210-wxyz')
    expect(failing.lastText()).toContain('••••wxyz')
    expect(failing.lastText()).toContain('удалите его вручную')
    for (const c of failing.calls) expect(JSON.stringify(c.body)).not.toContain('NEWSECRET')
  })

  it('a key pasted outside the key prompt is deleted too', async () => {
    s.role = 'analyst'
    await run(msg('sk-or-v1-0123456789abcdef0123456789abcdef'))
    expect(tg.calls.some((c) => c.method === 'deleteMessage')).toBe(true)
    expect(tg.lastText()).toContain('Похоже на ключ')
    expect(providers.addCredential).not.toHaveBeenCalled()
  })

  it('budget change: value → confirmation → setBudgets through the service', async () => {
    s.role = 'super_admin'
    await run(press(btn('bg.e', 'p')))
    expect(await run(msg('abc'))).toBe('step')
    expect(tg.lastText()).toContain('Нужно число')
    await run(msg('25'))
    expect(providers.setBudgets).not.toHaveBeenCalled()
    expect(await run(press(buttonData(tg.lastButtons(), 'Подтвердить')))).toBe('confirmed')
    expect(providers.setBudgets).toHaveBeenCalledWith(expect.objectContaining({ kind: 'telegram' }), { platformDailyUsd: 25 })
  })

  it('rejects tampered buttons and rate-limits a chat', async () => {
    const good = btn('st.r')!
    expect(await run(press(good.replace('st.r', 'bg.v')))).toBe('bad_signature')
    expect(await run(press('ap:not-a-real-card'))).toBe('raw') // approval cards are verified by their own signature
    h.rateLimit.mockResolvedValue(true)
    expect(await run(press(good))).toBe('rate_limited')
    expect(await run(msg('/status'))).toBe('rate_limited')
  })

  it('ignores group chats', async () => {
    expect(await run(msg('/status', TG_USER, { chat: { id: -100, type: 'supergroup' } }))).toBe('ignored')
    expect(tg.calls).toHaveLength(0)
  })
})
