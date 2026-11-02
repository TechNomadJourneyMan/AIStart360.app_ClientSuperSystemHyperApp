/**
 * instrumentation.ts — Next calls register() once when the server boots (experimental.instrumentationHook).
 * It runs on Vercel too, where it must do nothing: the persistent-server work (Workflow queue, cron,
 * SIGTERM handler) starts only on the Node runtime of a PERSISTENT_SERVER=1 process, i.e. Railway.
 *
 * The check is written as one positive condition around the dynamic import so the Edge build can
 * drop the branch, and with it pg and the rest of the Node-only modules.
 *
 * A failure there ends the process (exit 1, the platform restarts it) rather than leave it serving
 * without its queue, cron and shutdown handler: Next drops an error with code MODULE_NOT_FOUND
 * thrown from register() without a word (next-server.js, prepareImpl), so it is caught here. The
 * Workflow queue's own start does not fail this way: it retries in the background.
 */
import { isPersistentServer } from './lib/runtime/platform'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && isPersistentServer()) {
    try {
      const { startPersistentServer } = await import('./lib/runtime/server-start')
      await startPersistentServer(process.env)
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      const message = error instanceof Error ? error.message : String(error)
      console.error(`server: persistent-server start failed${typeof code === 'string' ? ` (${code})` : ''}: ${message}; выход с кодом 1`)
      process.exit(1)
    }
  }
}
