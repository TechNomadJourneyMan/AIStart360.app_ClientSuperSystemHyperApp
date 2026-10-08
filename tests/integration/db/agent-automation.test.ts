/**
 * Agent automation on the real database (108 + lib/agents/automation.ts,
 * lifecycle.ts, digest.ts): lifecycle notifications written by the queue,
 * the auto-retry switch, stuck detection once per task, the automatic
 * company diagnostic once per local day, and the digest queries.
 * Settings are a fake store; no Telegram bot is configured, nothing leaves the box.
 * Run: TEST_DATABASE_URL=postgres://… npx vitest run tests/integration/db/agent-automation.test.ts
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { dbTestsEnabled } from '../../helpers/db-env'

const settings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => {
    const { SETTINGS } = await import('@/lib/settings/registry')
    return key in settings.values ? settings.values[key] : (SETTINGS as Record<string, { default: unknown }>)[key].default
  },
  getAllSettings: async () => { throw new Error('not used') },
  saveSettings: async () => undefined,
  invalidateSettings: () => undefined,
}))

describe.skipIf(!dbTestsEnabled)('agent automation (108)', async () => {
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
  const { emitPlatformEvent, dispatchEvent } = await import('@/lib/events/platform')
  const { alertStuckTasks } = await import('@/lib/agents/lifecycle')
  const { collectAgentsDigest } = await import('@/lib/agents/digest')
  const { autoDiagnosticSlots } = await import('@/lib/agents/automation')
  const { AgentError } = await import('@/lib/agents/types')
  type Def = import('@/lib/agents/types').AgentDefinition<any>

  const ENV = ['AGENT_INLINE_EXECUTION', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL']
  const saved: Record<string, string | undefined> = {}
  let companyId: string
  const limits = { maxAttempts: 2, leaseSeconds: 60, perRunBudgetUsd: 1, dailyBudgetUsd: 10, maxLlmCalls: 0, maxOutputTokens: 100 }
  const base = { version: '1.0.0', scope: 'company' as const, tier: 'none' as const, limits, permissions: {}, tools: [], inputSchema: z.object({}).passthrough() }
  const defs: Def[] = [
    { ...base, key: 'test_auto_ok', name: 'Тестовый агент', description: 'ok', async run() { return { summary: 'готово' } } },
    {
      ...base, key: 'test_auto_flaky', name: 'Капризный агент', description: 'retryable failure',
      async run() { throw new AgentError('UPSTREAM_DOWN', 'сервис owner@corp.kz недоступен', true) },
    },
    {
      ...base, key: 'diagnostic_orchestrator', name: 'Оркестратор', description: 'test orchestrator',
      triggers: { events: ['QUESTIONNAIRE_COMPLETED', 'FILE_PROCESSED'] },
      async run() { return { summary: 'ok' } },
    },
  ]

  const events = (taskId: string) => prisma.$queryRaw<Array<{ type: string; level: string; dedupe_key: string; body: string }>>`
    SELECT type, level, dedupe_key, body FROM public.notification_events WHERE entity_id = ${taskId} ORDER BY created_at`
  /** Outcome messages; «started» may be folded into a burst summary when other suites run in parallel. */
  const outcomes = async (taskId: string) => (await events(taskId)).filter((e) => e.type !== 'agent.started')
  const startedOrBurst = async (taskId: string) => {
    const own = (await events(taskId)).filter((e) => e.type === 'agent.started')
    if (own.length) return own
    return prisma.$queryRaw<Array<{ type: string; level: string; dedupe_key: string; body: string }>>`
      SELECT type, level, dedupe_key, body FROM public.notification_events
      WHERE type = 'agent.started_burst' AND created_at > now() - interval '5 minutes'`
  }

  beforeAll(async () => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
    process.env.AGENT_INLINE_EXECUTION = 'false'
    __useTestAgents(defs)
    companyId = randomUUID()
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, "updatedAt") VALUES (${companyId}, 'ТОО Автоматизация', now())`
  })
  beforeEach(() => { settings.values = {} })
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE company_id = ${companyId} OR dedupe_key LIKE 'agent:started-burst:%'`
    await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id = ${companyId}`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ${companyId}`
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await prisma.$disconnect()
  })

  it('the queue reports start and success once, with the company and the attempt', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_auto_ok', companyId, trigger: 'manual', kick: false })
    expect((await executeTaskById(id))?.finalStatus).toBe('succeeded')
    const ev = await outcomes(id)
    expect(ev.map((e) => [e.type, e.level, e.dedupe_key])).toEqual([['agent.succeeded', 'INFO', `agent:${id}:succeeded:1`]])
    expect(ev[0].body).toContain('Компания: ТОО Автоматизация')
    expect(ev[0].body).toContain('Попытка 1/2')
    const started = await startedOrBurst(id)
    expect(started.length).toBeGreaterThanOrEqual(1)
    if (started[0].type === 'agent.started') expect(started.map((e) => e.dedupe_key)).toEqual([`agent:${id}:started`])
  })

  it('auto-retry on: a retry is scheduled (WARNING); then dead-letter (CRITICAL) with a scrubbed error', async () => {
    const { id } = await enqueueAgentTask({ agentKey: 'test_auto_flaky', companyId, trigger: 'manual', kick: false })
    expect((await executeTaskById(id))?.finalStatus).toBe('queued')
    await prisma.$executeRaw`UPDATE public.agent_tasks SET run_after = now() WHERE id = ${id}::uuid`
    expect((await executeTaskById(id))?.finalStatus).toBe('dead')
    const ev = await outcomes(id)
    expect(ev.map((e) => [e.type, e.level])).toEqual([['agent.retrying', 'WARNING'], ['agent.dead', 'CRITICAL']])
    expect((await events(id)).filter((e) => e.type === 'agent.started').length).toBeLessThanOrEqual(1)
    expect(ev[1].body).toContain('Ошибка: UPSTREAM_DOWN — сервис [email] недоступен')
    // AGENT_FAILED is still emitted, but the router adds no second staff message.
    const legacy = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM public.notification_events WHERE type = 'agent.failed' AND entity_id = ${id}`
    expect(Number(legacy[0].n)).toBe(0)
  })

  it('auto-retry off: the first failure goes to dead-letter', async () => {
    settings.values.agents_auto_retry = false
    const { id } = await enqueueAgentTask({ agentKey: 'test_auto_flaky', companyId, trigger: 'manual', kick: false })
    const report = await executeTaskById(id)
    expect(report?.finalStatus).toBe('dead')
    const [t] = await prisma.$queryRaw<Array<{ attempts: number }>>`SELECT attempts FROM public.agent_tasks WHERE id = ${id}::uuid`
    expect(Number(t.attempts)).toBe(1)
  })

  it('stuck tasks: expired lease or no progress for N minutes → one CRITICAL per task', async () => {
    settings.values.agents_stuck_minutes = 20
    const mk = async (leaseOffset: string) => {
      const [r] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.agent_tasks (agent_key, company_id, trigger, status, attempts, lease_token, lease_until, started_at)
        VALUES ('test_auto_ok', ${companyId}, 'manual', 'running', 1, gen_random_uuid(), now() + ${leaseOffset}::interval, now() - interval '1 hour')
        RETURNING id::text`
      return r.id
    }
    const expired = await mk('-1 minute')
    const idle = await mk('30 minutes')
    const busy = await mk('30 minutes')
    await prisma.$executeRaw`
      INSERT INTO public.agent_runs (task_id, agent_key, agent_version, company_id, attempt, started_at)
      VALUES (${idle}::uuid, 'test_auto_ok', '1', ${companyId}, 1, now() - interval '25 minutes'),
             (${busy}::uuid, 'test_auto_ok', '1', ${companyId}, 1, now() - interval '25 minutes')`
    await prisma.$executeRaw`
      INSERT INTO public.agent_events (task_id, agent_key, company_id, level, type, message)
      VALUES (${busy}::uuid, 'test_auto_ok', ${companyId}, 'info', 'progress', 'шаг 3')`

    await alertStuckTasks()
    const stuckOf = async (id: string) => (await events(id)).filter((e) => e.type === 'agent.stuck')
    expect((await stuckOf(expired)).map((e) => [e.level, e.dedupe_key])).toEqual([['CRITICAL', `agent:${expired}:stuck`]])
    expect((await stuckOf(idle))[0].body).toContain('Нет прогресса')
    expect(await stuckOf(busy)).toEqual([])
    // Reported once: the next maintenance pass leaves them alone.
    expect(await alertStuckTasks()).toBe(0)
    await prisma.$executeRaw`UPDATE public.agent_tasks SET status = 'cancelled', lease_token = NULL, lease_until = NULL WHERE id IN (${expired}::uuid, ${idle}::uuid, ${busy}::uuid)`
  })

  it('survey / document events start the company diagnostic at most once per local day', async () => {
    const orchestrator = () => prisma.$queryRaw<Array<{ idempotency_key: string; run_after: Date; input: any }>>`
      SELECT idempotency_key, run_after, input FROM public.agent_tasks
      WHERE agent_key = 'diagnostic_orchestrator' AND company_id = ${companyId} ORDER BY created_at`
    const first = await emitPlatformEvent({ name: 'QUESTIONNAIRE_COMPLETED', companyId, dedupeKey: `t:${randomUUID()}` })
    await emitPlatformEvent({ name: 'FILE_PROCESSED', companyId, payload: { field_count: 0 }, dedupeKey: `t:${randomUUID()}` })
    await emitPlatformEvent({ name: 'FILE_PROCESSED', companyId, payload: { field_count: 3 }, dedupeKey: `t:${randomUUID()}` })
    await emitPlatformEvent({ name: 'QUESTIONNAIRE_COMPLETED', companyId, dedupeKey: `t:${randomUUID()}` })
    const slots = autoDiagnosticSlots(companyId, new Date())
    const rows = await orchestrator()
    expect(rows.map((r) => r.idempotency_key)).toEqual([slots.today.key, slots.next.key])
    expect(rows[1].run_after.toISOString()).toBe(slots.next.runAfter!.toISOString())
    expect(rows[1].input.event.payload).toEqual({ field_count: 3 })

    // A re-dispatched event books nothing.
    const [row] = await prisma.$queryRaw<Array<any>>`
      SELECT id, name, company_id, subject_type, subject_id, actor, payload FROM public.platform_events WHERE id = ${first.id}`
    await dispatchEvent({ ...row, id: Number(row.id) })
    expect(await orchestrator()).toHaveLength(2)

    settings.values.agents_auto_diagnostic = false
    await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE agent_key = 'diagnostic_orchestrator' AND company_id = ${companyId}`
    await emitPlatformEvent({ name: 'QUESTIONNAIRE_COMPLETED', companyId, dedupeKey: `t:${randomUUID()}` })
    expect(await orchestrator()).toHaveLength(0)
  })

  it('digest queries run on the real schema', async () => {
    const d = await collectAgentsDigest(new Date())
    expect(d.runs).toBeGreaterThanOrEqual(3)
    expect(d.failed).toBeGreaterThanOrEqual(2)
    expect(d.dead).toBeGreaterThanOrEqual(2)
    expect(d.topErrors.some((e) => e.code === 'UPSTREAM_DOWN' && e.agentKey === 'test_auto_flaky')).toBe(true)
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
