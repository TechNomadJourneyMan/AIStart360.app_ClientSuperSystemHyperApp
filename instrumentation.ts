/**
 * instrumentation.ts — Next calls register() once when the server boots (experimental.instrumentationHook).
 * It runs on Vercel too, where it must do nothing: the persistent-server work (Workflow queue, cron,
 * SIGTERM handler) starts only on the Node runtime of a PERSISTENT_SERVER=1 process, i.e. Railway.
 *
 * The check is written as one positive condition around the dynamic import so the Edge build can
 * drop the branch, and with it pg and the rest of the Node-only modules.
 */
import { isPersistentServer } from './lib/runtime/platform'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && isPersistentServer()) {
    const { startPersistentServer } = await import('./lib/runtime/server-start')
    await startPersistentServer(process.env)
  }
}
