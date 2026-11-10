/**
 * lib/agents/queue.ts — how a freshly queued task is started, by the role of the process
 * (PORTAL_ROLE, lib/runtime/role.ts):
 *   - all (the default): exactly as before - the Inngest event when Inngest is configured, and the
 *     run in the background of the same request unless AGENT_INLINE_EXECUTION=false;
 *   - agents: the inline run only (the agents service has no Inngest);
 *   - web: neither. The task is handed to the agents service (lib/agents/remote-kick.ts) and
 *     nothing of it executes in the portal process.
 * The store, the runner, Inngest and the network are stubs; nothing touches a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  send: vi.fn(),
  getTask: vi.fn(),
  claimTask: vi.fn(),
  insertTask: vi.fn(),
  loadConfig: vi.fn(),
  runClaimedTask: vi.fn(),
  getAgent: vi.fn(),
}))
vi.mock('@/lib/inngest', () => ({ inngest: { send: h.send } }))
vi.mock('@/lib/agents/store', () => ({
  getTask: h.getTask,
  claimTask: h.claimTask,
  insertTask: h.insertTask,
  loadConfig: h.loadConfig,
}))
vi.mock('@/lib/agents/runner', () => ({ runClaimedTask: h.runClaimedTask }))
vi.mock('@/lib/agents/registry', () => ({ getAgent: h.getAgent, listAgents: () => [] }))
vi.mock('@/lib/agents/lifecycle', () => ({
  alertStuckTasks: async () => 0,
  notifyTaskStarted: async () => 'disabled',
  notifyTaskFinished: async () => 'disabled',
  safely: async (_label: string, work: () => Promise<unknown>) => {
    try {
      return await work()
    } catch {
      return null
    }
  },
}))

import { enqueueAgentTask, kickTask } from '@/lib/agents/queue'
import { pendingBackgroundCount, waitForBackgroundWork } from '@/lib/background'

const TASK = '3f2b7c1e-8a54-4d0b-9c6e-1f2a3b4c5d6e'
const OTHER = '9a1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d'
const SECRET = 'cron-secret-for-tests'
const SERVICE = 'http://agents.railway.internal:8080'
const NO_URL_LINE = '[agents] AGENTS_SERVICE_URL не задан — задача ждёт планового разбора очереди'
// The "said it once" flag of lib/agents/remote-kick.ts lives on globalThis.
const NO_URL_LOGGED = Symbol.for('aistart360.agents.kick.no_url_logged')
const PENDING_WORK = Symbol.for('aistart360.background.pending')

const AGENT = { key: 'test_agent', scope: 'platform', limits: { maxAttempts: 3, leaseSeconds: 60 } }
const taskRow = (id: string) => ({ id, agent_key: AGENT.key, company_id: null, session_id: null, lease_token: 'lease-1' })

let fetchImpl: ReturnType<typeof vi.fn>
let errors: { mock: { calls: unknown[][] } }
/** Everything started behind the call (the inline run, the hand-over) has settled. */
const settled = () => waitForBackgroundWork(1000)
const errorLines = () => errors.mock.calls.map((args) => args.join(' '))

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.send.mockResolvedValue({ ids: [] })
  // An inline run that does start goes all the way: found, claimed, run.
  h.getTask.mockImplementation(async (id: string) => taskRow(id))
  h.claimTask.mockImplementation(async (id: string) => taskRow(id))
  h.getAgent.mockReturnValue(AGENT)
  h.loadConfig.mockResolvedValue(null)
  h.insertTask.mockResolvedValue({ id: TASK, created: true })
  h.runClaimedTask.mockImplementation(async (task: { id: string }) => ({ taskId: task.id, runId: 'run-1', finalStatus: 'succeeded', summary: null, errorCode: null }))

  fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
  vi.stubGlobal('fetch', fetchImpl)
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})

  // Nothing inherited from the shell: every test names the variables it is about.
  for (const name of ['PORTAL_ROLE', 'AGENTS_SERVICE_URL', 'CRON_SECRET', 'INNGEST_EVENT_KEY', 'INNGEST_DEV', 'AGENT_INLINE_EXECUTION']) {
    vi.stubEnv(name, '')
  }
  delete (globalThis as Record<symbol, unknown>)[NO_URL_LOGGED]
})

afterEach(async () => {
  await settled()
  delete (globalThis as Record<symbol, unknown>)[NO_URL_LOGGED]
  delete (globalThis as Record<symbol, unknown>)[PENDING_WORK]
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('kickTask: one process for everything (PORTAL_ROLE unset) - as before', () => {
  it('with Inngest configured: sends agents/task.requested and also runs the task in the background', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key')

    kickTask(TASK)
    await settled()

    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send).toHaveBeenCalledWith({ name: 'agents/task.requested', data: { taskId: TASK } })
    expect(h.claimTask).toHaveBeenCalledWith(TASK, AGENT.limits.leaseSeconds)
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
    expect(h.runClaimedTask.mock.calls[0][0]).toMatchObject({ id: TASK })
  })

  it('INNGEST_DEV=1 counts as Inngest configured', async () => {
    vi.stubEnv('INNGEST_DEV', '1')
    kickTask(TASK)
    await settled()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
  })

  it('without Inngest: the inline run only', async () => {
    kickTask(TASK)
    await settled()
    expect(h.send).not.toHaveBeenCalled()
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
  })

  it('AGENT_INLINE_EXECUTION=false: the Inngest event only, nothing runs in this request', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key')
    vi.stubEnv('AGENT_INLINE_EXECUTION', 'false')

    kickTask(TASK)
    await settled()

    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.getTask).not.toHaveBeenCalled()
    expect(h.runClaimedTask).not.toHaveBeenCalled()
  })

  it('a failed Inngest send is logged and never thrown; the inline run goes on', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key')
    h.send.mockRejectedValue(new Error('inngest is down'))

    expect(() => kickTask(TASK)).not.toThrow()
    await settled()
    await Promise.resolve()

    expect(errorLines()).toEqual(['[agents] inngest send failed inngest is down'])
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
  })

  it('never asks an agents service, even when its address is set', async () => {
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)

    kickTask(TASK)
    await settled()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
  })

  it('an unknown PORTAL_ROLE is one process for everything too', async () => {
    vi.stubEnv('PORTAL_ROLE', 'worker')
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key')

    kickTask(TASK)
    await settled()

    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('kickTask: the agents role - the inline run only', () => {
  beforeEach(() => {
    vi.stubEnv('PORTAL_ROLE', 'agents')
  })

  it('runs the task in the background and sends no Inngest event, even with Inngest configured', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key')
    vi.stubEnv('INNGEST_DEV', '1')

    kickTask(TASK)
    await settled()

    expect(h.send).not.toHaveBeenCalled()
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
    expect(h.runClaimedTask.mock.calls[0][0]).toMatchObject({ id: TASK })
  })

  it('does not call itself over the network', async () => {
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)

    kickTask(TASK)
    await settled()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
  })

  it('AGENT_INLINE_EXECUTION=false still switches the inline run off: the task waits for the drain', async () => {
    vi.stubEnv('AGENT_INLINE_EXECUTION', 'false')

    kickTask(TASK)
    await settled()

    expect(h.getTask).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('kickTask: the web role - the task goes to the agents service', () => {
  beforeEach(() => {
    vi.stubEnv('PORTAL_ROLE', 'web')
  })

  it('hands the task over with one POST: no Inngest event, nothing of the task runs here', async () => {
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key')

    kickTask(TASK)
    await settled()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${SERVICE}/api/internal/agents/kick`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(init.body).toBe(`{"taskId":"${TASK}"}`)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.getTask).not.toHaveBeenCalled()
    expect(h.claimTask).not.toHaveBeenCalled()
    expect(h.runClaimedTask).not.toHaveBeenCalled()
    expect(errorLines()).toEqual([])
  })

  // Review focus: the portal must not quietly run agent work because the address was forgotten.
  it('web role without a service URL logs once and does not execute', async () => {
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('INNGEST_EVENT_KEY', 'event-key') // would send the event in the default role

    kickTask(TASK)
    kickTask(OTHER)
    await settled()
    kickTask(TASK)
    await settled()

    // not executed: neither inline nor through Inngest, and nothing was sent anywhere
    expect(h.getTask).not.toHaveBeenCalled()
    expect(h.claimTask).not.toHaveBeenCalled()
    expect(h.runClaimedTask).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
    // and the process says so, once for three tasks
    expect(errorLines()).toEqual([NO_URL_LINE])
  })

  it('AGENT_INLINE_EXECUTION does not bring the inline run back', async () => {
    for (const value of ['true', '1', '']) {
      vi.stubEnv('AGENT_INLINE_EXECUTION', value)
      kickTask(TASK)
      await settled()
    }
    expect(h.getTask).not.toHaveBeenCalled()
    expect(h.runClaimedTask).not.toHaveBeenCalled()
  })

  it('a hand-over that fails is logged and still nothing runs here: the drain of the agents service picks the task up', async () => {
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)
    fetchImpl.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))

    kickTask(TASK)
    await settled()

    expect(errorLines()).toEqual(['[agents] kick failed: ECONNREFUSED'])
    expect(h.getTask).not.toHaveBeenCalled()
    expect(h.runClaimedTask).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('returns at once and never throws, whatever the network does', async () => {
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)
    fetchImpl.mockImplementation(() => { throw new Error('fetch is broken') })

    expect(() => kickTask(TASK)).not.toThrow()
    await settled()

    expect(errorLines()).toEqual(['[agents] kick failed: Error'])
  })

  it('the hand-over counts as background work until it settles, so a shutdown waits for it', async () => {
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)
    let answer!: (res: Response) => void
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve }))

    kickTask(TASK)
    await Promise.resolve()
    expect(pendingBackgroundCount()).toBe(1)

    answer(new Response(null, { status: 202 }))
    await settled()
    expect(pendingBackgroundCount()).toBe(0)
  })
})

describe('enqueueAgentTask: a new task is started by the role of the process', () => {
  const enqueue = (extra: { kick?: boolean } = {}) => enqueueAgentTask({ agentKey: AGENT.key, companyId: null, trigger: 'manual', ...extra })

  it('the web role: the queued task is handed over, not run', async () => {
    vi.stubEnv('PORTAL_ROLE', 'web')
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)

    await expect(enqueue()).resolves.toEqual({ id: TASK, created: true })
    await settled()

    expect(h.insertTask).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body).toBe(`{"taskId":"${TASK}"}`)
    expect(h.runClaimedTask).not.toHaveBeenCalled()
  })

  it('the web role: kick: false and a repeat of an existing task hand nothing over', async () => {
    vi.stubEnv('PORTAL_ROLE', 'web')
    vi.stubEnv('AGENTS_SERVICE_URL', SERVICE)
    vi.stubEnv('CRON_SECRET', SECRET)

    await enqueue({ kick: false })
    h.insertTask.mockResolvedValue({ id: TASK, created: false })
    await enqueue()
    await settled()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(h.runClaimedTask).not.toHaveBeenCalled()
  })

  it('the default role: the queued task runs in the background of the request, as before', async () => {
    await enqueue()
    await settled()

    expect(h.runClaimedTask).toHaveBeenCalledTimes(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
