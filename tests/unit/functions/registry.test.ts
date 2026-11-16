/**
 * lib/functions/registry.ts — the Inngest functions a process serves at /api/inngest, by its role
 * (PORTAL_ROLE, lib/runtime/role.ts). One process for everything serves the list the route always
 * had, in the same order; the portal next to an agents service leaves out the two functions of the
 * agent runtime (the service runs that work itself); the agents service has no Inngest at all.
 */
import { describe, expect, it } from 'vitest'
import { agentsMaintenance, agentsTaskRequested } from '@/lib/functions/agents'
import { inngestCronSchedules, inngestFunctionsForRole } from '@/lib/functions/registry'
import { RunJournal } from '@/lib/functions/ops-ping'

const idsOf = (functions: readonly unknown[]) => functions.map((fn) => (fn as { opts: { id: string } }).opts.id)

/** What /api/inngest served before roles existed, in its order. */
const ALL = [
  'assistant-events-retention',
  'process-omnichannel-message',
  'backfill-omnichannel',
  'omnichannel-outbound-delivery-maintenance',
  'omnichannel-maintenance',
  'agents-task-requested',
  'agents-maintenance',
  'demo-accounts-cleanup',
  'point-a-recalc',
  'point-a-nightly',
  'comm-campaign-run',
  'comm-campaign-watchdog',
  'comm-escalations',
  'comm-bot-reply',
  'pb-recompute',
  'pb-recompute-company',
  'pb-monthly-checkpoint',
  'pb-invite-external',
  // R4-A1: the heartbeat of our Inngest (lib/functions/ops-ping.ts).
  'ops-ping',
]
const AGENT_RUNTIME = ['agents-task-requested', 'agents-maintenance']

describe('inngestFunctionsForRole', () => {
  it("'all' (one process for everything, the default) is the full list in the order it always had", () => {
    expect(idsOf(inngestFunctionsForRole('all'))).toEqual(ALL)
  })

  it("'web' is the same list without the two functions of the agent runtime", () => {
    const web = inngestFunctionsForRole('web')
    expect(idsOf(web)).toEqual(ALL.filter((id) => !AGENT_RUNTIME.includes(id)))
    expect(web).toHaveLength(ALL.length - 2)
    expect(web).not.toContain(agentsTaskRequested)
    expect(web).not.toContain(agentsMaintenance)
  })

  it("'web' leaves out exactly agentsTaskRequested and agentsMaintenance, nothing else", () => {
    const web = inngestFunctionsForRole('web')
    const dropped = inngestFunctionsForRole('all').filter((fn) => !web.includes(fn))
    expect(dropped).toEqual([agentsTaskRequested, agentsMaintenance])
  })

  it("'agents' serves nothing: the agents service has no Inngest", () => {
    expect(inngestFunctionsForRole('agents')).toEqual([])
  })

  it('every function is listed once', () => {
    const ids = idsOf(inngestFunctionsForRole('all'))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns a new array every time', () => {
    const first = inngestFunctionsForRole('all')
    first.length = 0
    expect(inngestFunctionsForRole('all')).toHaveLength(ALL.length)
    expect(inngestFunctionsForRole('web')).toHaveLength(ALL.length - 2)
  })
})

// R4-A1: the scheduled functions report the end of every run to the journal of job outcomes; the
// watchdog (lib/ops/job-watchdog.ts) expects one row per cron of every function this process serves.
describe('the journal of scheduled runs', () => {
  type Opts = { id: string; triggers?: Array<{ cron?: string }>; middleware?: unknown[] }
  const optsOf = (fn: unknown) => (fn as { opts: Opts }).opts
  const cronIds = inngestFunctionsForRole('all').map(optsOf).filter((o) => (o.triggers ?? []).some((t) => t.cron)).map((o) => o.id)

  it('every function on a cron carries the journal middleware, except ops-ping, which writes its own row', () => {
    for (const fn of inngestFunctionsForRole('all')) {
      const o = optsOf(fn)
      const scheduled = (o.triggers ?? []).some((t) => t.cron)
      const journaled = (o.middleware ?? []).includes(RunJournal)
      expect(journaled, o.id).toBe(scheduled && o.id !== 'ops-ping')
    }
    expect(cronIds).toContain('point-a-nightly')
    expect(cronIds).toContain('ops-ping')
  })

  it('inngestCronSchedules: the served cron functions with their schedules, only when an Inngest is configured', () => {
    const env = { INNGEST_SELF_HOSTED_URL: 'http://inngest.railway.internal:8288' } as unknown as NodeJS.ProcessEnv
    const web = inngestCronSchedules('web', env)
    expect(web).toContainEqual({ id: 'point-a-nightly', cron: '0 22 * * *' })
    expect(web).toContainEqual({ id: 'ops-ping', cron: '*/10 * * * *' })
    expect(web).toContainEqual({ id: 'demo-accounts-cleanup', cron: 'TZ=Asia/Almaty 30 4 * * *' })
    expect(web.map((c) => c.id)).not.toContain('agents-maintenance') // served by the agents service itself
    expect(inngestCronSchedules('all', env).map((c) => c.id)).toContain('agents-maintenance')
    expect(inngestCronSchedules('agents', env)).toEqual([])
    expect(inngestCronSchedules('web', {} as NodeJS.ProcessEnv)).toEqual([])
    const held = inngestCronSchedules('web', { ...env, INNGEST_DISABLED_FUNCTIONS: 'ops-ping' } as NodeJS.ProcessEnv)
    expect(held.map((c) => c.id)).not.toContain('ops-ping')
  })
})
