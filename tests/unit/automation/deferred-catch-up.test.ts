/**
 * Review of wave 1A (MEDIUM, throughput): the 44 s / ≤ 2 budgets of the client mailings (R-015) can
 * defer clients on every run, and what was deferred must not be lost:
 *   • client-digest (weekly): «a repeat run the same week sends only to them» — but nothing ran one.
 *     There is now a catch-up slot the same Monday an hour later (04:26 and 05:26 UTC), and a run
 *     starts only the clients without this week's digest (key client_digest:<user>:<monday>, read
 *     from the journal in one query) — the ones already sent no longer eat the budget as duplicates;
 *   • reminders (daily): each touch's window is days long and its key does not change from one day
 *     to the next, so the next day's run sends what was deferred; the touches already sent are
 *     dropped before the run (same journal read). The pulse reminder was the exception — Fridays
 *     only, so one deferred on Friday was lost for the week: on Saturday it now goes to the clients
 *     no automatic reminder reached on Friday (same weekly key, so never twice).
 * The send is faked with a journal (dedupe by key) and a clock: every call — a send or the journal
 * round trips of a duplicate — takes 100 ms of a budget that starts two (or three) clients.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientState } from '@/lib/automation/data'
import type { RunBudget } from '@/lib/automation/run-budget'

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  pulse: new Map<string, string[]>(),
  /** automation_sends: dedupe key → who, whether it counts toward the weekly cap, when. */
  journal: new Map<string, { userId: string; countsTowardCap: boolean; at: number }>(),
  /** Every notifyClient call: [userId, dedupeKey]. */
  calls: [] as Array<[string, string]>,
  clock: 0,
}))

vi.mock('@/lib/automation/data', () => ({
  fetchClientStates: async () => h.states,
  fetchSurveyRows: async () => new Map(),
  fetchGriDrafts: async () => new Map(),
  fetchPulseWeeks: async (ids: string[]) => new Map(ids.filter((id) => h.pulse.has(id)).map((id) => [id, h.pulse.get(id)!])),
  fetchGriHistory: async () => new Map(),
  fetchLastDigests: async () => new Map(),
  fetchNbaDone: async () => new Map(),
  fetchOpenPlanTasks: async (ids: string[]) => new Map(ids.map((id) => [id, [{ id: `t-${id}`, title: 'Задача', priority: 1, dueDate: null }]])),
  fetchPublishedContent: async () => [],
  fetchSentDedupeKeys: async (keys: string[]) => new Set(keys.filter((k) => h.journal.has(k))),
  fetchTouchedSince: async (ids: string[], sinceIso: string) =>
    new Set([...h.journal.values()].filter((s) => s.countsTowardCap && ids.includes(s.userId) && s.at >= Date.parse(sinceIso)).map((s) => s.userId)),
}))
vi.mock('@/lib/automation/survey-modes', () => ({ fetchSurveyModes: async () => new Map() }))
vi.mock('@/lib/automation/maintenance-gate', () => ({ maintenanceSkipReason: async () => null }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => (key === 'client_digest_enabled' ? true : undefined) }))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => ({ id, email: `${id}@example.test`, fullName: null, telegramChatId: null, preferences: {} }),
}))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: { userId: string; dedupeKey: string; automated?: { countsTowardCap?: boolean } }, now: Date) => {
    h.calls.push([input.userId, input.dedupeKey])
    h.clock += 100
    if (h.journal.has(input.dedupeKey)) return { ok: true, skipped: 'duplicate', delivered: { inApp: false, email: false, telegram: false } }
    h.journal.set(input.dedupeKey, { userId: input.userId, countsTowardCap: input.automated?.countsTowardCap !== false, at: now.getTime() })
    return { ok: true, delivered: { inApp: true, email: true, telegram: false } }
  },
}))

const { runClientDigest } = await import('@/lib/automation/client-digest')
const { runReminders, planReminders } = await import('@/lib/automation/reminders')
const { CRON_JOBS, dueJobs, jobsForRole } = await import('@/lib/cron/schedule')
const { expectedJobs } = await import('@/lib/ops/job-watchdog')

const DAY = 24 * 3_600_000
const HOUR = 3_600_000
/** A budget that starts `n` clients one at a time (each call takes 100 ms of the fake clock). */
const budget = (n = 2): RunBudget => ({ deadlineAt: h.clock + 100 * n + 50, concurrency: 1, minStartMs: 100, now: () => h.clock })
const usersCalled = () => Array.from(new Set(h.calls.map(([u]) => u))).sort()
const sentKeys = () => Array.from(h.journal.keys()).sort()

function client(id: string, patch: Partial<ClientState> = {}, now: Date = new Date()): ClientState {
  return {
    user_id: id,
    registered_at: new Date(now.getTime() - 3 * DAY).toISOString(),
    approved_at: new Date(now.getTime() - 3 * DAY).toISOString(),
    status: 'approved',
    survey_steps: 0,
    survey_filled_steps: [],
    survey_first_at: null,
    survey_last_change_at: null,
    survey_completed: false,
    point_a_at: null,
    gri_started_at: null,
    gri_draft_updated_at: null,
    gri_completed_at: null,
    ...patch,
  }
}

beforeEach(() => {
  h.states = []
  h.pulse = new Map()
  h.journal = new Map()
  h.calls = []
  h.clock = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('client-digest: the catch-up slot the same Monday sends only to the clients not reached', () => {
  // Monday 23.11.2026, 09:26 and 10:26 Almaty.
  const MON_0426 = new Date('2026-11-23T04:26:00Z')
  const MON_0526 = new Date('2026-11-23T05:26:00Z')
  const IDS = ['c1', 'c2', 'c3', 'c4']

  it('the first run reaches two of four; the catch-up run starts only the other two (no duplicates eat its budget); a third run starts nobody', async () => {
    h.states = IDS.map((id) => client(id, {}, MON_0426))
    const first = await runClientDigest(MON_0426, { budget: budget(2) })
    expect(first).toMatchObject({ sent: 2, deferred: 2 })
    const reached = usersCalled()

    h.calls = []
    const catchUp = await runClientDigest(MON_0526, { budget: budget(2) })
    expect(catchUp).toMatchObject({ sent: 2, deferred: 0, duplicate: 0, alreadySent: 2 })
    expect(usersCalled()).toEqual(IDS.filter((id) => !reached.includes(id)))
    // one digest per client per week: the key is the Monday of the week
    expect(sentKeys()).toEqual(IDS.map((id) => `client_digest:${id}:2026-11-23`))

    h.calls = []
    const again = await runClientDigest(new Date(MON_0526.getTime() + 10 * 60_000), { budget: budget(2) })
    expect(again).toMatchObject({ sent: 0, deferred: 0, alreadySent: 4 })
    expect(h.calls).toEqual([])
  })

  it('next week everyone is due again (a new key)', async () => {
    h.states = IDS.map((id) => client(id, {}, MON_0426))
    await runClientDigest(MON_0426, { budget: budget(4) })
    h.calls = []
    const next = await runClientDigest(new Date(MON_0426.getTime() + 7 * DAY), { budget: budget(4) })
    expect(next).toMatchObject({ sent: 4, alreadySent: 0 })
    expect(sentKeys().filter((k) => k.endsWith(':2026-11-30'))).toHaveLength(4)
  })

  it('the schedule: Mondays at 04:26 and 05:26 UTC, nothing else; one watchdog expectation for the path (keyed by path)', () => {
    const job = CRON_JOBS.find((j) => j.path === '/api/cron/client-digest')!
    const week = Array.from({ length: 7 * 24 * 60 }, (_, m) => new Date(Date.UTC(2026, 10, 23, 0, m)))
    const fired = week.filter((minute) => dueJobs(minute, [job]).length > 0).map((m) => m.toISOString())
    expect(fired).toEqual(['2026-11-23T04:26:00.000Z', '2026-11-23T05:26:00.000Z'])
    // the catch-up minute is the job's own: nothing else of the portal runs then
    expect(dueJobs(MON_0526, jobsForRole('all')).map((j) => j.path)).toEqual(['/api/cron/client-digest'])
    const exp = expectedJobs('all', []).filter((e) => e.job === '/api/cron/client-digest')
    expect(exp).toHaveLength(1)
    expect(exp[0].gapMs).toBe(7 * DAY - HOUR)
  })
})

describe('reminders: what a run defers, the next day’s run sends', () => {
  // Thursday 24.09.2026, 11:00 Almaty: welcome d3 is due for the newbies (approved 3 days ago).
  const THU = new Date('2026-09-24T06:00:00Z')
  const FRI = new Date(THU.getTime() + DAY)
  const IDS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']

  it('welcome d3 deferred on Thursday goes out on Friday (same key, window of days); those already sent are not even started', async () => {
    h.states = IDS.map((id) => client(id, {}, THU))
    const thu = await runReminders(THU, { budget: budget(3) })
    expect(thu).toMatchObject({ sent: 3, deferred: 3 })
    const reached = usersCalled()

    h.calls = []
    const fri = await runReminders(FRI, { budget: budget(3) })
    expect(fri).toMatchObject({ sent: 3, deferred: 0 })
    expect(usersCalled()).toEqual(IDS.filter((id) => !reached.includes(id)))
    expect(sentKeys()).toEqual(IDS.map((id) => `welcome:d3:${id}`).sort())
  })
})

describe('reminders: the pulse reminder deferred on Friday goes out on Saturday', () => {
  // Friday 25.09.2026 and Saturday 26.09.2026, 11:00 Almaty; the streak: two weeks before this one.
  const FRI = new Date('2026-09-25T06:00:00Z')
  const SAT = new Date(FRI.getTime() + DAY)
  const SUN = new Date(FRI.getTime() + 2 * DAY)
  const WEEKS = ['2026-09-14', '2026-09-07']
  const pulser = (id: string) => client(id, { survey_completed: true, survey_steps: 12, gri_started_at: '2026-08-20T00:00:00Z', gri_completed_at: '2026-08-26T00:00:00Z' }, FRI)

  it('Friday reaches two of four; Saturday sends the other two (key of the week), not the two already sent', async () => {
    const IDS = ['p1', 'p2', 'p3', 'p4']
    h.states = IDS.map(pulser)
    for (const id of IDS) h.pulse.set(id, WEEKS)
    const fri = await runReminders(FRI, { budget: budget(2) })
    expect(fri).toMatchObject({ sent: 2, deferred: 2 })
    const reached = usersCalled()

    h.calls = []
    const sat = await runReminders(SAT, { budget: budget(2) })
    expect(sat.sent).toBe(2)
    expect(usersCalled()).toEqual(IDS.filter((id) => !reached.includes(id)))
    expect(sentKeys()).toEqual(IDS.map((id) => `pulse_reminder:${id}:2026-09-21`).sort())

    h.calls = []
    await runReminders(SUN, { budget: budget(4) })
    expect(h.calls).toEqual([])
  })

  it('on Saturday not to a client another automatic reminder reached on Friday (one touch a day stays one touch a day)', async () => {
    h.states = [pulser('busy')]
    h.pulse.set('busy', WEEKS)
    h.journal.set('gri_rescan:busy:2026-06-25', { userId: 'busy', countsTowardCap: true, at: FRI.getTime() - HOUR })
    const sat = await runReminders(SAT, { budget: budget(2) })
    expect(sat.sent).toBe(0)
    expect(h.calls).toEqual([])
  })

  it('planReminders: Saturday only with the catch-up flag; Friday as before', () => {
    const s = pulser('pl')
    const base = { state: s, surveySteps: [], draft: null, pulseWeeks: WEEKS }
    expect(planReminders(base, SAT)).toEqual([])
    expect(planReminders({ ...base, pulseCatchUp: true }, SAT)).toEqual([expect.objectContaining({ kind: 'pulse_reminder', dedupeKey: 'pulse_reminder:pl:2026-09-21' })])
    expect(planReminders({ ...base, pulseCatchUp: true }, SUN)).toEqual([])
    expect(planReminders(base, FRI)).toEqual([expect.objectContaining({ dedupeKey: 'pulse_reminder:pl:2026-09-21' })])
  })
})
