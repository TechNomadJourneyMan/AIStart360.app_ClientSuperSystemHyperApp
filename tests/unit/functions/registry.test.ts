/**
 * lib/functions/registry.ts — the Inngest functions a process serves at /api/inngest, by its role
 * (PORTAL_ROLE, lib/runtime/role.ts). One process for everything serves the list the route always
 * had, in the same order; the portal next to an agents service leaves out the two functions of the
 * agent runtime (the service runs that work itself); the agents service has no Inngest at all.
 */
import { describe, expect, it } from 'vitest'
import { agentsMaintenance, agentsTaskRequested } from '@/lib/functions/agents'
import { inngestFunctionsForRole } from '@/lib/functions/registry'

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
