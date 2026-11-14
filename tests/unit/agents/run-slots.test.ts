/**
 * R-017 — the agents service started every kicked task at once: N kicks → N agents in one process
 * (8 GB, OOM risk). A per-process semaphore now bounds the runs (AGENT_MAX_CONCURRENCY, default 2):
 * extra kicks wait UNCLAIMED for a slot (the task stays pending in Postgres, so the per-minute drain
 * can take it too), and a queue that is full leaves the task to the drain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getTask: vi.fn(),
  claimTask: vi.fn(),
  runClaimedTask: vi.fn(),
  getAgent: vi.fn(),
}))
vi.mock('@/lib/inngest', () => ({ inngest: { send: vi.fn() } }))
vi.mock('@/lib/agents/store', () => ({ getTask: h.getTask, claimTask: h.claimTask }))
vi.mock('@/lib/agents/runner', () => ({ runClaimedTask: h.runClaimedTask }))
vi.mock('@/lib/agents/registry', () => ({ getAgent: h.getAgent, listAgents: () => [] }))
vi.mock('@/lib/agents/lifecycle', () => ({
  alertStuckTasks: async () => 0,
  notifyTaskStarted: async () => 'disabled',
  notifyTaskFinished: async () => 'disabled',
  safely: async (_l: string, work: () => Promise<unknown>) => work().catch(() => null),
}))

import { createSemaphore, agentRunSlots, resetAgentRunSlotsForTests } from '@/lib/agents/run-slots'
import { executeTaskById } from '@/lib/agents/queue'

const AGENT = { key: 'test_agent', scope: 'platform', limits: { maxAttempts: 3, leaseSeconds: 60 } }
const row = (id: string) => ({ id, agent_key: AGENT.key, company_id: null, session_id: null, lease_token: 'l' })
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('R-017 createSemaphore', () => {
  it('admits `limit` holders, queues the next ones in order, refuses past maxWaiting', async () => {
    const s = createSemaphore({ limit: 2, maxWaiting: 1, maxWaitMs: 10_000 })
    const a = await s.acquire()
    const b = await s.acquire()
    expect(a && b).toBeTruthy()
    expect(s.tryAcquire()).toBeNull()
    const c = s.acquire()
    expect(s.waiting()).toBe(1)
    expect(await s.acquire()).toBeNull() // the queue is full
    a!()
    expect(await c).toBeTypeOf('function')
    expect(s.active()).toBe(2)
    a!() // a second release of the same slot changes nothing
    expect(s.active()).toBe(2)
  })

  it('gives up a wait after maxWaitMs', async () => {
    const s = createSemaphore({ limit: 1, maxWaiting: 5, maxWaitMs: 20 })
    await s.acquire()
    expect(await s.acquire()).toBeNull()
    expect(s.waiting()).toBe(0)
  })
})

describe('R-017 executeTaskById under the process limit', () => {
  const finishers: Array<() => void> = []
  beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    vi.stubEnv('AGENT_MAX_CONCURRENCY', '2')
    vi.stubEnv('AGENT_MAX_WAITING', '1')
    resetAgentRunSlotsForTests()
    h.getAgent.mockReturnValue(AGENT)
    h.getTask.mockImplementation(async (id: string) => row(id))
    h.claimTask.mockImplementation(async (id: string) => row(id))
    h.runClaimedTask.mockImplementation((task: { id: string }) => new Promise((resolve) => {
      finishers.push(() => resolve({ taskId: task.id, runId: 'r', finalStatus: 'succeeded', summary: null, errorCode: null }))
    }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    finishers.length = 0
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetAgentRunSlotsForTests()
  })

  it('runs at most AGENT_MAX_CONCURRENCY tasks at once; the next waits unclaimed, a further one is left to the drain', async () => {
    const runs = ['t1', 't2', 't3', 't4'].map((id) => executeTaskById(id))
    await tick()
    expect(h.runClaimedTask).toHaveBeenCalledTimes(2)
    expect(h.claimTask).toHaveBeenCalledTimes(2) // t3 waits without claiming; t4 is not even queued here
    expect(agentRunSlots().waiting()).toBe(1)
    expect(await runs[3]).toBeNull()
    expect(String((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0])).toContain('agent_task_deferred')

    finishers[0]()
    await runs[0]
    await tick()
    expect(h.claimTask).toHaveBeenCalledTimes(3)
    expect(h.runClaimedTask).toHaveBeenCalledTimes(3)
    finishers[1](); finishers[2]()
    await Promise.all(runs)
    expect(agentRunSlots().active()).toBe(0)
  })

  it('frees the slot when a run throws', async () => {
    h.runClaimedTask.mockRejectedValueOnce(new Error('boom'))
    await expect(executeTaskById('t1')).rejects.toThrow('boom')
    expect(agentRunSlots().active()).toBe(0)
  })

  it('frees the slot when the task is not claimable', async () => {
    h.claimTask.mockResolvedValueOnce(null)
    expect(await executeTaskById('t1')).toBeNull()
    expect(agentRunSlots().active()).toBe(0)
  })
})
