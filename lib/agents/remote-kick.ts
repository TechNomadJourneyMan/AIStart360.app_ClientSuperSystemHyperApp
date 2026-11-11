/**
 * lib/agents/remote-kick.ts — the portal hands a freshly queued task to the agents service.
 *
 * With PORTAL_ROLE=web nothing of the agent runtime executes in the portal process
 * (lib/runtime/role.ts): kickTask in lib/agents/queue.ts calls this instead of running the task.
 * One small POST over the private network tells the agents service to start the task now
 * (app/api/internal/agents/kick/route.ts). The task itself is already in Postgres, so a hand-over
 * that fails loses nothing: the maintenance loop of the agents service (GET /api/cron/agents)
 * picks the task up on its next run. That is why there is one attempt, a short timeout and no
 * error for the caller.
 *
 * No import of the queue here: the queue imports this file.
 */
import { agentsServiceUrl } from '@/lib/runtime/role'

// Partial, like lib/runtime/platform.ts: Next's typings make NODE_ENV mandatory in ProcessEnv.
type Env = Partial<NodeJS.ProcessEnv>

export type KickResult = 'sent' | 'no_url' | 'failed'

export interface KickDeps {
  fetch?: typeof fetch
  env?: Env
  /** Where the two log lines go. Default: console.error. */
  log?: (line: string) => void
}

const KICK_PATH = '/api/internal/agents/kick'
/** The service is one private-network hop away; a hand-over slower than this is left to its drain. */
const KICK_TIMEOUT_MS = 3000

// "Once per process" has to hold for every copy of this module (Next compiles route handlers and
// instrumentation.ts as separate module graphs), so the flag is on globalThis, like the set in
// lib/background.ts.
const NO_URL_LOGGED = Symbol.for('aistart360.agents.kick.no_url_logged')

/**
 * What a failed request is called in the log: the system error code (undici keeps it on `cause`) or
 * the name of the error, never its message - a message can carry the address or a header.
 */
function failureCode(error: unknown): string {
  const token = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : undefined)
  const read = (value: unknown, key: 'code' | 'name' | 'cause') => (value as Record<string, unknown> | null | undefined)?.[key]
  return token(read(read(error, 'cause'), 'code')) ?? token(read(error, 'code')) ?? token(read(error, 'name')) ?? 'error'
}

/**
 * `POST {AGENTS_SERVICE_URL}/api/internal/agents/kick` with `Authorization: Bearer {CRON_SECRET}`
 * and the body `{"taskId":"<id>"}`, 3 seconds at most. Never throws:
 *   'sent'   - the service answered 2xx;
 *   'no_url' - AGENTS_SERVICE_URL is not set (or not an http(s) address); logged once per process;
 *   'failed' - any other answer or a network error; logged by status or error code every time.
 */
export async function kickAgentsService(taskId: string, deps: KickDeps = {}): Promise<KickResult> {
  const write = (line: string) => {
    try {
      ;(deps.log ?? console.error)(line)
    } catch {
      // a broken logger must not turn a hand-over into an error
    }
  }
  try {
    const env = deps.env ?? process.env
    const base = agentsServiceUrl(env)
    if (!base) {
      const flags = globalThis as Record<symbol, boolean | undefined>
      if (!flags[NO_URL_LOGGED]) {
        flags[NO_URL_LOGGED] = true
        write('[agents] AGENTS_SERVICE_URL не задан — задача ждёт планового разбора очереди')
      }
      return 'no_url'
    }
    const secret = env.CRON_SECRET
    if (!secret) {
      // The service checks the same secret: without one here the request could only be refused.
      write('[agents] kick failed: NO_CRON_SECRET')
      return 'failed'
    }
    const res = await (deps.fetch ?? fetch)(`${base}${KICK_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    })
    // Only the status matters; do not hold the connection for a body nobody reads.
    try {
      await res.body?.cancel()
    } catch {
      // already closed
    }
    if (res.ok) return 'sent'
    write(`[agents] kick failed: ${res.status}`)
    return 'failed'
  } catch (error) {
    write(`[agents] kick failed: ${failureCode(error)}`)
    return 'failed'
  }
}
