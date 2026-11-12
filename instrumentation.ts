/**
 * instrumentation.ts — Next calls register() once when the server boots (experimental.instrumentationHook).
 * It runs on Vercel too, where it must start nothing: the persistent-server work (Workflow queue, cron,
 * SIGTERM handler) starts only on the Node runtime of a PERSISTENT_SERVER=1 process, i.e. Railway.
 *
 * Every Node server first puts the retrying Supabase transport over globalThis.fetch
 * (lib/supabase/transport.ts). That module is Edge-safe, so importing it here keeps the promise
 * below; the Edge runtime has a global scope of its own and takes the wrapper explicitly
 * (lib/supabase/transport-edge.ts). A wrapper that cannot be installed is reported and the boot goes
 * on: the server then works as it did before the wrapper existed.
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
import { installSupabaseTransport } from './lib/supabase/transport'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      installSupabaseTransport()
    } catch (error) {
      console.error(`server: Supabase transport was not installed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

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
