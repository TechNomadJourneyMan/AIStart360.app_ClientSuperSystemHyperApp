/**
 * R-015 — the crons reminders, client-digest and staff-digest had no time budget of their own: on
 * Railway `maxDuration` does nothing, and a provider that never answers (the Resend SDK has no
 * timeout) held the run — ten clients at a time — for as long as it liked. Each run now keeps the
 * platform's rule for background work (lib/automation/run-budget.ts): ≤ 2 at a time, ≤ 44 s, no
 * client STARTED with too little time left, every send cut at the deadline; the stats say what was
 * deferred and what was cut. Shortened budgets here (hundreds of ms) stand for the 44 s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientState, StaffTask } from '@/lib/automation/data'

const never = () => new Promise<never>(() => {})

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  tasks: [] as unknown[],
  /** user ids whose send never answers */
  hang: new Set<string>(),
  inFlight: 0,
  maxInFlight: 0,
  started: [] as string[],
  admins: vi.fn(async () => {}),
  adminsHang: false,
}))

vi.mock('@/lib/automation/data', () => ({
  fetchClientStates: async () => h.states,
  fetchSurveyRows: async () => new Map(),
  fetchGriDrafts: async () => new Map(),
  fetchPulseWeeks: async () => new Map(),
  fetchGriHistory: async () => new Map(),
  fetchLastDigests: async () => new Map(),
  fetchNbaDone: async () => new Map(),
  fetchOpenPlanTasks: async (ids: string[]) => new Map(ids.map((id) => [id, [{ id: `t-${id}`, title: 'Задача', priority: 1, dueDate: null }]])),
  fetchPublishedContent: async () => [],
  fetchSentDedupeKeys: async () => new Set(),
  fetchTouchedSince: async () => new Set(),
  fetchPendingRequests: async () => [],
  fetchOpenPaidRequests: async () => [],
  fetchProNoticesSince: async () => [],
  fetchOverdueStaffTasks: async () => h.tasks,
  fetchDayCounts: async () => ({ registrations: 1, surveysCompleted: 0, griCompleted: 0 }),
  fetchProfileLabels: async (ids: string[]) => new Map(ids.map((id) => [id, id])),
}))
vi.mock('@/lib/automation/survey-modes', () => ({ fetchSurveyModes: async () => new Map() }))
vi.mock('@/lib/automation/maintenance-gate', () => ({ maintenanceSkipReason: async () => null }))
vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => (key === 'request_sla_hours' ? 4 : key === 'client_digest_enabled' ? true : undefined),
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => ({ id, email: `${id}@example.test`, fullName: null, telegramChatId: null, preferences: {} }),
  claimSend: async () => ({ result: 'claimed', id: '1' }),
}))
vi.mock('@/lib/notifications', () => ({
  notifyAdmins: async () => {
    if (h.adminsHang) return never()
    await h.admins()
  },
}))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: { userId: string }) => {
    h.started.push(input.userId)
    h.inFlight += 1
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
    try {
      if (h.hang.has(input.userId)) await never()
      await new Promise((r) => setTimeout(r, 5))
      return { ok: true, delivered: { inApp: true, email: true, telegram: false } }
    } finally {
      h.inFlight -= 1
    }
  },
}))

const { runReminders } = await import('@/lib/automation/reminders')
const { runClientDigest } = await import('@/lib/automation/client-digest')
const { runStaffDigest } = await import('@/lib/automation/staff-digest')
const { AUTOMATION_CONCURRENCY, AUTOMATION_RUN_MS, runBudget } = await import('@/lib/automation/run-budget')

// Thursday 24.09.2026, 11:00 Almaty — welcome d3 is due for the «newbies» below.
const NOW = new Date('2026-09-24T06:00:00Z')
const DAY = 24 * 3_600_000
const newbie = (id: string): ClientState => ({
  user_id: id,
  registered_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
  approved_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
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
}) as ClientState
const IDS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']
/** A run of 400 ms in which nobody starts with < 150 ms left. */
const small = () => runBudget({ runMs: 400, minStartMs: 150 })

beforeEach(() => {
  h.states = IDS.map(newbie)
  h.tasks = []
  h.hang = new Set()
  h.inFlight = 0
  h.maxInFlight = 0
  h.started = []
  h.admins.mockClear()
  h.adminsHang = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('runBudget — the platform rule, not a suggestion', () => {
  it('≤ 2 at a time and ≤ 44 s, whatever is asked', () => {
    expect(AUTOMATION_CONCURRENCY).toBeLessThanOrEqual(2)
    expect(AUTOMATION_RUN_MS).toBeLessThanOrEqual(44_000)
    const b = runBudget({ runMs: 120_000, concurrency: 10, now: () => 1_000 })
    expect(b.concurrency).toBe(2)
    expect(b.deadlineAt).toBe(1_000 + 44_000)
  })
})

describe('reminders', () => {
  it('a healthy run: everyone, never more than 2 at a time', async () => {
    const stats = await runReminders(NOW, { budget: small() })
    expect(stats.sent).toBe(6)
    expect(stats.deferred).toBe(0)
    expect(stats.timedOut).toBe(0)
    expect(h.maxInFlight).toBeLessThanOrEqual(2)
  })

  it('providers that never answer: the run ends at its deadline, the cut sends and the deferred clients are reported', async () => {
    h.hang = new Set(IDS)
    const t0 = Date.now()
    const stats = await runReminders(NOW, { budget: small() })
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(h.maxInFlight).toBeLessThanOrEqual(2)
    expect(stats.timedOut).toBe(2)
    expect(stats.deferred).toBe(4)
    expect(stats.candidates).toBe(6)
    expect(stats.sent).toBe(0)
  })
})

describe('client-digest', () => {
  it('a healthy run: everyone, ≤ 2 at a time', async () => {
    const stats = await runClientDigest(NOW, { budget: small() })
    expect(stats.sent).toBe(6)
    expect(stats.deferred).toBe(0)
    expect(h.maxInFlight).toBeLessThanOrEqual(2)
  })

  it('a hung provider: cut at the deadline, the rest deferred and reported', async () => {
    h.hang = new Set(IDS)
    const t0 = Date.now()
    const stats = await runClientDigest(NOW, { budget: small() })
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(h.maxInFlight).toBeLessThanOrEqual(2)
    expect(stats.timedOut).toBe(2)
    expect(stats.deferred).toBe(4)
  })
})

describe('staff-digest', () => {
  const task = (assignee: string): StaffTask => ({ id: `t-${assignee}`, title: 'Перезвонить', assigneeId: assignee, clientId: null, dueAt: new Date(NOW.getTime() - DAY).toISOString() }) as StaffTask

  it('the admin summary goes first; assignees ≤ 2 at a time; hung sends cut, the rest deferred', async () => {
    h.tasks = IDS.map(task)
    h.hang = new Set(IDS)
    const t0 = Date.now()
    const stats = await runStaffDigest(NOW, { budget: small() })
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(h.admins).toHaveBeenCalledTimes(1)
    expect(stats.adminSummarySent).toBe(true)
    expect(h.maxInFlight).toBeLessThanOrEqual(2)
    expect(stats.timedOut).toBe(2)
    expect(stats.deferred).toBe(4)
    expect(stats.assigneesNotified).toBe(0)
  })

  it('a hung admin channel is cut too and said so; the assignees still get their run', async () => {
    h.tasks = ['u1'].map(task)
    h.adminsHang = true
    const stats = await runStaffDigest(NOW, { budget: runBudget({ runMs: 300, minStartMs: 50 }) })
    expect(stats.adminSummarySent).toBe(false)
    expect(stats.adminSummaryTimedOut).toBe(true)
  })
})
