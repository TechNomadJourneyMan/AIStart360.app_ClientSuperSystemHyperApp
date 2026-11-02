/**
 * lib/runtime/server-start.ts — what a persistent server (Railway, PERSISTENT_SERVER=1) starts once
 * at boot, from instrumentation.ts:
 *   - the Workflow queue (the Postgres world needs a long-lived process to poll for jobs);
 *   - the in-process cron (Vercel Cron's replacement, lib/cron/runner.ts);
 *   - the SIGTERM/SIGINT handler: a redeploy stops the old instance, and it first stops the cron and
 *     waits for after-response work (lib/background.ts, which includes the cron calls in flight) so a
 *     bot answer, a queue drain or a digest is not cut. With the Workflow queue running it also waits
 *     for graphile-worker to finish its own stop (see the shutdown below).
 *
 * Next's own signal handler is turned off with NEXT_MANUAL_SIG_HANDLE=true, so this one is the only one.
 */
import { createPgCronClaim } from '@/lib/cron/claim'
import { startCronRunner } from '@/lib/cron/runner'
import { pendingBackgroundCount, waitForBackgroundWork } from '@/lib/background'
import { isPersistentServer } from '@/lib/runtime/platform'

/** The deploy's grace period is longer than this; past it the work is abandoned rather than hang the stop. */
const SHUTDOWN_WAIT_MS = 55_000
/** The project rule for background work is at most two at a time; the queue's own default is 10. */
const QUEUE_CONCURRENCY = '2'

type Signal = 'SIGTERM' | 'SIGINT'
// Partial, like lib/runtime/platform.ts: Next's typings make NODE_ENV mandatory in ProcessEnv.
type Env = Partial<NodeJS.ProcessEnv>

export interface ServerStartDeps {
  /** Starts the Workflow world's queue. Default: `getWorld().start()` from `workflow/runtime`. */
  startWorld?: () => Promise<void>
  startCron?: typeof startCronRunner
  onSignal?: (sig: Signal, handler: () => void) => void
  exit?: (code: number) => void
  log?: (line: string) => void
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
  const out = deps.log ?? ((line: string) => console.log(line))
  const log = (line: string) => {
    try {
      out(line)
    } catch {
      // a broken logger must not stop the boot or the shutdown
    }
  }
  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

  let world = false
  let cron: { stop(): void } | undefined

  if (env.WORKFLOW_TARGET_WORLD === '@workflow/world-postgres') {
    try {
      await startWorld()
    } catch (error) {
      // Not swallowed: without the queue every workflow run would be accepted and never processed.
      // Failing the boot keeps the previous deploy serving instead.
      log(`server: Workflow queue failed to start: ${messageOf(error)}`)
      throw error
    }
    world = true
    log('server: Workflow queue started (postgres world)')
  }

  if (env.CRON_RUNNER_ENABLED === '1') {
    if (!env.CRON_SECRET) {
      log('server: CRON_RUNNER_ENABLED=1, но CRON_SECRET не задан - планировщик не запущен')
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
          const waited = pendingBackgroundCount()
          // One deadline for both waits: they start together, so the stop takes 55 s at most.
          const queue = world
            ? Promise.race([
                queueStopped.then(() => true),
                new Promise<boolean>((resolve) => { queueTimer = setTimeout(() => resolve(false), SHUTDOWN_WAIT_MS) }),
              ])
            : Promise.resolve(true)
          const [{ finished, pending }, queueDone] = await Promise.all([waitForBackgroundWork(SHUTDOWN_WAIT_MS), queue])
          log(`server: ждали ${waited} задач${finished ? '' : `, не завершено ${pending}`}`)
          if (world) {
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
