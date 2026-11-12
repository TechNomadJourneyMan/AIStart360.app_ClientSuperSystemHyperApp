/**
 * lib/runtime/server-start.ts — what a persistent server (Railway, PERSISTENT_SERVER=1) starts once
 * at boot, from instrumentation.ts:
 *   - the Workflow queue (the Postgres world needs a long-lived process to poll for jobs). It starts
 *     in the background: Next awaits register() before it serves, so a Workflow database that is
 *     down would otherwise keep the whole portal from booting. A failed start is retried with an
 *     exponential backoff, without limit, and its state is in lib/runtime/workflow-queue-status.ts
 *     for /api/health;
 *   - the in-process cron (Vercel Cron's replacement, lib/cron/runner.ts), but not while the deployed
 *     vercel.json still has crons: Vercel would run the same jobs;
 *   - the SIGTERM/SIGINT handler: a redeploy stops the old instance, and it first stops the cron and
 *     waits for after-response work (lib/background.ts, which includes the cron calls in flight) so a
 *     bot answer, a queue drain or a digest is not cut. With the Workflow queue running it also waits
 *     for graphile-worker to finish its own stop (see the shutdown below).
 *
 * Next's own signal handler is turned off with NEXT_MANUAL_SIG_HANDLE=true, so this one is the only one.
 *
 * The same build also runs as the agents service (PORTAL_ROLE=agents, lib/runtime/role.ts). It
 * does not start the Workflow queue: the queue belongs to the portal, and a second service polling
 * it would take a share of the portal's workflow jobs and run them in the agents process. Its
 * in-process cron is what calls GET /api/cron/agents every minute, the service's only maintenance
 * loop, so there a cron that did not start is logged as an error. The cron runner itself and the
 * shutdown are the same in every role.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createPgCronClaim } from '@/lib/cron/claim'
import { startCronRunner } from '@/lib/cron/runner'
import { pendingBackgroundCount, waitForBackgroundWork } from '@/lib/background'
import { maskConnectionSecrets } from '@/lib/runtime/mask-secrets'
import { isPersistentServer } from '@/lib/runtime/platform'
import { portalRole, servesWeb } from '@/lib/runtime/role'
import { setWorkflowQueueStatus } from '@/lib/runtime/workflow-queue-status'

/** The deploy's grace period is longer than this; past it the work is abandoned rather than hang the stop. */
const SHUTDOWN_WAIT_MS = 55_000
/** The project rule for background work is at most two at a time; the queue's own default is 10. */
const QUEUE_CONCURRENCY = '2'
/** Queue start retries: 5 s after the first failure, doubling, never more than 5 min apart. */
const QUEUE_RETRY_FIRST_MS = 5_000
const QUEUE_RETRY_MAX_MS = 5 * 60_000

/** How long to wait after the n-th failed queue start (n from 1) before the next attempt. */
export function queueRetryDelayMs(failures: number): number {
  const doublings = Math.max(0, Math.min(failures - 1, 16)) // 2^16 * 5 s is far past the cap already
  return Math.min(QUEUE_RETRY_FIRST_MS * 2 ** doublings, QUEUE_RETRY_MAX_MS)
}

type Signal = 'SIGTERM' | 'SIGINT'
// Partial, like lib/runtime/platform.ts: Next's typings make NODE_ENV mandatory in ProcessEnv.
type Env = Partial<NodeJS.ProcessEnv>

export interface ServerStartDeps {
  /** Starts the Workflow world's queue. Default: `getWorld().start()` from `workflow/runtime`. */
  startWorld?: () => Promise<void>
  startCron?: typeof startCronRunner
  onSignal?: (sig: Signal, handler: () => void) => void
  exit?: (code: number) => void
  /** Where the deployed vercel.json is looked for. Default: process.cwd(). */
  cwd?: () => string
  log?: (line: string) => void
  /** Failures that need attention (the queue cannot start, the cron runner is refused). Default: console.error. */
  logError?: (line: string) => void
}

async function startWorldDefault(): Promise<void> {
  // The world reads this when getWorld() first builds it (and is cached after that), so it is set
  // before. A value someone put there on purpose stays; an empty one counts as unset, as the world reads it.
  if (!process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY) {
    process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY = QUEUE_CONCURRENCY
  }
  const { getWorld } = await import('workflow/runtime')
  await getWorld().start?.()
}

/**
 * How many crons the deployed vercel.json still has. While there are any, Vercel runs those jobs
 * itself. A missing, unreadable or unparsable file counts as none (Vercel is then not running them).
 */
function vercelCronCount(dir: string): number {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, 'vercel.json'), 'utf8')) as { crons?: unknown } | null
    return Array.isArray(parsed?.crons) ? parsed.crons.length : 0
  } catch {
    return 0
  }
}

interface QueueStart {
  /** Has a start attempt gone through? Only then does graphile-worker stop on its own and re-send the signal. */
  running(): boolean
  /** No further attempts (shutdown). An attempt already in flight is left to settle. */
  stopRetrying(): void
}

/**
 * Starts the Workflow queue without blocking the caller: the first attempt now, then after every
 * failure one log line and another attempt after queueRetryDelayMs. The state goes to
 * lib/runtime/workflow-queue-status.ts on every step.
 */
function startQueueInBackground(
  startWorld: () => Promise<void>,
  connectionString: string | undefined,
  log: (line: string) => void,
  logError: (line: string) => void,
): QueueStart {
  let running = false
  let stopped = false
  let attempts = 0
  let lastError: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const attempt = (): void => {
    timer = undefined
    if (stopped) return
    attempts += 1
    setWorkflowQueueStatus({ state: attempts === 1 ? 'starting' : 'retrying', attempts, ...(lastError ? { lastError } : {}) })
    let started: Promise<void>
    try {
      started = Promise.resolve(startWorld())
    } catch (error) {
      started = Promise.reject(error)
    }
    started.then(
      () => {
        running = true
        setWorkflowQueueStatus({ state: 'running', attempts })
        log(`server: Workflow queue started (postgres world)${attempts > 1 ? `, попытка ${attempts}` : ''}`)
        if (stopped) {
          log('server: очередь Workflow запустилась уже во время остановки')
        }
      },
      (error: unknown) => {
        // The message can echo the connection string, its user or its password.
        lastError = maskConnectionSecrets(error instanceof Error ? error.message : String(error), connectionString)
        if (stopped) {
          log(`server: Workflow queue failed to start (попытка ${attempts}): ${lastError}; идёт остановка, повторов не будет`)
          return
        }
        const delay = queueRetryDelayMs(attempts)
        setWorkflowQueueStatus({ state: 'retrying', attempts, lastError })
        // Not rethrown: without the queue workflow runs are accepted and wait, while the rest of the
        // portal serves. Every failed attempt is one line, so a database that stays down stays visible.
        logError(`server: Workflow queue failed to start (попытка ${attempts}): ${lastError}; следующая через ${delay / 1000} с`)
        timer = setTimeout(attempt, delay)
      },
    )
  }

  attempt()
  return {
    running: () => running,
    stopRetrying: () => {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    },
  }
}

export async function startPersistentServer(
  env: Env,
  deps: ServerStartDeps = {},
): Promise<{ world: boolean; cron: boolean }> {
  const startWorld = deps.startWorld ?? startWorldDefault
  const startCron = deps.startCron ?? startCronRunner
  // process.on, not once: graphile-worker (inside the Postgres world) re-sends the signal to the
  // process after its own graceful stop. A once-handler would be gone by then and that second
  // SIGTERM would kill the process before the wait below is over; this one ignores it instead.
  const onSignal = deps.onSignal ?? ((sig: Signal, handler: () => void) => { process.on(sig, handler) })
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const cwd = deps.cwd ?? (() => process.cwd())
  const safe = (write: (line: string) => void) => (line: string) => {
    try {
      write(line)
    } catch {
      // a broken logger must not stop the boot or the shutdown
    }
  }
  const log = safe(deps.log ?? ((line: string) => console.log(line)))
  const logError = safe(deps.logError ?? ((line: string) => console.error(line)))
  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

  let queue: QueueStart | undefined
  let cron: { stop(): void } | undefined
  /** The agents service: agent work only (PORTAL_ROLE=agents). */
  const agentsOnly = !servesWeb(portalRole(env))

  if (agentsOnly) {
    // Said in every case, configured world or not: the line is also the mark of the role in the boot log.
    log('server: PORTAL_ROLE=agents - очередь Workflow здесь не запускается, её ведёт сервис портала')
  } else if (env.WORKFLOW_TARGET_WORLD === '@workflow/world-postgres') {
    // Not awaited: the boot goes on while the queue starts (or retries); queue.running() tells which.
    queue = startQueueInBackground(startWorld, env.WORKFLOW_POSTGRES_URL, log, logError)
  }
  /** The queue is being started here (it may not be running yet). */
  const world = queue !== undefined

  if (env.CRON_RUNNER_ENABLED === '1') {
    const vercelCrons = env.CRON_SECRET ? vercelCronCount(cwd()) : 0
    if (!env.CRON_SECRET) {
      log('server: CRON_RUNNER_ENABLED=1, но CRON_SECRET не задан - планировщик не запущен')
    } else if (vercelCrons > 0) {
      logError(
        `server: CRON_RUNNER_ENABLED=1, но в vercel.json ещё ${vercelCrons} crons - их запускает Vercel; ` +
          'планировщик НЕ запущен, чтобы задачи не выполнились дважды (сначала уберите crons из vercel.json)',
      )
    } else {
      const claim = env.WORKFLOW_POSTGRES_URL ? createPgCronClaim(env.WORKFLOW_POSTGRES_URL, { log }) : undefined
      if (!claim) {
        log('server: WORKFLOW_POSTGRES_URL не задан - при перекрытии деплоев задачи планировщика могут запуститься дважды')
      }
      cron = startCron({
        baseUrl: `http://127.0.0.1:${env.PORT || 3000}`,
        secret: env.CRON_SECRET,
        claim,
        log,
      })
    }
  }
  if (agentsOnly && !cron) {
    // Nothing else calls /api/cron/agents on this service: no retries, no reaped leases, no scheduled agents.
    logError('server: PORTAL_ROLE=agents, но планировщик не запущен - очередь агентов никто не обслуживает (нужны CRON_RUNNER_ENABLED=1 и CRON_SECRET)')
  }

  // Needed whenever this is the long-lived process or something was started that has to be stopped.
  if (isPersistentServer(env) || world || cron) {
    // Next only looks at whether it is set. Left unset, Next's own handler (server.close, then
    // process.exit(0)) runs next to this one and can end the process before the wait below is over.
    if (isPersistentServer(env) && !env.NEXT_MANUAL_SIG_HANDLE) {
      log('server: NEXT_MANUAL_SIG_HANDLE не задан - собственный обработчик SIGTERM у Next может завершить процесс раньше ожидания фоновых задач (задайте true)')
    }

    let shuttingDown = false
    // graphile-worker, inside the Postgres world, handles the same SIGTERM itself: it stops taking
    // jobs, waits for the running ones (or fails them so they are retried at once) and only then
    // re-sends the signal to the process. Exiting before that leaves the jobs locked for hours. That
    // second signal lands here (process.on is permanent), and is what `queueStopped` waits for.
    let resentSignal!: () => void
    const queueStopped = new Promise<void>((resolve) => { resentSignal = resolve })

    const shutdown = (sig: Signal) => {
      if (shuttingDown) {
        log(`server: ${sig} получен повторно, остановка уже идёт`)
        resentSignal()
        return
      }
      shuttingDown = true
      log(`server: ${sig} получен, остановка`)
      void (async () => {
        let queueTimer: ReturnType<typeof setTimeout> | undefined
        try {
          try {
            cron?.stop() // first: no new cron call may start while the work below is awaited
          } catch (error) {
            log(`server: cron stop failed: ${messageOf(error)}`)
          }
          // Only a queue that is running has graphile-worker's own stop (and its re-sent signal) to
          // wait for. One that is still starting or retrying just gets no further attempts.
          const queueRunning = queue?.running() ?? false
          if (queue && !queueRunning) {
            queue.stopRetrying()
            log('server: очередь Workflow не запущена - повторные попытки остановлены, её остановки не ждём')
          }
          const waited = pendingBackgroundCount()
          // One deadline for both waits: they start together, so the stop takes 55 s at most.
          const queueStop = queueRunning
            ? Promise.race([
                queueStopped.then(() => true),
                new Promise<boolean>((resolve) => { queueTimer = setTimeout(() => resolve(false), SHUTDOWN_WAIT_MS) }),
              ])
            : Promise.resolve(true)
          const [{ finished, pending }, queueDone] = await Promise.all([waitForBackgroundWork(SHUTDOWN_WAIT_MS), queueStop])
          log(`server: ждали ${waited} задач${finished ? '' : `, не завершено ${pending}`}`)
          if (queueRunning) {
            log(queueDone ? 'server: очередь Workflow остановлена' : 'server: очередь Workflow не подтвердила остановку за отведённое время')
          }
        } catch (error) {
          log(`server: shutdown wait failed: ${messageOf(error)}`)
        } finally {
          clearTimeout(queueTimer)
          exit(0)
        }
      })()
    }
    onSignal('SIGTERM', () => shutdown('SIGTERM'))
    onSignal('SIGINT', () => shutdown('SIGINT'))
  }

  return { world, cron: cron !== undefined }
}
