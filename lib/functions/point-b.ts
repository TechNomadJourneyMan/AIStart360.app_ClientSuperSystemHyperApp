import { inngest } from '@/lib/inngest'
import { getSetting } from '@/lib/settings/store'
import { createServiceClient } from '@/lib/supabase-service'
import { listPlanCompanies, monthlyReconciliation, type PlanCompany, type ReconciliationOutcome } from '@/lib/point-b/planfact/batch'
import { cronDue } from '@/lib/point-b/planfact/cron'
import { lastFinishedPeriod } from '@/lib/point-b/planfact/kpis'
import { recomputeCompany, type RecomputeOutcome } from '@/lib/point-b/planfact/recompute'
import { finishRun, startRun, type RunTotals } from '@/lib/point-b/planfact/store'
import type { Tolerances } from '@/lib/point-b/planfact/types'
import { normalizeTolerances } from '@/lib/point-b/planfact/verdict'

/**
 * Inngest wiring of the Point B recompute and of the monthly reconciliation (spec §13–§14; plan Ф6b, Task 4).
 *
 * DB discipline (the 504 of 2026-10-15 came from background jobs holding pooler connections):
 *   - one company = one short step.run, budgeted to 45 s inside (recomputeCompany);
 *   - at most RECOMPUTE_BATCH (10) companies per run; the next ten go to a fresh run through an event;
 *   - a step.sleep between companies: Inngest calls back later, nothing is held meanwhile;
 *   - one run at a time over the recompute (a shared concurrency key, limit 1), the button's single-company runs
 *     included; the button is also limited per company (1 per 10 min) — here (rateLimit) and in the route (pb_runs).
 * The schedule is the setting `pb_recompute_cron` (default Mon + Thu 22:00 UTC): the cron wakes up hourly and goes on
 * only in a scheduled hour — the «safety pass not more often than once an hour».
 * inngest 4.x registers triggers only via `triggers: [...]`.
 */

export const PB_RECOMPUTE_EVENT = 'point-b/recompute.requested'
export const PB_RECOMPUTE_CONTINUE_EVENT = 'point-b/recompute.continue'
export const PB_MONTHLY_CONTINUE_EVENT = 'point-b/monthly.continue'
/** The pause between two companies of a batch. */
export const COMPANY_PAUSE = '3s'
const RECOMPUTE_CONCURRENCY: [{ scope: 'env'; key: string; limit: number }] = [{ scope: 'env', key: '"pb-recompute"', limit: 1 }]

export interface PbStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleep(id: string, duration: string | number): Promise<unknown>
  sendEvent(id: string, payload: { name: string; data: Record<string, unknown> }): Promise<unknown>
}

export interface PbEvent { name?: string; data?: Record<string, unknown> }

export interface RecomputeDeps {
  now?: () => Date
  cron?: () => Promise<string>
  tolerances?: () => Promise<Tolerances>
  list?: typeof listPlanCompanies
  recompute?: (c: PlanCompany, ctx: { now: Date; tolerances: Tolerances }) => Promise<RecomputeOutcome>
  journal?: { start: typeof startRun; finish: typeof finishRun }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)

function withDefaults(deps: RecomputeDeps) {
  return {
    now: deps.now ?? (() => new Date()),
    cron: deps.cron ?? (() => getSetting('pb_recompute_cron')),
    tolerances: deps.tolerances ?? (async () => normalizeTolerances(await getSetting('pb_verdict_tolerances'))),
    list: deps.list ?? listPlanCompanies,
    recompute: deps.recompute ?? ((c: PlanCompany, ctx: { now: Date; tolerances: Tolerances }) =>
      recomputeCompany(createServiceClient(), { companyId: c.companyId, userId: c.userId, now: ctx.now, tolerances: ctx.tolerances })),
    journal: deps.journal ?? { start: startRun, finish: finishRun },
  }
}

const totalsOf = (outcomes: RecomputeOutcome[]): RunTotals => ({
  companies: outcomes.filter((o) => o.status === 'done').length,
  skipped: outcomes.filter((o) => o.status === 'unchanged' || o.status === 'no_plan').length,
  aiCalls: 0,
  cost: 0,
  errors: outcomes.filter((o) => o.status === 'failed').map((o) => ({ companyId: o.companyId, error: o.error ?? 'failed' })),
})

/** The scheduled pass and its continuations (exported for tests: a fake `step` replays it synchronously). */
export async function runScheduledRecompute({ event, step }: { event: PbEvent; step: PbStep }, deps: RecomputeDeps = {}) {
  const d = withDefaults(deps)
  const continuation = event.name === PB_RECOMPUTE_CONTINUE_EVENT
  const cursor = continuation ? str(event.data?.cursor) : null

  const start = await step.run('start', async () => {
    const now = d.now()
    if (!continuation && !cronDue(await d.cron(), now)) return { due: false as const }
    const tolerances = await d.tolerances()
    const page = await d.list(createServiceClient(), { after: cursor })
    const runId = page.companies.length ? await d.journal.start(createServiceClient(), { kind: 'scheduled', cursor, now }) : null
    return { due: true as const, now: now.toISOString(), tolerances, runId, companies: page.companies, next: page.next }
  })
  if (!start.due) return { skipped: 'not_due' }

  const outcomes: RecomputeOutcome[] = []
  for (let i = 0; i < start.companies.length; i++) {
    const c = start.companies[i]
    outcomes.push(await step.run(`company-${i}`, () => d.recompute(c, { now: new Date(start.now), tolerances: start.tolerances })))
    if (i < start.companies.length - 1) await step.sleep(`pause-${i}`, COMPANY_PAUSE)
  }

  if (start.companies.length) {
    await step.run('finish', () => d.journal.finish(createServiceClient(), start.runId, totalsOf(outcomes), d.now()))
  }
  if (start.next) await step.sendEvent('continue', { name: PB_RECOMPUTE_CONTINUE_EVENT, data: { cursor: start.next } })
  return { companies: start.companies.length, done: outcomes.filter((o) => o.status === 'done').length, continued: !!start.next }
}

/** One company on request (`point-b/recompute.requested` { companyId, userId, requestedBy? }). */
export async function runCompanyRecompute({ event, step }: { event: PbEvent; step: PbStep }, deps: RecomputeDeps = {}) {
  const d = withDefaults(deps)
  const companyId = str(event.data?.companyId)
  const userId = str(event.data?.userId)
  if (!companyId || !userId || !UUID_RE.test(userId)) return { skipped: 'bad_event' }
  const requestedBy = str(event.data?.requestedBy)
  const start = await step.run('start', async () => {
    const now = d.now()
    const runId = await d.journal.start(createServiceClient(), { kind: 'manual', companyId, triggeredBy: requestedBy && UUID_RE.test(requestedBy) ? requestedBy : null, now })
    return { now: now.toISOString(), runId, tolerances: await d.tolerances() }
  })
  const outcome = await step.run('company', () => d.recompute({ companyId, userId }, { now: new Date(start.now), tolerances: start.tolerances }))
  await step.run('finish', () => d.journal.finish(createServiceClient(), start.runId, totalsOf([outcome]), d.now()))
  return outcome
}

export interface MonthlyDeps {
  now?: () => Date
  list?: typeof listPlanCompanies
  reconcile?: (c: PlanCompany, ctx: { period: string; now: Date }) => Promise<ReconciliationOutcome>
}

/** The 1st of every month: the reconciliation of the month that just ended, ten companies per run. */
export async function runMonthlyReconciliation({ event, step }: { event: PbEvent; step: PbStep }, deps: MonthlyDeps = {}) {
  const now = deps.now ?? (() => new Date())
  const list = deps.list ?? listPlanCompanies
  const reconcile = deps.reconcile ?? ((c: PlanCompany, ctx: { period: string; now: Date }) =>
    monthlyReconciliation(createServiceClient(), { ...c, period: ctx.period, now: ctx.now }))
  const continuation = event.name === PB_MONTHLY_CONTINUE_EVENT
  const start = await step.run('start', async () => {
    const at = now()
    const period = (continuation ? str(event.data?.period) : null) ?? lastFinishedPeriod(at)
    const page = await list(createServiceClient(), { after: continuation ? str(event.data?.cursor) : null })
    return { now: at.toISOString(), period, companies: page.companies, next: page.next }
  })
  const outcomes: ReconciliationOutcome[] = []
  for (let i = 0; i < start.companies.length; i++) {
    outcomes.push(await step.run(`company-${i}`, () => reconcile(start.companies[i], { period: start.period, now: new Date(start.now) })))
    if (i < start.companies.length - 1) await step.sleep(`pause-${i}`, COMPANY_PAUSE)
  }
  if (start.next) await step.sendEvent('continue', { name: PB_MONTHLY_CONTINUE_EVENT, data: { cursor: start.next, period: start.period } })
  return { period: start.period, companies: outcomes.length, reminded: outcomes.filter((o) => o.reminded).length, continued: !!start.next }
}

export const pbRecompute = inngest.createFunction(
  {
    id: 'pb-recompute',
    retries: 1,
    concurrency: RECOMPUTE_CONCURRENCY,
    triggers: [{ cron: '0 * * * *' }, { event: PB_RECOMPUTE_CONTINUE_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event, step }: { event: PbEvent; step: PbStep }) => runScheduledRecompute({ event, step }),
)

export const pbRecomputeCompany = inngest.createFunction(
  {
    id: 'pb-recompute-company',
    retries: 0,
    concurrency: RECOMPUTE_CONCURRENCY,
    rateLimit: { key: 'event.data.companyId', limit: 1, period: '10m' },
    triggers: [{ event: PB_RECOMPUTE_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event, step }: { event: PbEvent; step: PbStep }) => runCompanyRecompute({ event, step }),
)

export const pbMonthlyCheckpoint = inngest.createFunction(
  {
    id: 'pb-monthly-checkpoint',
    retries: 1,
    concurrency: { limit: 1 },
    // 04:00 UTC on the 1st = 09:00 / 10:00 in Kazakhstan: the reminder arrives in the working morning.
    triggers: [{ cron: '0 4 1 * *' }, { event: PB_MONTHLY_CONTINUE_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event, step }: { event: PbEvent; step: PbStep }) => runMonthlyReconciliation({ event, step }),
)
