import { Middleware, type InngestFunction } from 'inngest'
import { inngest } from '@/lib/inngest'
import { inngestJobName, recordJobRun, shortJobError, type JobOutcome } from '@/lib/ops/job-journal'

/**
 * lib/functions/ops-ping.ts — the heartbeat of our Inngest (R4-A1, N4A-3 / R-062).
 *
 *   ops-ping      a function on its own cron (every 10 min) that only writes a row to the journal
 *                 (public.ops_job_runs, job 'inngest:ops-ping'): the whole chain «Inngest server
 *                 fires the cron → calls the portal's /api/inngest → the portal writes the database»
 *                 in one row. A write that fails fails the run (visible in the Inngest UI too).
 *   RunJournal    a middleware that writes the end of every run of a scheduled function to the same
 *                 journal: 'ok' when it completes, 'error' when its last attempt fails (an attempt
 *                 that will be retried is not an outcome yet). The watchdog (lib/ops/job-watchdog.ts)
 *                 compares the last row of each function with its cron.
 *   withRunJournal attaches RunJournal to a function that is already created, so the function
 *                 files stay as they are (lib/functions/point-a.ts and the rest): the registry
 *                 (lib/functions/registry.ts) wraps the scheduled ones. The SDK (inngest 4.x) reads a
 *                 function's middleware from `opts.middleware` on every request
 *                 (InngestCommHandler: matchedFn.fn.opts.middleware), which is what this relies on —
 *                 pinned by tests/unit/functions/ops-ping.test.ts with the real serve handler.
 *
 * The journal write is best effort (lib/ops/job-journal.ts): it never throws into a run and is
 * bounded in time; a hook that fails anyway is caught by the SDK's middleware manager.
 */

export const OPS_PING_ID = 'ops-ping'
export const OPS_PING_CRON = '*/10 * * * *'

type FnLike = InngestFunction.Like
type FnOpts = { id?: string; triggers?: Array<{ cron?: string; event?: unknown }>; middleware?: unknown[] }

const optsOf = (fn: FnLike): FnOpts => ((fn as unknown as { opts?: FnOpts }).opts ?? {})

/** The function id as configured (without the app prefix). */
export function functionIdOf(fn: FnLike): string {
  return optsOf(fn).id ?? ''
}

/** The cron expressions of a function's triggers (Inngest syntax, a 'TZ=… ' prefix included). */
export function cronTriggersOf(fn: FnLike): string[] {
  return (optsOf(fn).triggers ?? []).map((t) => t.cron).filter((c): c is string => typeof c === 'string' && c.trim() !== '')
}

/** When the run began, as well as the SDK tells: the time of its triggering event (the cron tick), else now. */
function runStartedAt(ctx: unknown): Date {
  const ts = (ctx as { event?: { ts?: unknown } } | null)?.event?.ts
  const n = typeof ts === 'number' ? ts : Number.NaN
  return Number.isFinite(n) && n > 0 ? new Date(n) : new Date()
}

export type RecordFn = (outcome: JobOutcome) => Promise<unknown>

/** Where RunJournal writes; replaceable in tests. */
const RECORD_KEY = Symbol.for('aistart360.ops.inngest.record')
export function setRunJournalRecorder(record: RecordFn | null): void {
  ;(globalThis as Record<symbol, RecordFn | null | undefined>)[RECORD_KEY] = record
}
function recorder(): RecordFn {
  return (globalThis as Record<symbol, RecordFn | null | undefined>)[RECORD_KEY] ?? ((outcome) => recordJobRun(outcome))
}

export class RunJournal extends Middleware.BaseMiddleware {
  readonly id = 'aistart360-run-journal'

  async onRunComplete(arg: Middleware.OnRunCompleteArgs): Promise<void> {
    const id = (arg.fn as unknown as { opts?: { id?: string } }).opts?.id ?? 'unknown'
    const startedAt = runStartedAt(arg.ctx)
    await recorder()({ job: inngestJobName(id), kind: 'inngest', startedAt, status: 'ok' })
  }

  async onRunError(arg: Middleware.OnRunErrorArgs): Promise<void> {
    if (!arg.isFinalAttempt) return // it will be retried: not an outcome yet
    const id = (arg.fn as unknown as { opts?: { id?: string } }).opts?.id ?? 'unknown'
    const startedAt = runStartedAt(arg.ctx)
    await recorder()({ job: inngestJobName(id), kind: 'inngest', startedAt, status: 'error', error: shortJobError(arg.error) })
  }
}

/**
 * Attaches RunJournal to `fn` (once) and returns the same object, so identity checks in the
 * registry keep working.
 */
export function withRunJournal<T extends FnLike>(fn: T): T {
  const opts = (fn as unknown as { opts?: FnOpts }).opts
  if (!opts) return fn
  const list = opts.middleware ?? []
  if (!list.includes(RunJournal)) opts.middleware = [...list, RunJournal]
  return fn
}

export const opsPing = inngest.createFunction(
  {
    id: OPS_PING_ID,
    retries: 0,
    concurrency: { limit: 1 },
    // BE-06 (lib/functions/limits.ts): a ping that waited longer than its period says nothing new.
    timeouts: { start: '5m', finish: '1m' },
    triggers: [{ cron: OPS_PING_CRON }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event }: { event?: { ts?: number } }) => {
    const startedAt = runStartedAt({ event })
    const written = await recorder()({ job: inngestJobName(OPS_PING_ID), kind: 'inngest', startedAt, status: 'ok' })
    // recordJobRun resolves false when the row did not go in: the run says so too.
    if (written === false) throw new Error('ops-ping: the journal row was not written (see the server log)')
    return { ok: true }
  },
)
