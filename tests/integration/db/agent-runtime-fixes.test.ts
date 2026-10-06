/**
 * Agent runtime / Control Center fixes on the real database (review findings
 * #4, #16, #17, #18, #19, #39, #40, #41, #43, #53, #54, #68, #69).
 * Run: node scripts/test-db/setup.mjs && TEST_DATABASE_URL=… npx vitest run <this file>
 */
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('agent runtime fixes', async () => {
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const { registerTool } = await import('@/lib/agents/tools')
  const { enqueueAgentTask, executeTaskById, drainQueue } = await import('@/lib/agents/queue')
  const { decideApproval } = await import('@/lib/agents/approvals')
  const { emitPlatformEvent, onPlatformEvent, redispatchPending } = await import('@/lib/events/platform')
  const store = await import('@/lib/agents/store')
  const admin = await import('@/lib/agents/admin')
  const { platformHealthSnapshot } = await import('@/lib/agents/definitions/monitoring')
  type Def = import('@/lib/agents/types').AgentDefinition<any>

  const sfx = Date.now().toString(36)
  const K = {
    parallel: `tfx_par_${sfx}`,
    crash: `tfx_crash_${sfx}`,
    reader: `tfx_read_${sfx}`,
    sub: `tfx_sub_${sfx}`,
    slow: `tfx_slow_${sfx}`,
    lease: `tfx_lease_${sfx}`,
    mailer: `tfx_mail_${sfx}`,
    paging: `tfx_page_${sfx}`,
    old: `tfx_old_${sfx}`,
  }
  const keys = Object.values(K)
  const mailTool = `test.fx_send_${sfx}`
  const SECRET_DB_TEXT = 'Invalid `prisma.$queryRaw()` invocation: Raw query failed. Code: `23503`. Message: `insert or update on table "diagnostic_findings" violates foreign key constraint "diag_secret_fk"`'

  let companyId: string
  const sent: string[] = []
  const ledgerIds: bigint[] = []
  const limits = { maxAttempts: 2, leaseSeconds: 60, perRunBudgetUsd: 1, dailyBudgetUsd: 10, maxLlmCalls: 3, maxOutputTokens: 50 }
  const base = { version: '1.0.0', scope: 'company' as const, tier: 'none' as const, limits, inputSchema: z.object({}).passthrough() }

  const agents = (): Def[] => [
    {
      ...base, key: K.parallel, name: 'Parallel', description: 'one LLM call', tier: 'light',
      // One call is estimated at ~$0.00025 (1 input token + 50 output at $5/Mtok):
      // the daily budget fits one call in flight, not two.
      limits: { ...limits, dailyBudgetUsd: 0.0004 },
      permissions: { CALL_LLM: 'ALLOW' }, tools: [],
      async run(ctx) {
        const r = await ctx.llm({ system: 's', user: 'u', maxTokens: 50 })
        return { summary: r.ok ? 'answered' : r.error }
      },
    },
    {
      ...base, key: K.crash, name: 'Crash', description: 'throws a raw DB error', permissions: {}, tools: [],
      limits: { ...limits, maxAttempts: 1 },
      async run() { throw new Error(SECRET_DB_TEXT) },
    },
    { ...base, key: K.reader, name: 'Reader', description: 'no-op', permissions: {}, tools: [], async run() { return { summary: 'ran' } } },
    {
      ...base, key: K.sub, name: 'Subscriber', description: 'reacts to FILE_UPLOADED', permissions: {}, tools: [],
      triggers: { events: ['FILE_UPLOADED'] }, async run() { return { summary: 'noted' } },
    },
    {
      ...base, key: K.slow, name: 'Slow', description: 'declared worst case 60 s',
      limits: { ...limits, leaseSeconds: 120, maxLlmCalls: 0 }, permissions: {}, tools: [],
      async run() { return { summary: 'slow ran' } },
    },
    {
      ...base, key: K.lease, name: 'Long lease', description: 'reports its lease',
      limits: { ...limits, leaseSeconds: 900, maxRunSeconds: 5 }, permissions: {}, tools: [],
      async run(ctx) {
        const [t] = await prisma.$queryRaw<Array<{ secs: number }>>`
          SELECT extract(epoch FROM lease_until - now())::int AS secs FROM public.agent_tasks WHERE id = ${ctx.taskId}::uuid`
        return { summary: 'lease', result: { lease_secs: Number(t.secs) } }
      },
    },
    {
      ...base, key: K.mailer, name: 'Mailer', description: 'needs approval', permissions: { SEND_EMAIL: 'ALLOW' }, tools: [mailTool],
      async run(ctx) {
        await ctx.tool(mailTool, { subject: 'Отчёт' })
        return { summary: 'sent' }
      },
    },
    { ...base, key: K.paging, name: 'Paging', description: 'no-op', permissions: {}, tools: [], async run() { return { summary: 'ok' } } },
    { ...base, key: K.old, name: 'Old', description: 'no-op', permissions: {}, tools: [], async run() { return { summary: 'ok' } } },
  ]

  // Decides an approval while the runner is still inside the run (the
  // APPROVAL_REQUESTED event is dispatched inline, before the task is parked).
  const decideDuringRun = new Map<string, 'approve' | 'reject'>()
  let failListenerFor: string | null = null

  beforeAll(async () => {
    process.env.AGENT_INLINE_EXECUTION = 'false'
    registerTool({
      name: mailTool, description: 'send an email', permission: 'SEND_EMAIL', companyScoped: true,
      args: z.object({ subject: z.string() }).strict(),
      describe: (a) => `Отправить письмо «${a.subject}»`,
      handler: async () => { sent.push('email'); return { sent: true } },
    })
    __useTestAgents(agents())
    onPlatformEvent(async (e) => {
      if (failListenerFor && e.subject_id === failListenerFor) throw new Error('listener temporarily down')
      if (e.name !== 'APPROVAL_REQUESTED') return
      const taskId = String(e.payload.task_id)
      const decision = decideDuringRun.get(taskId)
      if (!decision) return
      const res = await decideApproval({ approvalId: String(e.payload.approval_id), decision, actorId: 'staff:fast', via: 'admin' })
      expect(res.ok).toBe(true)
    })
    companyId = randomUUID()
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, "updatedAt") VALUES (${companyId}, 'FX', now())`
  })

  beforeEach(() => {
    sent.length = 0
  })

  afterAll(async () => {
    for (const id of ledgerIds) await prisma.$executeRaw`DELETE FROM public.ai_usage_ledger WHERE id = ${id}`
    await prisma.$executeRaw`DELETE FROM public.ai_budget_reservations WHERE agent_key = ANY (${keys}::text[])`
    await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE agent_key = ANY (${keys}::text[])`
    await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = ANY (${keys}::text[])`
    await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id = ${companyId}`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ${companyId}`
    await prisma.$disconnect()
  })

  const task = async (id: string) =>
    (await prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM public.agent_tasks WHERE id = ${id}::uuid`)[0]
  const enqueue = (agentKey: string, extra: Record<string, unknown> = {}) =>
    enqueueAgentTask({ agentKey, companyId, trigger: 'manual', kick: false, idempotencyKey: randomUUID(), ...extra })
  const addLedger = async (cost: string) => {
    const [r] = await prisma.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO public.ai_usage_ledger (source, model, cost_usd, cost_source, ok)
      VALUES ('feature:test.fx', 'm', ${cost}::numeric, 'provider', true) RETURNING id`
    ledgerIds.push(r.id)
  }

  // ── #4 ────────────────────────────────────────────────────────────────────
  describe('daily budgets see spend in flight (#4)', () => {
    it('two parallel runs cannot both pass a budget that fits one call', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key'
      const fetchSpy = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 400))
        return new Response(JSON.stringify({
          model: 'anthropic/claude-haiku-4.5', choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 50, cost: 0.0003 },
        }), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchSpy)
      try {
        const [a, b] = await Promise.all([enqueue(K.parallel), enqueue(K.parallel)])
        const reports = await Promise.all([executeTaskById(a.id), executeTaskById(b.id)])
        expect(reports.map((r) => r?.finalStatus).sort()).toEqual(['dead', 'succeeded'])
        expect(reports.find((r) => r?.finalStatus === 'dead')?.errorCode).toBe('BUDGET_EXCEEDED')
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        // The real cost replaced the reservation; nothing is left reserved.
        expect(await store.spendToday({ agentKey: K.parallel })).toBeCloseTo(0.0003, 6)
        const [held] = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM public.ai_budget_reservations WHERE agent_key = ${K.parallel}`
        expect(Number(held.n)).toBe(0)
      } finally {
        vi.unstubAllGlobals()
        delete process.env.OPENROUTER_API_KEY
      }
    })

    it('an unsettled reservation (run killed mid-call) still counts for the day', async () => {
      const before = await store.spendToday({ agentKey: K.crash })
      await prisma.$executeRaw`INSERT INTO public.ai_budget_reservations (agent_key, company_id, amount_usd) VALUES (${K.crash}, ${companyId}, 0.0002)`
      expect(await store.spendToday({ agentKey: K.crash })).toBeCloseTo(before + 0.0002, 6)
      expect(await store.spendToday({ companyId })).toBeGreaterThanOrEqual(0.0002)
    })
  })

  // ── #16 ───────────────────────────────────────────────────────────────────
  it('keeps raw exception text out of tenant-readable rows (#16)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { id } = await enqueue(K.crash)
      expect(await executeTaskById(id)).toMatchObject({ errorCode: 'UNEXPECTED' })
      const t = await task(id)
      const [run] = await prisma.$queryRaw<Array<{ error_message: string | null }>>`SELECT error_message FROM public.agent_runs WHERE task_id = ${id}::uuid`
      const events = await prisma.$queryRaw<Array<{ level: string; message: string }>>`SELECT level, message FROM public.agent_events WHERE task_id = ${id}::uuid`
      const tenantVisible = [t.last_error, run.error_message, ...events.filter((e) => e.level !== 'debug').map((e) => e.message)]
      for (const text of tenantVisible) expect(String(text)).not.toMatch(/diagnostic_findings|diag_secret_fk|prisma/)
      expect(t.last_error_code).toBe('UNEXPECTED')
      // Staff keep the detail: a debug event (no tenant policy) and the server log.
      expect(events.find((e) => e.level === 'debug')?.message).toContain('diag_secret_fk')
      expect(errSpy.mock.calls.flat().join(' ')).toContain('diag_secret_fk')
    } finally {
      errSpy.mockRestore()
    }
  })

  // ── #17 ───────────────────────────────────────────────────────────────────
  describe('platform event outbox (#17)', () => {
    it('a failed dispatch stays undispatched and is retried', async () => {
      const subject = `doc-${randomUUID()}`
      failListenerFor = subject
      const ev = await emitPlatformEvent({ name: 'FILE_UPLOADED', companyId, subjectType: 'document', subjectId: subject, dedupeKey: `fx:${subject}` })
      const row = async () => (await prisma.$queryRaw<Array<{ dispatched_at: Date | null; dispatch_error: string | null; dispatch_attempts: number }>>`
        SELECT dispatched_at, dispatch_error, dispatch_attempts FROM public.platform_events WHERE id = ${ev.id}`)[0]
      expect(await row()).toMatchObject({ dispatched_at: null, dispatch_attempts: 1 })
      expect((await row()).dispatch_error).toMatch(/listener temporarily down/)

      failListenerFor = null
      await prisma.$executeRaw`UPDATE public.platform_events SET created_at = now() - interval '5 minutes' WHERE id = ${ev.id}`
      await redispatchPending(500)
      const after = await row()
      expect(after.dispatched_at).not.toBeNull()
      expect(after.dispatch_error).toBeNull()
      // Fan-out stays idempotent across the retry: one task for the subscriber.
      const tasks = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM public.agent_tasks WHERE idempotency_key = ${`event:${ev.id}:${K.sub}`}`
      expect(tasks).toHaveLength(1)
    })

    it('a disabled subscriber is skipped, not a dispatch failure', async () => {
      await prisma.$executeRaw`INSERT INTO public.agent_configs (agent_key, enabled) VALUES (${K.sub}, false)
        ON CONFLICT (agent_key) DO UPDATE SET enabled = false`
      try {
        const subject = `doc-${randomUUID()}`
        const ev = await emitPlatformEvent({ name: 'FILE_UPLOADED', companyId, subjectType: 'document', subjectId: subject, dedupeKey: `fx:${subject}` })
        const [r] = await prisma.$queryRaw<Array<{ dispatched_at: Date | null; dispatch_error: string | null }>>`
          SELECT dispatched_at, dispatch_error FROM public.platform_events WHERE id = ${ev.id}`
        expect(r.dispatched_at).not.toBeNull()
        expect(r.dispatch_error).toBeNull()
      } finally {
        await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = ${K.sub}`
      }
    })
  })

  // ── #18 ───────────────────────────────────────────────────────────────────
  it('a disabled agent does not run its already-queued task (#18)', async () => {
    const { id } = await enqueue(K.reader)
    await prisma.$executeRaw`INSERT INTO public.agent_configs (agent_key, enabled) VALUES (${K.reader}, false)
      ON CONFLICT (agent_key) DO UPDATE SET enabled = false`
    try {
      const report = await executeTaskById(id)
      expect(report).toMatchObject({ finalStatus: 'cancelled', errorCode: 'AGENT_DISABLED', runId: null })
      expect(await task(id)).toMatchObject({ status: 'cancelled', last_error_code: 'AGENT_DISABLED', lease_token: null })
      const runs = await prisma.$queryRaw<unknown[]>`SELECT id FROM public.agent_runs WHERE task_id = ${id}::uuid`
      expect(runs).toHaveLength(0)
    } finally {
      await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = ${K.reader}`
    }
  })

  // ── #19 ───────────────────────────────────────────────────────────────────
  describe('queue drain timing (#19)', () => {
    it('does not claim a task whose worst-case run no longer fits the invocation', async () => {
      const { id } = await enqueue(K.slow)
      try {
        // Slow agent: worst case 60 s (no LLM calls, lease 120 s) + 10 s tail > 50 s.
        const drained = await drainQueue({ budgetMs: 40_000, maxDurationMs: 50_000 })
        expect(drained.executed.find((r) => r.taskId === id)).toBeUndefined()
        expect((await task(id)).status).toBe('queued')
      } finally {
        await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE id = ${id}::uuid`
      }
    })

    it("claims with at least the agent's own lease", async () => {
      const { id } = await enqueue(K.lease)
      const drained = await drainQueue({ budgetMs: 10_000 })
      expect(drained.executed.find((r) => r.taskId === id)?.finalStatus).toBe('succeeded')
      expect(Number((await task(id)).result_summary.lease_secs)).toBeGreaterThan(600)
    })
  })

  // ── #39 / #53 / #40 ──────────────────────────────────────────────────────
  describe('approvals', () => {
    const approvalOf = async (taskId: string) =>
      (await prisma.$queryRaw<Array<{ id: string; status: string; decided_via: string | null }>>`
        SELECT id, status, decided_via FROM public.agent_approvals WHERE task_id = ${taskId}::uuid ORDER BY requested_at`)

    it('an approval decided before the task is parked still re-queues it (#39)', async () => {
      const { id } = await enqueue(K.mailer)
      decideDuringRun.set(id, 'approve')
      const report = await executeTaskById(id)
      expect(report?.finalStatus).toBe('queued')
      expect(await task(id)).toMatchObject({ status: 'queued', trigger: 'approval' })
      expect((await executeTaskById(id))?.finalStatus).toBe('succeeded')
      expect(sent).toEqual(['email'])
    })

    it('a rejection decided before the task is parked cancels it (#39)', async () => {
      const { id } = await enqueue(K.mailer)
      decideDuringRun.set(id, 'reject')
      expect((await executeTaskById(id))?.finalStatus).toBe('cancelled')
      expect(await task(id)).toMatchObject({ status: 'cancelled', last_error_code: 'APPROVAL_REJECTED', cancelled_by: 'staff:fast' })
      expect(sent).toEqual([])
    })

    it('approving a task at its attempt cap re-queues it atomically (#53)', async () => {
      const { id } = await enqueue(K.mailer)
      expect((await executeTaskById(id))?.finalStatus).toBe('awaiting_approval')
      await prisma.$executeRaw`UPDATE public.agent_tasks SET attempts = 10, max_attempts = 10 WHERE id = ${id}::uuid`
      const [approval] = await approvalOf(id)
      const res = await decideApproval({ approvalId: approval.id, decision: 'approve', actorId: 'staff:t', via: 'admin' })
      expect(res).toMatchObject({ ok: true, status: 'approved' })
      expect(await task(id)).toMatchObject({ status: 'queued', max_attempts: 10 })
    })

    it('cancelling a task closes its pending approval (#40)', async () => {
      const { id } = await enqueue(K.mailer)
      expect((await executeTaskById(id))?.finalStatus).toBe('awaiting_approval')
      expect(await admin.cancelTask(id, 'staff:canceller')).toBe(true)
      const [approval] = await approvalOf(id)
      expect(approval).toMatchObject({ status: 'rejected', decided_via: 'system' })
      expect(await decideApproval({ approvalId: approval.id, decision: 'approve', actorId: 'staff:late', via: 'admin' }))
        .toEqual({ ok: false, reason: 'not_pending' })
      expect((await task(id)).status).toBe('cancelled')
    })

    it('a decision on a task that is no longer waiting changes nothing (#40)', async () => {
      const { id } = await enqueue(K.mailer)
      expect((await executeTaskById(id))?.finalStatus).toBe('awaiting_approval')
      await prisma.$executeRaw`UPDATE public.agent_tasks SET status = 'cancelled', finished_at = now() WHERE id = ${id}::uuid`
      const [approval] = await approvalOf(id)
      expect(await decideApproval({ approvalId: approval.id, decision: 'approve', actorId: 'staff:late', via: 'admin' }))
        .toEqual({ ok: false, reason: 'not_pending' })
      expect((await approvalOf(id))[0].status).toBe('pending')
    })
  })

  // ── #41 ───────────────────────────────────────────────────────────────────
  it('a config PATCH does not overwrite a concurrent change of another field (#41)', async () => {
    await prisma.$executeRaw`INSERT INTO public.agent_configs (agent_key, enabled) VALUES (${K.reader}, true)
      ON CONFLICT (agent_key) DO UPDATE SET enabled = true`
    const other = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
    await other.connect()
    try {
      // Admin A's kill switch is in flight (row locked, not yet committed)…
      await other.query('BEGIN')
      await other.query('UPDATE public.agent_configs SET enabled = false WHERE agent_key = $1', [K.reader])
      // …while admin B saves a budget.
      const patch = admin.updateAgentConfig(K.reader, { dailyBudgetUsd: 2 }, 'staff:b')
      await new Promise((r) => setTimeout(r, 300))
      await other.query('COMMIT')
      expect(await patch).toEqual({ ok: true })
      const [cfg] = await prisma.$queryRaw<Array<{ enabled: boolean; daily_budget_usd: unknown }>>`
        SELECT enabled, daily_budget_usd FROM public.agent_configs WHERE agent_key = ${K.reader}`
      expect(cfg.enabled).toBe(false)
      expect(Number(cfg.daily_budget_usd)).toBe(2)
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      await other.end()
      await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key = ${K.reader}`
    }
  })

  // ── #43 / #54 ─────────────────────────────────────────────────────────────
  describe('platform spend shown = spend enforced (#43, #54)', () => {
    it('the costs API reports today’s platform spend including non-agent calls (#43)', async () => {
      await addLedger('0.05')
      const summary = await admin.costSummary(7)
      const enforced = await store.spendToday()
      expect(summary.platformSpendTodayUsd).toBeGreaterThanOrEqual(0.05)
      expect(Math.abs(summary.platformSpendTodayUsd - enforced)).toBeLessThan(0.01)
    })

    it('the monitoring spend check counts non-agent calls (#54)', async () => {
      await addLedger('0.05')
      const check = (await platformHealthSnapshot()).find((c) => c.key === 'ai_spend_today')!
      const enforced = Math.round((await store.spendToday()) * 100) / 100
      expect(check.value).toBeGreaterThanOrEqual(0.1)
      expect(Math.abs(check.value - enforced)).toBeLessThanOrEqual(0.011)
    })
  })

  // ── #68 ───────────────────────────────────────────────────────────────────
  it('task paging does not skip tasks created within the same millisecond (#68)', async () => {
    const a = randomUUID()
    const b = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO public.agent_tasks (id, agent_key, company_id, trigger, created_at) VALUES
        (${a}::uuid, ${K.paging}, ${companyId}, 'manual', '2026-01-01T00:00:00.123456Z'),
        (${b}::uuid, ${K.paging}, ${companyId}, 'manual', '2026-01-01T00:00:00.123100Z')`
    const page1 = await admin.listTasks({ agentKey: K.paging, limit: 1 })
    expect(page1.items.map((t) => t.id)).toEqual([a])
    const page2 = await admin.listTasks({ agentKey: K.paging, limit: 1, before: page1.nextCursor })
    expect(page2.items.map((t) => t.id)).toEqual([b])
  })

  // ── #69 ───────────────────────────────────────────────────────────────────
  it('one agent’s overview, with its last run even when older than the 7-day window (#69)', async () => {
    const { id } = await enqueue(K.old)
    await executeTaskById(id)
    await prisma.$executeRaw`UPDATE public.agent_runs SET started_at = now() - interval '30 days' WHERE task_id = ${id}::uuid`
    const overview = await admin.getAgentOverview(K.old)
    expect(overview?.key).toBe(K.old)
    expect(overview?.stats).toMatchObject({ runs7d: 0, lastRunStatus: 'succeeded' })
    expect(overview?.stats.lastRunAt).not.toBeNull()
    expect(await admin.getAgentOverview('no_such_agent')).toBeNull()
  })
})
