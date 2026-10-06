/**
 * Agent runtime end-to-end on the real database (migration 086 + lib/agents):
 * permissions, approvals, budgets, retries/dead-letter, event subscriptions,
 * tenant binding of tools and LLM cost accounting.
 * Run: npm run test:db:setup && npm run test:db
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { dbTestsEnabled } from '../../helpers/db-env'

const enabled = dbTestsEnabled

describe.skipIf(!enabled)('agent runtime', async () => {
  // Imported lazily so the module graph (Prisma) is only built when the DB exists.
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const { registerTool, __resetToolsForTests } = await import('@/lib/agents/tools')
  const { enqueueAgentTask, executeTaskById, drainQueue } = await import('@/lib/agents/queue')
  const { decideApproval } = await import('@/lib/agents/approvals')
  const { emitPlatformEvent } = await import('@/lib/events/platform')
  const { AgentError } = await import('@/lib/agents/types')
  type Def = import('@/lib/agents/types').AgentDefinition<any>

  let ownerId: string
  let companyId: string
  let otherCompanyId: string
  const executed: string[] = []

  const limits = { maxAttempts: 2, leaseSeconds: 60, perRunBudgetUsd: 1, dailyBudgetUsd: 10, maxLlmCalls: 3, maxOutputTokens: 500 }
  const base = { version: '1.0.0', scope: 'company' as const, tier: 'none' as const, limits, inputSchema: z.object({}).passthrough() }

  function agents(): Def[] {
    return [
      {
        ...base, key: 'test_reader', name: 'Reader', description: 'reads',
        permissions: { READ_CLIENT_DATA: 'ALLOW' }, tools: ['test.read_company'],
        async run(ctx) {
          const r = await ctx.tool<{ id: string }>('test.read_company', {})
          return { summary: `read ${r.id}`, result: { read: r.id } }
        },
      },
      {
        ...base, key: 'test_deleter', name: 'Deleter', description: 'tries to delete without permission',
        permissions: { READ_CLIENT_DATA: 'ALLOW' }, tools: ['test.delete_everything'],
        async run(ctx) {
          await ctx.tool('test.delete_everything', {})
          return { summary: 'deleted' }
        },
      },
      {
        ...base, key: 'test_mailer', name: 'Mailer', description: 'sends email (needs approval)',
        permissions: { SEND_EMAIL: 'ALLOW' }, tools: ['test.send_email'],
        async run(ctx) {
          await ctx.tool('test.send_email', { to: 'owner@client.kz', subject: 'Отчёт готов' })
          return { summary: 'sent' }
        },
      },
      {
        ...base, key: 'test_flaky', name: 'Flaky', description: 'always fails (retryable)',
        permissions: {}, tools: [],
        async run() {
          throw new AgentError('UPSTREAM_DOWN', 'внешний сервис недоступен', true)
        },
      },
      {
        ...base, key: 'test_spender', name: 'Spender', description: 'calls the LLM', tier: 'light',
        limits: { ...limits, perRunBudgetUsd: 0.000001 },
        permissions: { CALL_LLM: 'ALLOW' }, tools: [],
        async run(ctx) {
          await ctx.llm({ system: 's', user: 'u'.repeat(2000) })
          return { summary: 'spent' }
        },
      },
      {
        ...base, key: 'test_llm', name: 'LLM user', description: 'calls the LLM within budget', tier: 'light',
        permissions: { CALL_LLM: 'ALLOW' }, tools: [],
        async run(ctx) {
          const r = await ctx.llm({ system: 'Ты аналитик', user: 'Сумма 2+2?', maxTokens: 50 })
          return { summary: r.ok ? r.text : r.error }
        },
      },
      {
        ...base, key: 'test_subscriber', name: 'Subscriber', description: 'reacts to FILE_UPLOADED',
        permissions: {}, tools: [], triggers: { events: ['FILE_UPLOADED'] },
        async run() {
          return { summary: 'noted' }
        },
      },
      {
        ...base, key: 'test_platform', name: 'Platform', description: 'platform task calling a company tool',
        scope: 'platform', permissions: { READ_CLIENT_DATA: 'ALLOW' }, tools: ['test.read_company'],
        async run(ctx) {
          await ctx.tool('test.read_company', {})
          return { summary: 'nope' }
        },
      },
    ]
  }

  beforeAll(async () => {
    process.env.AGENT_INLINE_EXECUTION = 'false'
    __resetToolsForTests()
    registerTool({
      name: 'test.read_company', description: 'read the bound company', permission: 'READ_CLIENT_DATA', companyScoped: true,
      args: z.object({}).strict(),
      handler: async (ctx) => {
        ctx.source({ type: 'diagnostic', ref: `company:${ctx.companyId}` })
        return { id: ctx.companyId }
      },
      summarize: (r: { id: string }) => `company ${r.id}`,
    })
    registerTool({
      name: 'test.delete_everything', description: 'dangerous', permission: 'DELETE_DATA', companyScoped: true,
      args: z.object({}).strict(),
      handler: async () => { executed.push('delete'); return null },
    })
    registerTool({
      name: 'test.send_email', description: 'send an email', permission: 'SEND_EMAIL', companyScoped: true,
      args: z.object({ to: z.string(), subject: z.string() }).strict(),
      redact: ['to'],
      describe: (a) => `Отправить письмо «${a.subject}»`,
      handler: async () => { executed.push('email'); return { sent: true } },
    })
    __useTestAgents(agents())

    ownerId = randomUUID()
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${ownerId}::uuid, ${`${ownerId}@t.local`})`
    companyId = randomUUID()
    otherCompanyId = randomUUID()
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES (${companyId}, 'A', ${ownerId}::uuid, now())`
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, "updatedAt") VALUES (${otherCompanyId}, 'B', now())`
  })

  beforeEach(() => {
    executed.length = 0
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id IN (${companyId}, ${otherCompanyId})`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id IN (${companyId}, ${otherCompanyId})`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${ownerId}::uuid`
    await prisma.$disconnect()
  })

  const task = async (id: string) =>
    (await prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM public.agent_tasks WHERE id = ${id}::uuid`)[0]
  const runs = (id: string) =>
    prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM public.agent_runs WHERE task_id = ${id}::uuid ORDER BY attempt`
  const calls = (id: string) =>
    prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT c.* FROM public.agent_tool_calls c JOIN public.agent_runs r ON r.id = c.run_id
      WHERE r.task_id = ${id}::uuid ORDER BY c.id`

  it('runs an allowed tool bound to the task company and records the run', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_reader', companyId, trigger: 'manual', kick: false })
    const report = await executeTaskById(id)
    expect(report?.finalStatus).toBe('succeeded')
    expect((await task(id)).result_summary).toEqual({ read: companyId })
    const [run] = await runs(id)
    expect(run).toMatchObject({ status: 'succeeded', output_summary: `read ${companyId}`, tools_used: ['test.read_company'] })
    expect(run.sources).toEqual([{ type: 'diagnostic', ref: `company:${companyId}` }])
    const [call] = await calls(id)
    expect(call).toMatchObject({ tool: 'test.read_company', decision: 'ALLOW', status: 'ok', result_summary: `company ${companyId}` })
  })

  it('denies a permission the agent does not declare and dead-letters without retry', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_deleter', companyId, trigger: 'manual', kick: false })
    const report = await executeTaskById(id)
    expect(report?.finalStatus).toBe('dead')
    expect(report?.errorCode).toBe('PERMISSION_DENIED')
    expect(executed).toEqual([])
    const [call] = await calls(id)
    expect(call).toMatchObject({ decision: 'DENY', status: 'denied' })
    const ev = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM public.platform_events WHERE subject_id = ${id}`
    expect(ev.map((e) => e.name)).toEqual(['AGENT_FAILED'])
  })

  it('parks an approval-gated action, then executes exactly that action once approved', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_mailer', companyId, trigger: 'manual', kick: false })
    expect((await executeTaskById(id))?.finalStatus).toBe('awaiting_approval')
    expect(executed).toEqual([])
    const [approval] = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT * FROM public.agent_approvals WHERE task_id = ${id}::uuid`
    expect(approval).toMatchObject({ status: 'pending', permission: 'SEND_EMAIL', summary: 'Отправить письмо «Отчёт готов»' })
    expect(approval.payload.args.to).toMatch(/^sha256:/) // recipient is not stored in clear

    const decided = await decideApproval({ approvalId: approval.id, decision: 'approve', actorId: 'staff:test', via: 'admin' })
    expect(decided).toMatchObject({ ok: true, status: 'approved', taskId: id })
    expect((await task(id)).status).toBe('queued')

    expect((await executeTaskById(id))?.finalStatus).toBe('succeeded')
    expect(executed).toEqual(['email'])
    const [after] = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM public.agent_approvals WHERE id = ${approval.id}::uuid`
    expect(after.status).toBe('executed')

    const again = await decideApproval({ approvalId: approval.id, decision: 'approve', actorId: 'staff:test', via: 'admin' })
    expect(again).toEqual({ ok: false, reason: 'not_pending' })
  })

  it('cancels the task when the approval is rejected', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_mailer', companyId, trigger: 'manual', kick: false, idempotencyKey: `rej-${randomUUID()}` })
    await executeTaskById(id)
    const [approval] = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.agent_approvals WHERE task_id = ${id}::uuid`
    await decideApproval({ approvalId: approval.id, decision: 'reject', actorId: 'staff:test', via: 'telegram', reason: 'не сейчас' })
    expect((await task(id))).toMatchObject({ status: 'cancelled', last_error_code: 'APPROVAL_REJECTED' })
    expect(executed).toEqual([])
  })

  it('an admin grant cannot make an approval-gated permission automatic', async () => {
    await prisma.$executeRaw`
      INSERT INTO public.agent_permission_grants (agent_key, permission, decision) VALUES ('test_mailer', 'SEND_EMAIL', 'ALLOW')
      ON CONFLICT (agent_key, permission) DO UPDATE SET decision = 'ALLOW'`
    try {
      const { id } = await enqueueAgentTask({ agentKey: 'test_mailer', companyId, trigger: 'manual', kick: false, idempotencyKey: `grant-${randomUUID()}` })
      expect((await executeTaskById(id))?.finalStatus).toBe('awaiting_approval')
      expect(executed).toEqual([])
    } finally {
      await prisma.$executeRaw`DELETE FROM public.agent_permission_grants WHERE agent_key = 'test_mailer'`
    }
  })

  it('retries a retryable failure with backoff, then dead-letters', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_flaky', companyId, trigger: 'manual', kick: false })
    expect((await executeTaskById(id))?.finalStatus).toBe('queued')
    const t1 = await task(id)
    expect(t1.last_error_code).toBe('UPSTREAM_DOWN')
    expect(new Date(t1.run_after).getTime()).toBeGreaterThan(Date.now())
    expect(await executeTaskById(id)).toBeNull() // not due yet
    await prisma.$executeRaw`UPDATE public.agent_tasks SET run_after = now() WHERE id = ${id}::uuid`
    const drained = await drainQueue({ limit: 5, budgetMs: 10_000 })
    expect(drained.executed.find((r) => r.taskId === id)?.finalStatus).toBe('dead')
    expect((await runs(id)).map((r) => r.status)).toEqual(['failed', 'failed'])
  })

  it('stops an LLM call that would exceed the run budget before calling the provider', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    process.env.OPENROUTER_API_KEY = 'test-key'
    try {
      const { id } = await enqueueAgentTask({ agentKey: 'test_spender', companyId, trigger: 'manual', kick: false })
      const report = await executeTaskById(id)
      expect(report).toMatchObject({ finalStatus: 'dead', errorCode: 'BUDGET_EXCEEDED' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      delete process.env.OPENROUTER_API_KEY
    }
  })

  it('records tokens and the provider-reported cost of LLM calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      choices: [{ message: { content: '4' } }],
      usage: { prompt_tokens: 120, completion_tokens: 3, cost: 0.000135 },
    }), { status: 200 })))
    process.env.OPENROUTER_API_KEY = 'test-key'
    try {
      const { id } = await enqueueAgentTask({ agentKey: 'test_llm', companyId, trigger: 'manual', kick: false })
      expect((await executeTaskById(id))?.finalStatus).toBe('succeeded')
      const [run] = await runs(id)
      expect(run).toMatchObject({ llm_calls: 1, tokens_in: 120, tokens_out: 3, model: 'anthropic/claude-haiku-4.5', output_summary: '4' })
      expect(Number(run.cost_usd)).toBeCloseTo(0.000135, 6)
      // No route configured (094): the built-in OpenRouter fallback served it.
      expect(run.provider_key).toBe('openrouter')
    } finally {
      vi.unstubAllGlobals()
      delete process.env.OPENROUTER_API_KEY
    }
  })

  it('fans a platform event out to subscribed agents exactly once', async () => {
    const dedupe = `file:${randomUUID()}`
    const first = await emitPlatformEvent({ name: 'FILE_UPLOADED', companyId, subjectType: 'document', subjectId: 'doc-1', dedupeKey: dedupe })
    const second = await emitPlatformEvent({ name: 'FILE_UPLOADED', companyId, subjectType: 'document', subjectId: 'doc-1', dedupeKey: dedupe })
    expect(second).toEqual({ id: first.id, duplicate: true })
    const tasks = await prisma.$queryRaw<Array<{ agent_key: string; trigger: string; trigger_ref: string }>>`
      SELECT agent_key, trigger, trigger_ref FROM public.agent_tasks WHERE idempotency_key = ${`event:${first.id}:test_subscriber`}`
    expect(tasks).toEqual([{ agent_key: 'test_subscriber', trigger: 'event', trigger_ref: 'FILE_UPLOADED' }])
    const [ev] = await prisma.$queryRaw<Array<{ dispatched_at: Date | null; dispatch_error: string | null }>>`
      SELECT dispatched_at, dispatch_error FROM public.platform_events WHERE id = ${first.id}`
    expect(ev.dispatched_at).not.toBeNull()
    expect(ev.dispatch_error).toBeNull()
  })

  it('a platform task cannot use a company-bound tool', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_platform', companyId: null, trigger: 'manual', kick: false })
    expect(await executeTaskById(id)).toMatchObject({ finalStatus: 'dead', errorCode: 'NO_COMPANY' })
    await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE id = ${id}::uuid`
  })

  it('refuses to enqueue a disabled agent', async () => {
    await prisma.$executeRaw`INSERT INTO public.agent_configs (agent_key, enabled) VALUES ('test_reader', false)
      ON CONFLICT (agent_key) DO UPDATE SET enabled = false`
    try {
      await expect(enqueueAgentTask({ agentKey: 'test_reader', companyId, trigger: 'manual', kick: false })).rejects.toThrow(/disabled/)
    } finally {
      await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = 'test_reader'`
    }
  })
})
