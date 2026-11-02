/**
 * lib/runtime/server-start.ts — what a persistent server (Railway, PERSISTENT_SERVER=1) starts once
 * at boot, from instrumentation.ts:
 *   - the Workflow queue (the Postgres world needs a long-lived process to poll for jobs);
 *   - the in-process cron (Vercel Cron's replacement, lib/cron/runner.ts);
 *   - the SIGTERM/SIGINT handler: a redeploy stops the old instance, and it first stops the cron and
 *     waits for after-response work (lib/background.ts) so a bot answer or a queue drain is not cut.
 *
 * Next's own signal handler is turned off with NEXT_MANUAL_SIG_HANDLE=true, so this one is the only one.
 */
import { createPgCronClaim } from '@/lib/cron/claim'
import { startCronRunner } from '@/lib/cron/runner'
import { pendingBackgroundCount, waitForBackgroundWork } from '@/lib/background'
import { isPersistentServer } from '@/lib/runtime/platform'

/** The deploy's grace period is longer than this; past it the work is abandoned rather than hang the stop. */
const SHUTDOWN_WAIT_MS = 55_000

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
      const claim = env.WORKFLOW_POSTGRES_URL ? createPgCronClaim(env.WORKFLOW_POSTGRES_URL) : undefined
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
    let shuttingDown = false
    const shutdown = (sig: Signal) => {
      if (shuttingDown) {
        log(`server: ${sig} получен, остановка уже идёт`)
        return
      }
      shuttingDown = true
      log(`server: ${sig} получен, остановка`)
      void (async () => {
        try {
          try {
            cron?.stop() // first: no new cron call may start while the work below is awaited
          } catch (error) {
            log(`server: cron stop failed: ${messageOf(error)}`)
          }
          const waited = pendingBackgroundCount()
          const { finished, pending } = await waitForBackgroundWork(SHUTDOWN_WAIT_MS)
          log(`server: ждали ${waited} задач${finished ? '' : `, не завершено ${pending}`}`)
        } catch (error) {
          log(`server: shutdown wait failed: ${messageOf(error)}`)
        } finally {
          exit(0)
        }
      })()
    }
    onSignal('SIGTERM', () => shutdown('SIGTERM'))
    onSignal('SIGINT', () => shutdown('SIGINT'))
  }

  return { world, cron: cron !== undefined }
}
