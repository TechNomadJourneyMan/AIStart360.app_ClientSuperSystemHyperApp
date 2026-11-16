/**
 * lib/cron/runner.ts — the in-process scheduler that replaces Vercel Cron on a persistent server.
 *
 * Every UTC minute boundary it asks `dueJobs` what is due and calls each route
 * (`GET {baseUrl}{path}` with `Authorization: Bearer {secret}`), at most two requests at a time.
 * The jobs are those of the role this process started with (PORTAL_ROLE, lib/runtime/role.ts):
 * one process for everything runs the schedule it always had, the portal next to an agents service
 * leaves the agent jobs out, and the agents service runs only those, its queue drain every minute.
 *
 * Anti-goal: a job must never fire twice (duplicate client digests and emails). Missing a minute
 * is the lesser evil, so:
 *   - the minute the process started in is never run (an instance that was already up ran it, or
 *     it was due before this process could have been asked to run it);
 *   - every minute fires at most once, however often or early its timer is delivered.
 *
 * The timer is a `setTimeout` re-aimed at the next boundary on every tick, so there is no
 * `setInterval` drift. A failed call (throw, timeout or non-2xx) is logged and never stops the
 * runner. The log carries the path, the HTTP status and the duration, never the secret.
 *
 * Two more guards against the same anti-goal:
 *   - one runner per process (a second `startCronRunner` gets the first one back), so a repeated
 *     boot hook cannot double the ticker;
 *   - with `claim`, one runner per (path, minute) across processes: during a redeploy the old and
 *     the new instance both tick, and only the one that wins the claim calls the route.
 *
 * Every job is tracked as background work (lib/background.ts) from the moment it is due until its
 * call settles, so the shutdown on SIGTERM waits for it: the claim of a call cut short is already
 * spent, and no other instance would run that minute again.
 *
 * Outcomes (R4-A1, N4A-3): with `record`, every call and every failed claim is handed to the journal
 * (public.ops_job_runs, lib/ops/job-journal.ts) after it settles — the status, the HTTP code, the
 * duration and the first line of the error. The write happens outside the two slots and its failure
 * is only a log line: the journal must never hold back or break a job.
 *
 * Claims that keep failing (N4A-4): every cron depends on the claim in workflow-db, and a claim that
 * fails means the job is not called. Once claims have failed for CLAIM_OUTAGE_ALERT_MS without one
 * success in between, the runner says so on the error log and through `onClaimOutage` (wired to the
 * Telegram alarm that needs no database, lib/notifications/ops-direct.ts) — again every
 * CLAIM_OUTAGE_REPEAT_MS while it lasts, and once more when a claim answers again.
 */
import { trackBackground } from '@/lib/background'
import { dueJobs, jobsForRole, type CronJob } from '@/lib/cron/schedule'
import type { JobOutcome } from '@/lib/ops/job-journal'
import { portalRole } from '@/lib/runtime/role'

const MINUTE_MS = 60_000
/** The incident rule for background work: at most two requests in flight at once. */
const MAX_CONCURRENT = 2
/** A cron route may legitimately run for minutes (maxDuration 300 s on Vercel); a hung one must not hold a slot forever. */
const FETCH_TIMEOUT_MS = 300_000
/** Claims failing this long without a success in between are an outage: the error log and the alarm. */
export const CLAIM_OUTAGE_ALERT_MS = 5 * MINUTE_MS
/** While the outage lasts the alarm is repeated this often, not on every failed claim. */
export const CLAIM_OUTAGE_REPEAT_MS = 6 * 60 * MINUTE_MS

// The guard lives on globalThis for the same reason as the set in lib/background.ts: Next compiles
// instrumentation.ts separately from the routes, so a module-level variable is not shared.
const RUNNER_KEY = Symbol.for('aistart360.cron.runner')
type Handle = { stop(): void }
const runnerSlot = globalThis as Record<symbol, Handle | undefined>

export interface CronRunnerOptions {
  /** Origin the cron routes are served from, e.g. `http://127.0.0.1:3000`. A trailing slash is ignored. */
  baseUrl: string
  /** CRON_SECRET, sent as a bearer token. Never logged. */
  secret: string
  /** When this process started. Defaults to `now()` at start. */
  startedAt?: Date
  /**
   * Cross-instance claim, asked before each call: true = this process won the (path, minute) and
   * may call the route, false = another instance has it. A claim that throws means no call:
   * with a claim configured, a job never fires without winning it.
   */
  claim?: (path: string, minute: Date) => Promise<boolean>
  fetchImpl?: typeof fetch
  now?: () => Date
  setTimer?: typeof setTimeout
  log?: (line: string) => void
  /** Lines that need attention (claims keep failing). Default: `log`. */
  logError?: (line: string) => void
  /**
   * The journal of outcomes (lib/ops/job-journal.ts recordJobRun). Called once per call that was
   * made and once per failed claim, after it settled and outside the slots; awaited by the shutdown
   * (background work), never by the job. A rejection is logged and dropped.
   */
  record?: (outcome: JobOutcome) => Promise<unknown>
  /** Claims have kept failing (state 'down', repeated every CLAIM_OUTAGE_REPEAT_MS) or answer again after that ('recovered'). */
  onClaimOutage?: (event: ClaimOutage) => Promise<unknown> | void
}

export interface ClaimOutage {
  state: 'down' | 'recovered'
  /** The first failed claim of the streak. */
  since: Date
  /** Failed claims in a row (several jobs of one minute count one each). */
  failures: number
  /** The last error, the cron secret masked. */
  lastError: string
}

const minuteOf = (ms: number) => Math.floor(ms / MINUTE_MS)

export function startCronRunner(opts: CronRunnerOptions): Handle {
  const log = opts.log ?? ((line: string) => console.log(line))
  const write = (line: string) => {
    try {
      log(line)
    } catch {
      // a broken logger must not take the scheduler down
    }
  }

  const writeError = opts.logError
    ? (line: string) => {
        try {
          opts.logError!(line)
        } catch {
          // same as above
        }
      }
    : write

  const running = runnerSlot[RUNNER_KEY]
  if (running) {
    write('cron: scheduler already running in this process, second start ignored')
    return running
  }

  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? setTimeout
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const authorization = `Bearer ${opts.secret}`
  // Read once: a process keeps the role it booted with.
  const jobs = jobsForRole(portalRole())

  // Minutes up to and including this one are done with. Starting it at the minute of `startedAt`
  // is the "nothing in the start minute" rule; moving it up on every tick is the "once a minute" rule.
  let lastHandled = minuteOf((opts.startedAt ?? now()).getTime())
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // The secret travels in a header, but an error message could still echo it back.
  const messageOf = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return opts.secret ? message.split(opts.secret).join('***') : message
  }

  // Hand an outcome to the journal: after the call, outside the slots, never awaited by the job.
  const journal = (outcome: JobOutcome) => {
    if (!opts.record) return
    let pending: Promise<unknown>
    try {
      pending = Promise.resolve(opts.record(outcome))
    } catch (error) {
      pending = Promise.reject(error)
    }
    trackBackground(pending.catch((error) => write(`cron: ${outcome.job} outcome not recorded: ${messageOf(error)}`)))
  }

  // The streak of failed claims (N4A-4). Any answer of the claim, won or lost, ends it.
  let claimFailures = 0
  let claimFailingSince: Date | undefined
  let claimAlertedAt: number | undefined
  let claimLastError = ''
  const announceOutage = (event: ClaimOutage) => {
    if (!opts.onClaimOutage) return
    let pending: Promise<unknown>
    try {
      pending = Promise.resolve(opts.onClaimOutage(event))
    } catch (error) {
      pending = Promise.reject(error)
    }
    trackBackground(pending.catch((error) => write(`cron: claim outage alarm failed: ${messageOf(error)}`)))
  }
  const claimFailed = (message: string) => {
    const at = now()
    claimFailures += 1
    claimFailingSince ??= at
    claimLastError = message
    const lasting = at.getTime() - claimFailingSince.getTime()
    if (lasting < CLAIM_OUTAGE_ALERT_MS) return
    if (claimAlertedAt !== undefined && at.getTime() - claimAlertedAt < CLAIM_OUTAGE_REPEAT_MS) return
    claimAlertedAt = at.getTime()
    writeError(
      `cron: захват задач в workflow-db не удаётся с ${claimFailingSince.toISOString()} (${claimFailures} раз подряд) - ` +
        `задачи по расписанию НЕ выполняются: ${message}`,
    )
    announceOutage({ state: 'down', since: claimFailingSince, failures: claimFailures, lastError: message })
  }
  const claimAnswered = () => {
    if (claimFailures === 0) return
    if (claimAlertedAt !== undefined && claimFailingSince) {
      write(`cron: захват задач снова работает (неудач подряд было ${claimFailures})`)
      announceOutage({ state: 'recovered', since: claimFailingSince, failures: claimFailures, lastError: claimLastError })
    }
    claimFailures = 0
    claimFailingSince = undefined
    claimAlertedAt = undefined
    claimLastError = ''
  }

  // Two slots shared by every tick. A freed slot is handed straight to the next waiter, so the
  // count never dips below the real number in flight in between.
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = async () => {
    if (active < MAX_CONCURRENT) { active += 1; return }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }

  async function runJob(job: CronJob, minute: Date): Promise<void> {
    await acquire()
    try {
      if (stopped) return
      if (opts.claim) {
        // After the stop check and right before the call, so a claim is never taken and then dropped.
        let won: boolean
        try {
          won = await opts.claim(job.path, minute)
        } catch (error) {
          const message = messageOf(error)
          write(`cron: ${job.path} not run, claim failed: ${message}`)
          const at = now()
          journal({ job: job.path, kind: 'cron', scheduledFor: minute, startedAt: at, finishedAt: at, durationMs: 0, status: 'claim_failed', error: `claim failed: ${message}` })
          claimFailed(message)
          return
        }
        claimAnswered()
        if (!won) {
          write(`cron: ${job.path} пропущено, уже запущено другим экземпляром`)
          return
        }
      }
      const startedAt = now()
      const began = startedAt.getTime()
      const elapsedMs = () => now().getTime() - began
      try {
        const res = await fetchImpl(`${baseUrl}${job.path}`, {
          method: 'GET',
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        // Only the status matters; do not hold the slot (or the memory) for a body nobody reads.
        try { await res.body?.cancel() } catch { /* already closed */ }
        const took = elapsedMs()
        write(`cron: GET ${job.path} -> ${res.status} in ${took} ms${res.ok ? '' : ' (FAILED)'}`)
        journal({
          job: job.path, kind: 'cron', scheduledFor: minute, startedAt, finishedAt: now(), durationMs: took,
          status: res.ok ? 'ok' : 'http_error', httpStatus: res.status, error: res.ok ? null : `HTTP ${res.status}`,
        })
      } catch (error) {
        const took = elapsedMs()
        const message = messageOf(error)
        write(`cron: GET ${job.path} -> error in ${took} ms: ${message}`)
        const timedOut = (error as { name?: unknown } | null)?.name === 'TimeoutError'
        journal({
          job: job.path, kind: 'cron', scheduledFor: minute, startedAt, finishedAt: now(), durationMs: took,
          status: timedOut ? 'timeout' : 'error', error: message,
        })
      }
    } finally {
      release()
    }
  }

  function arm() {
    if (stopped) return
    const t = now().getTime()
    timer = setTimer(tick, (minuteOf(t) + 1) * MINUTE_MS - t)
    // The server keeps the process alive; the scheduler alone must not.
    ;(timer as { unref?: () => void }).unref?.()
  }

  function tick() {
    timer = undefined
    if (stopped) return
    try {
      const minute = minuteOf(now().getTime())
      if (minute > lastHandled) {
        lastHandled = minute
        const minuteStart = new Date(minute * MINUTE_MS)
        for (const job of dueJobs(minuteStart, jobs)) {
          // fire and forget: a slow job must not delay the next tick, but a shutdown must see it
          trackBackground(runJob(job, minuteStart).catch((error) => write(`cron: ${job.path} not run: ${messageOf(error)}`)))
        }
      }
    } catch (error) {
      write(`cron: tick failed: ${messageOf(error)}`)
    } finally {
      arm()
    }
  }

  const handle: Handle = {
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      // Only our own guard: a handle stopped late must not free the slot of the runner that replaced it.
      if (runnerSlot[RUNNER_KEY] === handle) delete runnerSlot[RUNNER_KEY]
    },
  }

  arm() // if this throws, the guard below is not set and a later start is not blocked
  runnerSlot[RUNNER_KEY] = handle
  write('cron: scheduler started (UTC schedule, one tick per minute)')

  return handle
}
