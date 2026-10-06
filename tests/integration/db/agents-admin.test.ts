/**
 * Agent Control Center data layer (lib/agents/admin.ts) on the real database.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('agent control center data', async () => {
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const admin = await import('@/lib/agents/admin')
  const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
  const { AgentError } = await import('@/lib/agents/types')

  const key = `cc_${Date.now().toString(36)}`
  const platformKey = `${key}_p`
  const limits = { maxAttempts: 1, leaseSeconds: 60, perRunBudgetUsd: 1, dailyBudgetUsd: 5, maxLlmCalls: 1, maxOutputTokens: 200 }

  beforeAll(() => {
    process.env.AGENT_INLINE_EXECUTION = 'false'
    __useTestAgents([
      {
        key, name: 'CC test', description: 'fails once', version: '1.0.0', scope: 'platform', tier: 'none',
        permissions: { READ_CLIENT_DATA: 'ALLOW', SEND_EMAIL: 'ALLOW' }, tools: [], limits,
        inputSchema: z.object({}).passthrough(),
        async run() { throw new AgentError('BOOM', 'сбой', false) },
      },
      {
        key: platformKey, name: 'CC scheduled', description: 'scheduled', version: '1.0.0', scope: 'platform', tier: 'none',
        permissions: {}, tools: [], limits, triggers: { cron: '*/15 * * * *' },
        inputSchema: z.object({}).passthrough(),
        async run() { return { summary: 'ok' } },
      },
    ])
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE agent_key IN (${key}, ${platformKey})`
    await prisma.$executeRaw`DELETE FROM public.agent_configs WHERE agent_key IN (${key}, ${platformKey})`
    await prisma.$executeRaw`DELETE FROM public.agent_permission_grants WHERE agent_key IN (${key}, ${platformKey})`
    await prisma.$disconnect()
  })

  it('lists agents with effective permissions, next run and stats', async () => {
    const { id } = await enqueueAgentTask({ agentKey: key, companyId: null, trigger: 'manual', kick: false })
    await executeTaskById(id)
    const list = await admin.listAgentOverviews(new Date('2026-10-06T10:07:00Z'))
    const a = list.find((x) => x.key === key)!
    expect(a.permissions.SEND_EMAIL).toBe('REQUIRE_APPROVAL') // ceiling
    expect(a.permissions.DELETE_DATA).toBe('DENY')
    expect(a.stats).toMatchObject({ runs7d: 1, failed7d: 1, errorRate: 1, dead24h: 1, lastRunStatus: 'failed' })
    const p = list.find((x) => x.key === platformKey)!
    expect(p.nextRunAt).toBe('2026-10-06T10:15:00.000Z')
  })

  it('validates config changes and keeps grants under the ceiling', async () => {
    expect(await admin.updateAgentConfig(key, { scheduleCron: 'every minute' }, 'staff:t')).toEqual({ ok: false, error: 'invalid_cron' })
    expect(await admin.updateAgentConfig(key, { enabled: false, dailyBudgetUsd: 2 }, 'staff:t')).toEqual({ ok: true })
    const [cfg] = await prisma.$queryRaw<Array<{ enabled: boolean; daily_budget_usd: unknown; updated_by: string }>>`
      SELECT enabled, daily_budget_usd, updated_by FROM public.agent_configs WHERE agent_key = ${key}`
    expect(cfg).toMatchObject({ enabled: false, updated_by: 'staff:t' })
    expect(Number(cfg.daily_budget_usd)).toBe(2)

    const res = await admin.setAgentGrants(key, { SEND_EMAIL: 'ALLOW', READ_CLIENT_DATA: 'DENY' }, 'staff:t')
    expect(res).toMatchObject({ ok: true, capped: ['SEND_EMAIL'] })
    if (res.ok) {
      expect(res.effective.SEND_EMAIL).toBe('REQUIRE_APPROVAL')
      expect(res.effective.READ_CLIENT_DATA).toBe('DENY')
    }
    const reset = await admin.setAgentGrants(key, { READ_CLIENT_DATA: null }, 'staff:t')
    expect(reset.ok && reset.effective.READ_CLIENT_DATA).toBe('ALLOW')
  })

  it('retries a dead task and cancels a queued one; filters and details work', async () => {
    await admin.updateAgentConfig(key, { enabled: true }, 'staff:t')
    const { id } = await enqueueAgentTask({ agentKey: key, companyId: null, trigger: 'manual', kick: false, idempotencyKey: `cc-${randomUUID()}` })
    await executeTaskById(id)
    expect(await admin.retryTask(id)).toBe(true)
    const [t] = await prisma.$queryRaw<Array<{ status: string; max_attempts: number }>>`SELECT status, max_attempts FROM public.agent_tasks WHERE id = ${id}::uuid`
    expect(t).toEqual({ status: 'queued', max_attempts: 2 })
    expect(await admin.cancelTask(id, 'staff:t')).toBe(true)
    expect(await admin.retryTask(randomUUID())).toBe(false)

    const listed = await admin.listTasks({ agentKey: key, status: 'cancelled' })
    expect(listed.items.map((i) => i.id)).toContain(id)
    const detail = await admin.getTaskDetail(id)
    expect(detail?.runs).toHaveLength(1)
    expect(detail?.events.some((e) => e.type === 'run.failed')).toBe(true)
  })

  it('summarises cost by agent and day', async () => {
    const s = await admin.costSummary(7)
    expect(s.byAgent.find((r) => r.agent_key === key)?.runs).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(s.byDay)).toBe(true)
  })
})
