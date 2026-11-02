/**
 * lib/cron/runner.ts — the in-process scheduler that replaces Vercel Cron on a persistent server.
 *
 * Every UTC minute boundary it asks `dueJobs` what is due and calls each route
 * (`GET {baseUrl}{path}` with `Authorization: Bearer {secret}`), at most two requests at a time.
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
 */
import { trackBackground } from '@/lib/background'
import { dueJobs, type CronJob } from '@/lib/cron/schedule'

const MINUTE_MS = 60_000
/** The incident rule for background work: at most two requests in flight at once. */
const MAX_CONCURRENT = 2
/** A cron route may legitimately run for minutes (maxDuration 300 s on Vercel); a hung one must not hold a slot forever. */
const FETCH_TIMEOUT_MS = 300_000

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
        try {
          if (!(await opts.claim(job.path, minute))) {
            write(`cron: ${job.path} пропущено, уже запущено другим экземпляром`)
            return
          }
        } catch (error) {
          write(`cron: ${job.path} not run, claim failed: ${messageOf(error)}`)
          return
        }
      }
      const began = now().getTime()
      const elapsed = () => `${now().getTime() - began} ms`
      try {
        const res = await fetchImpl(`${baseUrl}${job.path}`, {
          method: 'GET',
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        // Only the status matters; do not hold the slot (or the memory) for a body nobody reads.
        try { await res.body?.cancel() } catch { /* already closed */ }
        write(`cron: GET ${job.path} -> ${res.status} in ${elapsed()}${res.ok ? '' : ' (FAILED)'}`)
      } catch (error) {
        write(`cron: GET ${job.path} -> error in ${elapsed()}: ${messageOf(error)}`)
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
        for (const job of dueJobs(minuteStart)) {
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
